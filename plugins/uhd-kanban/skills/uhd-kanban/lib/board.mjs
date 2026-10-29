// `kanban/` 의 카드를 모두 읽는다. 열(상태)은 디렉터리 이름이, 순서는 파일 이름이 갖는다.
// 읽으면서 규칙 위반을 모아 problems 로 돌려준다. 고치는 일은 하지 않는다.

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { FrontmatterError, parse } from './frontmatter.mjs'
import { parseName, titleSlug } from './filename.mjs'
import { parseComments } from './comments.mjs'
import { tagProblems } from './profiles.mjs'

export const PRIORITIES = ['critical', 'high', 'medium', 'low']

// frontmatter 를 쓸 때 이 순서로 키를 적는다. 없는 키는 이름순으로 뒤에 붙는다.
export const KEY_ORDER = [
  'id', 'type', 'title', 'priority', 'tags', 'depends_on', 'owner', 'collection',
  'created_at', 'updated_at', 'completed_at', 'session', 'session_started_at', 'commits', 'agent_reason',
  'nimbalyst_id', 'nimbalyst_status', 'nimbalyst_sessions',
]

const listDir = (path) => (existsSync(path) ? readdirSync(path, { withFileTypes: true }) : [])

const checkData = (data, card, column, profiles, problems) => {
  const at = card.relPath
  if (data.id != card.id) problems.push(`${at}: frontmatter id ${data.id} 가 파일 이름의 k${card.id} 와 다르다`)
  if (typeof data.title != 'string' || data.title.trim() == '') problems.push(`${at}: title 이 없다`)
  if (typeof data.title == 'string' && titleSlug(data.title) != card.slug) problems.push(`${at}: 파일 이름의 제목이 title 과 다르다(기대: ${titleSlug(data.title)})`)
  if (column && !column.types.includes(data.type)) problems.push(`${at}: type ${data.type} 는 ${column.status} 열에 둘 수 없다(허용: ${column.types.join(', ')})`)
  if (data.priority != null && !PRIORITIES.includes(data.priority)) problems.push(`${at}: priority 는 ${PRIORITIES.join(' · ')} 중 하나다: ${data.priority}`)
  if (data.tags != null && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag != 'string'))) problems.push(`${at}: tags 는 문자열 목록이다`)
  if (data.depends_on != null && (!Array.isArray(data.depends_on) || data.depends_on.some((id) => !Number.isInteger(id)))) problems.push(`${at}: depends_on 은 카드 id(정수) 목록이다`)
  if (data.collection != null && (!Array.isArray(data.collection) || data.collection.some((id) => !Number.isInteger(id)))) problems.push(`${at}: collection 은 milestone 카드 id(정수) 목록이다`)
  const comments = parseComments(card.body)
  comments.problems.forEach((problem) => problems.push(`${at}: ${problem}`))
  if (Array.isArray(data.tags)) tagProblems(data, comments.main, profiles).forEach((problem) => problems.push(`${at}: ${problem}`))
}

export const readCard = (path, relPath, name, column, profiles, problems) => {
  const parsedName = parseName(name)
  if (!parsedName) {
    problems.push(`${relPath}: 파일 이름이 <순서 번호>-k<id>-<제목>.md 형식이 아니다`)
    return null
  }
  try {
    const { data, body } = parse(readFileSync(path, 'utf8'))
    const card = { ...parsedName, path, relPath, name, status: column?.status ?? null, column: column?.dir ?? null, data, body }
    checkData(data, card, column, profiles, problems)
    return card
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error
    problems.push(`${relPath}: ${error.message}`)
    return null
  }
}

// 열 디렉터리에 있는 카드 파일(`.md`)의 디렉터리 항목.
const cardFiles = (boardPath, column) => listDir(join(boardPath, column.dir)).filter((entry) => entry.isFile() && entry.name.endsWith('.md'))

// 파일 이름만 읽는다. 카드 파일을 열지 않으므로 규칙 검사를 하지 않는다. 규칙 검사는 readBoard 가 갖는다.
// 반환: 열마다 { column, cards: [{ id, order, name }] }. cards 는 순서 번호 순이고, 이름이 규칙에 맞지 않는 파일은 뺀다.
export const readColumnNames = (project) => project.config.columns.map((column) => ({
  column,
  cards: cardFiles(project.boardPath, column)
    .map((entry) => ({ ...parseName(entry.name), name: entry.name }))
    .filter((card) => card.kind == 'active')
    .sort((a, b) => a.order - b.order)
    .map(({ id, order, name }) => ({ id, order, name })),
}))

// 반환: { cards, archived, problems }. cards 는 열 순서 · 순서 번호 순, archived 는 날짜 순이다.
export const readBoard = (project) => {
  const { boardPath, config } = project
  const problems = []
  const known = new Set([...config.columns.map((column) => column.dir), config.archive.dir])
  listDir(boardPath)
    .filter((entry) => !known.has(entry.name) && !entry.name.startsWith('.'))
    .forEach((entry) => problems.push(`kanban/${entry.name}: config.json 의 columns 에 없는 ${entry.isDirectory() ? '디렉터리' : '파일'}다`))
  const cards = config.columns.flatMap((column) => {
    const inColumn = cardFiles(boardPath, column)
      .map((entry) => readCard(join(boardPath, column.dir, entry.name), `kanban/${column.dir}/${entry.name.normalize('NFC')}`, entry.name, column, project.profiles, problems))
      .filter((card) => card != null)
    inColumn.filter((card) => card.kind != 'active').forEach((card) => problems.push(`${card.relPath}: 열 안의 카드는 순서 번호로 시작한다`))
    inColumn.filter((card) => card.width != config.order.width).forEach((card) => problems.push(`${card.relPath}: 순서 번호가 ${config.order.width}자리가 아니다`))
    const sorted = inColumn.sort((a, b) => a.order - b.order)
    sorted.filter((card, index) => index > 0 && card.order == sorted[index - 1].order).forEach((card) => problems.push(`${card.relPath}: 순서 번호 ${card.order} 가 같은 열에 두 번 있다`))
    return sorted
  })
  const archiveRoot = join(boardPath, config.archive.dir)
  const archived = listDir(archiveRoot)
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
    .flatMap((month) => listDir(join(archiveRoot, month.name))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => readCard(join(archiveRoot, month.name, entry.name), `kanban/${config.archive.dir}/${month.name}/${entry.name.normalize('NFC')}`, entry.name, null, project.profiles, problems)))
    .filter((card) => card != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
  const seen = new Map()
  const everyCard = [...cards, ...archived]
  everyCard.forEach((card) => {
    if (seen.has(card.id)) problems.push(`k${card.id} 가 두 곳에 있다: ${seen.get(card.id)} · ${card.relPath}`)
    seen.set(card.id, card.relPath)
  })
  return { cards, archived, problems }
}
