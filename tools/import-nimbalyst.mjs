#!/usr/bin/env node
// Nimbalyst tracker 한 작업 공간의 항목을 uhd-kanban 보드로 가져온다. 한 번 쓰고 마는 이전 도구라 스킬(plugins/uhd-kanban/skills/uhd-kanban) · 플러그인 밖에 둔다(2026-10-29 사용자 지시).
// node tools/import-nimbalyst.mjs [<작업 공간 경로>] [--db <nimbalyst.sqlite>] [--dry-run]   작업 공간을 주지 않으면 프로젝트 루트.
// 대상은 `uhd-kanban init` 만 한 빈 보드다. DB 는 읽기 전용으로 연다.
// 바꾸는 규칙(2026-10-28 · 29 사용자 결정):
// - id 는 Nimbalyst 항목을 만든 차례대로 1 부터 매기고, 대응표를 `.uhd-kanban/nimbalyst-ids.tsv` 에 둔다. 열 안의 순서 번호도 만든 차례다.
// - status 는 같은 이름의 열로 간다. 보관한 항목은 kanban/archived/ 로 가고 파일 이름의 날짜는 done 이면 완료 시각, 아니면 보관 시각이다.
// - agentModel 은 MODEL_PROFILES 로 model: 태그, agentEffort 는 effort: 태그, labels 는 태그로 간다.
// - 코멘트는 머리 줄을 붙인다. 첫 줄에 8자리 16진수가 있으면 from= 에 넣고 없으면 from=unknown, to=unknown 이다.
//   kind 는 첫 줄에 comments.kinds 의 낱말이 있으면 그것이고 없으면 가져옴 이다.
// - 제목 · 본문 · 코멘트 · agentReason · chosen 안의 이 작업 공간 항목 id(`task_1791873774065_fbzj7k`)는 `k<id>` 로 바꿔 쓴다. 원문은 nimbalyst-items.jsonl 에 있다.
//   이 작업 공간에 없는 id(잘렸거나 지운 항목)는 그대로 두고 개수를 알린다.
// - blocks(A 가 B 를 막는다)는 B 의 depends_on 에, items(milestone 이 X 를 갖는다)는 X 의 collection 에 넣는다.
// - 카드에 옮기지 않는 activity · authorIdentity · 커밋 메시지 등은 원래 항목을 통째로 `.uhd-kanban/nimbalyst-items.jsonl` 에 남긴다.

import { DatabaseSync } from 'node:sqlite'
import { writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from '../plugins/uhd-kanban/skills/uhd-kanban/lib/args.mjs'
import { readBoard } from '../plugins/uhd-kanban/skills/uhd-kanban/lib/board.mjs'
import { writeCard } from '../plugins/uhd-kanban/skills/uhd-kanban/lib/cards.mjs'
import { SECTION, appendComment, textProblems } from '../plugins/uhd-kanban/skills/uhd-kanban/lib/comments.mjs'
import { editBoard } from '../plugins/uhd-kanban/skills/uhd-kanban/lib/edit.mjs'
import { activeName, archivedName, localDate } from '../plugins/uhd-kanban/skills/uhd-kanban/lib/filename.mjs'
import { tagProblems } from '../plugins/uhd-kanban/skills/uhd-kanban/lib/profiles.mjs'
import { ProjectError } from '../plugins/uhd-kanban/skills/uhd-kanban/lib/project.mjs'

const DEFAULT_DB = join(homedir(), 'Library', 'Application Support', '@nimbalyst', 'electron', 'sqlite-db', 'nimbalyst.sqlite')

// 2026-10-29 에 poieve 에서 잰 agentModel 값 전부. 표에 없는 값이 나오면 가져오지 않는다.
const MODEL_PROFILES = {
  'claude-code:opus-1m': 'deep-1m',
  'claude-code:opus': 'deep',
  'opus': 'deep',
  'claude-opus-5-5': 'deep',
  'claude-code:sonnet': 'standard',
  'sonnet': 'standard',
  'claude-sonnet-5-5': 'standard',
  'user': 'user',
}
const IMPORT_KIND = '가져옴'
const UNKNOWN = 'unknown'
const ITEM_REF = /(?<![0-9A-Za-z_])(?:task|bug|decision|milestone|plan)_[0-9a-z]+(?:_[0-9a-z]+)?(?![0-9A-Za-z_])/g
const SESSION_ID = /(?:^|[^0-9a-z])([0-9a-f]{8})(?![0-9a-z])/i

const iso = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')
const unique = (list) => [...new Set(list)]
const itemIds = (list) => (Array.isArray(list) ? list.map((entry) => entry?.itemId).filter((id) => typeof id == 'string') : [])
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 첫 줄에서 가장 앞에 나오는 kind. 같은 자리면 긴 것(`사용자 답` 과 `답`). 앞뒤가 글자 · 숫자면 낱말이 아니다(`답변`).
const kindOf = (firstLine, kinds) => {
  const hits = kinds.flatMap((kind) => {
    const match = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escape(kind)})(?![\\p{L}\\p{N}])`, 'u').exec(firstLine)
    return match ? [{ kind, at: match.index + match[0].length - kind.length }] : []
  })
  hits.sort((a, b) => a.at - b.at || b.kind.length - a.kind.length)
  return hits[0]?.kind ?? IMPORT_KIND
}

const readItems = (dbPath, workspace) => {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  const rows = db.prepare('select id, type, data, archived, archived_at, created, updated from tracker_items where workspace = ? and deleted_at is null order by created, id').all(workspace)
  const sessions = db.prepare('select id, metadata from ai_sessions where workspace_id = ?').all(workspace)
  const relations = db.prepare('select relationship_type_key as type, count(*) as n from tracker_relationship_index where workspace = ? group by 1').all(workspace)
  db.close()
  return { rows: rows.map((row) => ({ ...row, data: JSON.parse(row.data) })), sessions, relations }
}

// 항목 id → 그 항목을 연결한 Nimbalyst 세션 id 목록.
const sessionLinks = (sessions) => {
  const links = new Map()
  sessions.forEach((session) => {
    const ids = JSON.parse(session.metadata || '{}').linkedTrackerItemIds
    if (Array.isArray(ids)) ids.forEach((id) => links.set(id, [...(links.get(id) ?? []), session.id]))
  })
  return links
}

const completedAt = (row) => {
  const changes = (row.data.activity ?? []).filter((entry) => entry.field == 'status' && entry.newValue == 'done')
  return changes.length > 0 ? iso(Math.max(...changes.map((entry) => entry.timestamp))) : null
}

const convertComments = (row, kinds, rewrite, problems, stats) => {
  const comments = [...(row.data.comments ?? [])].filter((comment) => !comment.deleted).sort((a, b) => a.createdAt - b.createdAt)
  return comments.map((comment) => {
    const text = rewrite(String(comment.body ?? '').replace(/\s+$/, ''))
    const firstLine = text.split('\n').find((line) => line.trim() != '') ?? ''
    const from = SESSION_ID.exec(firstLine)?.[1].toLowerCase() ?? UNKNOWN
    const kind = kindOf(firstLine, kinds)
    textProblems(text).forEach((problem) => problems.push(`${row.id} 코멘트 ${comment.id}: ${problem}`))
    stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1
    stats.from[from == UNKNOWN ? UNKNOWN : '8자리 id'] += 1
    return { kind, from, to: [UNKNOWN], at: iso(comment.createdAt), text }
  })
}

const run = async ({ positional, flags }) => {
  const dryRun = flags['dry-run'] == true
  const dbPath = typeof flags.db == 'string' ? flags.db : DEFAULT_DB
  return editBoard(async ({ project, board }) => {
    if (board.cards.length + board.archived.length > 0) throw new ProjectError(`보드에 카드가 ${board.cards.length + board.archived.length}개 있다. 가져오기는 빈 보드에만 한다`)
    const kinds = project.config.comments.kinds
    if (!kinds.includes(IMPORT_KIND)) throw new ProjectError(`${join(project.settingsPath, 'config.json')} 의 comments.kinds 에 "${IMPORT_KIND}" 을 더한다. 첫 줄로 kind 를 정하지 못한 코멘트에 쓴다`)
    const workspace = positional[0] ?? project.root
    const { rows, sessions, relations } = readItems(dbPath, workspace)
    if (rows.length == 0) throw new ProjectError(`${dbPath} 에 작업 공간 ${workspace} 의 항목이 없다`)
    const kOf = new Map(rows.map((row, index) => [row.id, index + 1]))
    const links = sessionLinks(sessions)
    const problems = []
    const missing = []
    const stats = { kinds: {}, from: { '8자리 id': 0, [UNKNOWN]: 0 }, edges: { depends_on: 0, collection: 0 }, refs: 0 }
    const unknownRefs = []
    const rewrite = (text) => text.replace(ITEM_REF, (ref) => {
      if (!kOf.has(ref)) {
        unknownRefs.push(ref)
        return ref
      }
      stats.refs += 1
      return `k${kOf.get(ref)}`
    })
    const depends = new Map(rows.map((row) => [row.id, []]))
    const collections = new Map(rows.map((row) => [row.id, []]))
    const addEdge = (map, source, target, field) => {
      if (!kOf.has(target)) return missing.push(`${source} 의 ${field} 대상 ${target}`)
      map.get(source).push(target)
    }
    rows.forEach((row) => {
      const custom = row.data.customFields ?? {}
      unique([...itemIds(row.data.dependsOn), ...itemIds(custom.dependsOn)]).forEach((target) => addEdge(depends, row.id, target, 'dependsOn'))
      itemIds(custom.blocks).forEach((target) => kOf.has(target) ? depends.get(target).push(row.id) : missing.push(`${row.id} 의 blocks 대상 ${target}`))
      itemIds(custom.collection).forEach((target) => addEdge(collections, row.id, target, 'collection'))
      itemIds(custom.items).forEach((target) => kOf.has(target) ? collections.get(target).push(row.id) : missing.push(`${row.id} 의 items 대상 ${target}`))
    })
    const cards = rows.map((row) => {
      const id = kOf.get(row.id)
      const status = row.data.status
      const column = project.columnOf(status)
      if (!column) problems.push(`${row.id}: status ${status} 는 columns 에 없다`)
      if (column && !column.types.includes(row.type)) problems.push(`${row.id}: type ${row.type} 는 ${status} 열에 둘 수 없다`)
      const agentModel = row.data.agentModel
      const profile = agentModel ? MODEL_PROFILES[agentModel] : null
      if (agentModel && !profile) problems.push(`${row.id}: agentModel ${agentModel} 이 MODEL_PROFILES 에 없다`)
      const tags = unique([...(row.data.tags ?? []), ...(row.data.labels ?? []), ...(profile ? [`model:${profile}`] : []), ...(row.data.agentEffort ? [`effort:${row.data.agentEffort}`] : [])])
      const dependsOn = unique(depends.get(row.id)).map((target) => kOf.get(target))
      const collection = unique(collections.get(row.id)).map((target) => kOf.get(target))
      stats.edges.depends_on += dependsOn.length
      stats.edges.collection += collection.length
      const commits = unique([...(row.data.linkedCommits ?? []).map((commit) => commit.sha), row.data.linkedCommitSha].filter((sha) => typeof sha == 'string'))
      const archived = row.archived == 1
      const done = project.config.archive.columns.includes(status)
      const data = {
        id,
        type: row.type,
        title: rewrite(String(row.data.title ?? '').trim()),
        priority: row.data.priority,
        tags,
        depends_on: dependsOn,
        collection: collection.length > 0 ? collection : undefined,
        created_at: iso(row.created),
        updated_at: iso(row.updated),
        completed_at: done ? completedAt(row) ?? undefined : undefined,
        commits: commits.length > 0 ? commits : undefined,
        agent_reason: row.data.agentReason ? rewrite(row.data.agentReason) : undefined,
        decision_id: row.data.decisionId ?? undefined,
        chosen: row.data.chosen ? rewrite(row.data.chosen) : undefined,
        due_date: row.data.dueDate ?? undefined,
        nimbalyst_id: row.id,
        nimbalyst_status: status,
        nimbalyst_sessions: links.get(row.id),
      }
      if (data.title == '') problems.push(`${row.id}: title 이 비었다`)
      if (done && data.completed_at == null) problems.push(`${row.id}: ${status} 인데 activity 에 done 으로 바꾼 기록이 없다`)
      const description = rewrite(String(row.data.description ?? '').replace(/\s+$/, ''))
      if (description.split('\n').includes(SECTION)) problems.push(`${row.id}: 본문에 ${SECTION} 줄이 있다`)
      tagProblems(data, description, project.profiles).forEach((problem) => problems.push(`${row.id}: ${problem}`))
      const body = convertComments(row, kinds, rewrite, problems, stats).reduce((text, comment) => appendComment(text, comment).body, description == '' ? '' : `${description}\n`)
      return { row, id, status, archived, data, body }
    })
    const { step, width } = project.config.order
    const counters = new Map()
    const placed = cards.map((card) => {
      if (card.archived) {
        const date = localDate(new Date(card.data.completed_at ?? card.row.archived_at))
        return { ...card, path: join(project.boardPath, project.config.archive.dir, date.slice(0, 7), archivedName({ date, id: card.id, title: card.data.title })) }
      }
      const order = ((counters.get(card.status) ?? 0) + 1) * step
      counters.set(card.status, order / step)
      return { ...card, path: join(project.boardPath, project.columnOf(card.status)?.dir ?? '-', activeName({ order, id: card.id, title: card.data.title }, width)) }
    })
    const comments = Object.values(stats.kinds).reduce((sum, n) => sum + n, 0)
    console.log(`항목 ${rows.length}개 · 보관 ${cards.filter((card) => card.archived).length}개 · 코멘트 ${comments}개 (from 8자리 id ${stats.from['8자리 id']} · ${UNKNOWN} ${stats.from[UNKNOWN]})`)
    console.log(`열: ${[...counters].map(([status, n]) => `${status} ${n}`).join(' · ')}`)
    console.log(`kind: ${Object.entries(stats.kinds).sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${kind} ${n}`).join(' · ')}`)
    console.log(`depends_on ${stats.edges.depends_on}개 · collection ${stats.edges.collection}개 · tracker_relationship_index: ${relations.map((relation) => `${relation.type} ${relation.n}`).join(' · ')}`)
    console.log(`글 안의 항목 id 를 k<id> 로 바꾼 곳 ${stats.refs}개 · 이 작업 공간에 없어 그대로 둔 곳 ${unknownRefs.length}개${unknownRefs.length > 0 ? `: ${unique(unknownRefs).join(', ')}` : ''}`)
    if (missing.length > 0) console.log(`대상 항목이 없어 옮기지 않은 관계 ${missing.length}개:\n- ${missing.join('\n- ')}`)
    if (problems.length > 0) {
      console.error(`가져올 수 없는 것 ${problems.length}건이 있어 아무것도 쓰지 않았다:\n- ${problems.join('\n- ')}`)
      return 1
    }
    if (dryRun) return 0
    placed.forEach((card) => writeCard(card.path, card.data, card.body))
    writeFileSync(join(project.settingsPath, 'nimbalyst-ids.tsv'), `k_id\tnimbalyst_id\n${placed.map((card) => `k${card.id}\t${card.row.id}`).join('\n')}\n`)
    writeFileSync(join(project.settingsPath, 'nimbalyst-items.jsonl'), `${placed.map((card) => JSON.stringify({ k: card.id, ...card.row })).join('\n')}\n`)
    const after = readBoard(project)
    console.log(`썼다: 카드 ${after.cards.length}개 · 아카이브 ${after.archived.length}개 · 규칙 위반 ${after.problems.length}건`)
    if (after.problems.length > 0) console.error(`- ${after.problems.join('\n- ')}`)
    return after.problems.length > 0 ? 1 : 0
  })
}

const exitCode = await run(parseArgs(process.argv.slice(2))).catch((error) => {
  if (!(error instanceof ProjectError)) throw error
  console.error(error.message)
  return 1
})
process.exitCode = exitCode
