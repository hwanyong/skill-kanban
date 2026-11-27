// 카드 파일을 쓰고 옮기고, 열 안의 순서 번호를 정한다. 모든 함수는 withLock 안에서 부른다.
// 저장소가 git 이고 파일이 추적 중이면 디스크에서 rename 한 뒤 git 색인을 그 경로로 갱신해 이력을 잇는다. 색인에 적는 이름은 디렉터리 엔트리가 돌려준 이름과 같은 정규형으로 한다(아래 indexEntry · diskEntry).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { readBoard } from './board.mjs'
import { serialize } from './frontmatter.mjs'
import { activeName } from './filename.mjs'
import { t } from './i18n.mjs'
import { ProjectError } from './errors.mjs'
import { COLLECTION_TYPE, idStart, milestoneStatuses } from './project.mjs'
import { parseComments } from './comments.mjs'
import { HISTORY_KEY, appendStatus } from './history.mjs'
import { tagProblems } from './profiles.mjs'
import { now } from './time.mjs'

// frontmatter 를 쓸 때 이 순서로 키를 적는다. 없는 키는 이름순으로 뒤에 붙는다.
const KEY_ORDER = [
  'id', 'type', 'title', 'priority', 'tags', 'depends_on', 'owner', 'collection',
  'created_at', 'updated_at', 'completed_at', HISTORY_KEY, 'session', 'session_started_at', 'commits', 'agent_reason',
  'nimbalyst_id', 'nimbalyst_status', 'nimbalyst_sessions',
]

const cardText = (data, body) => `${serialize(data, KEY_ORDER)}\n${body.replace(/^\n*/, '\n')}`

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// git 이 파일 이름을 어떤 정규형으로 저장하는지 본다. macOS 의 git 은 core.precomposeunicode 기본값이 true 라 색인에 완성형(NFC)을 적는다.
const precomposed = (root) => {
  try {
    return git(root, ['config', '--get', 'core.precomposeunicode']).trim() != 'false'
  } catch {
    return true
  }
}

// root 가 git 작업 트리 안인가. 저장소 밖이면 rev-parse 가 종료 코드 128 로 끝나고(2026-11-25 실측: 「fatal: not a git repository」), .git 디렉터리 · bare 저장소 안이면 false 를 낸다.
// git 이 설치되지 않은 때(ENOENT)도 갱신할 색인이 없으므로 false 다.
const insideWorkTree = (root) => {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']).trim() == 'true'
  } catch {
    return false
  }
}

// 색인에 있는 항목의 이름을 되짚는다. 디스크는 자모 분해(NFD)·요청 이름은 완성형(NFC)인 볼륨이 있으므로, 정규형이 같은 항목을 찾아 색인이 쓰는 철자를 그대로 쓴다.
// 작업 트리 밖이거나 색인에 없으면 null 이고, moveFile 은 그때 디스크에서만 옮긴다.
const indexEntry = (root, path) => {
  if (!insideWorkTree(root)) return null
  const dir = relative(root, dirname(path))
  const target = join(dir, basename(path)).normalize('NFC')
  // -z 를 쓴다. 기본값 core.quotePath=true 는 비ASCII 이름을 8진 전위로 바꿔 적어 나오므로 정규형 비교가 성립하지 않는다.
  return git(root, ['ls-files', '-z', '--', dir]).split('\0').find((name) => name.normalize('NFC') == target) ?? null
}

// 디렉터리 엔트리가 돌려준 이름을 되짚는다(SMB 공유는 한글 이름을 NFD 로 저장한다). 색인에 적는 이름은 이것으로 맞춰야 디스크와 색인이 갈리지 않는다.
const diskEntry = (path) => {
  const base = basename(path)
  return readdirSync(dirname(path)).find((name) => name.normalize('NFC') == base.normalize('NFC')) ?? base
}

// 옮긴 뒤 원래 디렉터리가 비었으면 지운다. 열 디렉터리는 카드가 들어갈 때 만들므로(init.mjs) 빈 열 디렉터리를 남기지 않는다.
// kanban/ 자체와 그 위는 지우지 않는다. 숨김 파일(.DS_Store 등)이 남은 디렉터리는 비지 않은 것으로 본다.
export const removeIfEmpty = (project, dir) => {
  if (!dir.startsWith(`${project.boardPath}/`) || !existsSync(dir) || readdirSync(dir).length > 0) return
  rmdirSync(dir)
  removeIfEmpty(project, dirname(dir))
}

// 대소문자를 무시하는 APFS(macOS 기본값)에서는 제목의 대소문자만 바꾼 이름이 같은 파일을 가리켜 existsSync 가 참이다(2026-11-11 실측: set k1 --title Foo 가 cards.targetExists 로 거절됐다). 이름이 아니라 dev · ino 로 같은 파일인지 본다.
// readdir 로 이름을 비교하지 않는다. 디렉터리를 바꿔 옮길 때(place · archive) 대상 디렉터리에 대소문자만 다른 다른 파일이 있으면 그 파일을 덮어쓴다.
const sameFile = (a, b) => {
  const x = statSync(a)
  const y = statSync(b)
  return x.dev == y.dev && x.ino == y.ino
}

export const moveFile = (project, from, to) => {
  // SMB 공유의 readdir 은 한글 이름을 NFD 로 내고 filename.mjs 가 만든 이름은 NFC 다. 같은 파일을 옮기라는 요청을 대상 충돌로 보지 않으려고 NFC 로 비교한다.
  if (from.normalize('NFC') == to.normalize('NFC')) return
  if (existsSync(to) && !sameFile(from, to)) throw new ProjectError(t('cards.targetExists', { path: relative(project.root, to) }))
  mkdirSync(dirname(to), { recursive: true })
  const entry = indexEntry(project.root, from)
  renameSync(from, to)
  // `git mv` 는 요청받은 목적지 철자를 색인에 그대로 적는다. 그래서 디스크가 NFD 로 저장한 카드와 색인이 NFC 로 갈린다(2026-11-24 실측: SMB 저장소에서 카드 이동 뒤 `git status --porcelain -M0` 가 같은 카드를 R 과 ?? 로 나눠 찍었다). rename 뒤 git add 로 두 경로를 담으면 색인이 디스크 철자를 따른다.
  if (entry != null) {
    const spec = (p) => (precomposed(project.root) ? p.normalize('NFC') : p)
    git(project.root, ['add', '-A', '--', entry, spec(relative(project.root, join(dirname(to), diskEntry(to))))])
  }
  removeIfEmpty(project, dirname(from))
}

export const writeCard = (path, data, body) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, cardText(data, body))
}

// 쓰기 전에 태그 규칙을 본다. readBoard 가 다음에 위반으로 보고할 카드를 쓰지 않는다.
export const assertTags = (project, data, body) => {
  const problems = tagProblems(data, parseComments(body).main, project.profiles)
  if (problems.length > 0) throw new ProjectError(t('cards.badTags', { id: data.id, problems }))
}

// 활성 카드와 아카이브 카드에서 id 로 찾는다. assertRefs 가 검증한 depends_on id 를 unresolved 가 같은 규칙으로 다시 찾는다.
const cardById = (board, id) => [...board.cards, ...board.archived].find((item) => item.id == id)

export const findCard = (board, id) => {
  const card = cardById(board, id)
  if (!card) throw new ProjectError(t('cards.notFound', { id }))
  return card
}

// depends_on · collection 에 적을 id 를 본다. 카드가 있어야 하고 자기 자신이 아니어야 하며, type 을 주면 그 type 의 카드여야 한다.
export const assertRefs = (board, ids, { key, self = null, type = null }) => ids.forEach((id) => {
  if (id == self) throw new ProjectError(t('cards.selfRef', { id, key }))
  const card = findCard(board, id)
  if (type != null && card.data.type != type) throw new ProjectError(t('cards.refType', { key, id, type, actual: card.data.type }))
})

// depends_on 에 id 를 둔 열 안의 카드. 아카이브한 카드는 다시 옮기지 않으므로 뺀다.
export const dependentsOf = (board, id) => board.cards.filter((card) => (card.data.depends_on ?? []).includes(id))

// 아카이브한 카드까지 포함해 가장 큰 id + 1 을 준다. 그 값이 config.json 의 ids.start 보다 작으면 ids.start 를 준다.
export const nextId = (project, board) => Math.max(idStart(project.config), Math.max(0, ...board.cards.map((card) => card.id), ...board.archived.map((card) => card.id)) + 1)

const between = (lo, hi) => {
  const value = Math.floor((lo + hi) / 2)
  return value > lo && value < hi ? value : null
}

// position: { top } · { bottom } · { before: id } · { after: id }. column 은 그 열의 카드(순서 번호 순)이고 옮길 카드는 빼고 준다.
// 반환: 새 순서 번호, 또는 빈 번호가 없으면 null(호출하는 쪽이 열을 다시 매긴다).
// before · after 의 카드는 column 에 있어야 한다. 부르는 쪽(place 를 부르는 new · order · moveCard)이 checkPosition 으로 먼저 본다. 아래 slotIndex 도 같은 조건에 기댄다.
const orderFor = (column, position, step, width) => {
  const max = 10 ** width - 1
  const orders = column.map((card) => card.order)
  // 빈 열에서는 어느 자리든 첫 번호가 같다. step 이 width 자리에 들지 않으면 null 을 돌려 renumberColumn 이 cards.renumberOverflow 를 내게 한다.
  if (orders.length == 0) return step <= max ? step : null
  if (position.top) return between(-1, orders[0])
  if (position.bottom) {
    const value = orders.at(-1) + step
    return value <= max ? value : between(orders.at(-1), max + 1)
  }
  const anchorId = position.before ?? position.after
  const index = column.findIndex((card) => card.id == anchorId)
  if (position.before) return between(index == 0 ? -1 : orders[index - 1], orders[index])
  return between(orders[index], index == orders.length - 1 ? max + 1 : orders[index + 1])
}

const slotIndex = (column, position) => {
  if (position.top) return 0
  if (position.bottom) return column.length
  const index = column.findIndex((card) => card.id == (position.before ?? position.after))
  return position.before ? index : index + 1
}

// cards 는 원하는 차례대로 놓은 카드다({ id, path, data.title }). 순서 번호를 step 간격으로 다시 매기고 파일을 옮긴다.
// 이름이 서로 겹치지 않도록 임시 이름을 거쳐 두 번 옮긴다. 반환: 카드 id → 새 경로.
export const renumberColumn = (project, status, cards) => {
  const { step, width } = project.config.order
  if (cards.length * step > 10 ** width - 1) throw new ProjectError(t('cards.renumberOverflow', { status, count: cards.length, step, width }))
  const dir = join(project.boardPath, project.columnOf(status).dir)
  const staged = cards.map((card) => {
    const temp = join(dir, `.renumber-k${card.id}.md`)
    moveFile(project, card.path, temp)
    return { card, temp }
  })
  return new Map(staged.map(({ card, temp }, index) => {
    const target = join(dir, activeName({ order: (index + 1) * step, id: card.id, title: card.data.title }, width))
    moveFile(project, temp, target)
    return [card.id, target]
  }))
}

// 파일을 바꾸기 전에 부른다. --before · --after 의 카드가 그 열에 있는지, 옮길 카드 자신이 아닌지 본다.
export const checkPosition = (board, status, position, movingId) => {
  const anchorId = position.before ?? position.after
  if (anchorId == null) return
  if (anchorId == movingId) throw new ProjectError(t('cards.anchorSelf', { id: anchorId }))
  if (!board.cards.some((card) => card.id == anchorId && card.status == status)) throw new ProjectError(t('cards.anchorNotIn', { id: anchorId, status }))
}

// card 를 status 열의 position 자리에 옮기고 새 경로를 돌려준다. card.path 의 파일은 이미 있어야 한다. 파일 내용은 바꾸지 않는다(호출하는 쪽이 옮긴 뒤 쓴다).
// 빈 순서 번호가 없으면 그 열 전체를 다시 매긴다. renumbered 는 다시 매긴 카드 수다(옮긴 카드 제외).
export const place = (project, board, card, status, position) => {
  const { step, width } = project.config.order
  const column = board.cards.filter((item) => item.status == status && item.id != card.id)
  const order = orderFor(column, position, step, width)
  if (order != null) {
    const target = join(project.boardPath, project.columnOf(status).dir, activeName({ order, id: card.id, title: card.data.title }, width))
    moveFile(project, card.path, target)
    return { path: target, renumbered: 0 }
  }
  const list = [...column]
  list.splice(slotIndex(column, position), 0, card)
  const paths = renumberColumn(project, status, list)
  return { path: paths.get(card.id), renumbered: column.length }
}

const unresolved = (project, board, card) => {
  const resolved = new Set(project.config.dependencies.resolved)
  return (card.data.depends_on ?? []).filter((id) => {
    const dependency = cardById(board, id)
    return !dependency || (dependency.kind == 'active' && !resolved.has(dependency.status))
  })
}

// status 열을 돌려준다. config.json 에 없는 status 면 멈춘다.
export const requireColumn = (project, status) => {
  const column = project.columnOf(status)
  if (!column) throw new ProjectError(t('cards.unknownStatus', { status }))
  return column
}

// status 열을 돌려준다. 그 열이 type 의 카드를 받지 않으면 멈춘다.
export const columnAccepting = (project, status, type) => {
  const column = requireColumn(project, status)
  if (!column.types.includes(type)) throw new ProjectError(t('card.typeNotAllowed', { type, status, types: column.types }))
  return column
}

// 아카이브한 카드면 멈춘다. 열을 옮기거나 열 안의 순서를 바꾸는 명령이 먼저 부른다.
export const assertActive = (card) => {
  if (card.kind != 'active') throw new ProjectError(t('cards.archived', { id: card.id, path: card.relPath }))
}

// 파일을 바꾸지 않고 옮길 수 있는지만 본다. 반환: force 로 건너뛸 카드 id.
export const checkMove = (project, board, card, status, { position = { bottom: true }, force = false } = {}) => {
  assertActive(card)
  columnAccepting(project, status, card.data.type)
  const blocking = project.config.dependencies.gate.includes(status) ? unresolved(project, board, card) : []
  if (blocking.length > 0 && !force) throw new ProjectError(t('cards.blocked', { id: card.id, blocking }))
  checkPosition(board, status, position, card.id)
  return blocking
}

// 카드가 status 열에 들어갈 때 바뀌는 completed_at 과 status_history 를 돌려준다. from 은 지금 열이고 새 카드면 null 이다.
// archive.columns 의 열로 들어가면 completed_at 을 적고, 그 열에서 나가면 지운다. 열이 바뀌면 status_history 에 항목을 덧붙인다(history.mjs).
export const entryFields = (project, from, data, status, at) => {
  const archiveColumns = project.config.archive.columns
  const entering = archiveColumns.includes(status) && !archiveColumns.includes(from)
  const leaving = !archiveColumns.includes(status)
  return {
    completed_at: entering ? at : leaving ? undefined : data.completed_at,
    [HISTORY_KEY]: status == from ? data[HISTORY_KEY] : appendStatus(data, status, at),
  }
}

// 열을 옮기지 않고 frontmatter 와 본문을 쓰며 updated_at 을 찍는다.
export const updateCard = (card, changes, body) => writeCard(card.path, { ...card.data, ...changes, updated_at: now() }, body)

// card 를 status 열로 옮긴다. move · run · recover 가 함께 쓴다. changes 는 함께 바꿀 frontmatter 값이다.
// dependencies.gate 의 열로 옮길 때 depends_on 카드가 모두 끝나야 한다. force 는 이 검사를 건너뛴다.
// completed_at 과 status_history 는 entryFields 의 규칙으로 바꾼다. updated_at 과 같은 at 을 쓴다.
// run.status 로 옮기면 waiting 열에 있는 소속 milestone 을 running 열로 함께 옮긴다. 작업 카드가 이미 옮겨졌으므로 의존 검사로 막지 않는다.
// 반환: { path, renumbered, blocking, started }. blocking 은 force 로 건너뛴 카드 id, started 는 함께 옮긴 milestone id 다.
export const moveCard = (project, board, card, status, { position = { bottom: true }, force = false, changes = {} } = {}) => {
  const blocking = checkMove(project, board, card, status, { position, force })
  const at = now()
  const data = { ...card.data, ...changes, updated_at: at, ...entryFields(project, card.status, card.data, status, at) }
  // 실패할 수 있는 이동을 먼저 하고 내용은 옮긴 뒤 쓴다. place 가 실패하면 파일은 옛 열에 옛 내용 그대로 남는다(status_history 의 historyLast 위반을 남기지 않는다).
  const placed = place(project, board, { ...card, data }, status, position)
  writeCard(placed.path, data, card.body)
  return { ...placed, blocking, started: startMilestones(project, board, data, status) }
}

// milestone 을 옮길 때마다 보드를 다시 읽는다. 앞 milestone 의 새 순서 번호가 board 에 없으면 다음 milestone 이 같은 번호를 받는다.
const startMilestones = (project, board, data, status) => {
  const { waiting, running } = milestoneStatuses(project.config)
  if (status != project.config.run.status || running == null) return []
  const isWaiting = (card) => (data.collection ?? []).includes(card.id) && card.data.type == COLLECTION_TYPE && card.status == waiting
  const started = board.cards.filter(isWaiting).map((card) => card.id)
  for (const id of started) {
    const current = readBoard(project)
    moveCard(project, current, findCard(current, id), running, { force: true })
  }
  return started
}
