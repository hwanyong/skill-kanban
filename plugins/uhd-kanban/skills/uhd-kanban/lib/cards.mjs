// 카드 파일을 쓰고 옮기고, 열 안의 순서 번호를 정한다. 모든 함수는 withLock 안에서 부른다.
// 저장소가 git 이고 파일이 추적 중이면 `git mv` 로 옮겨 이력을 잇는다. 아니면 rename 한다.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { KEY_ORDER } from './board.mjs'
import { serialize } from './frontmatter.mjs'
import { activeName } from './filename.mjs'
import { ProjectError } from './project.mjs'
import { parseComments } from './comments.mjs'
import { tagProblems } from './profiles.mjs'

export const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

export const cardText = (data, body) => `${serialize(data, KEY_ORDER)}\n${body.replace(/^\n*/, '\n')}`

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const isTracked = (root, path) => {
  try {
    git(root, ['ls-files', '--error-unmatch', '--', relative(root, path)])
    return true
  } catch {
    return false
  }
}

// 옮긴 뒤 원래 디렉터리가 비었으면 지운다. 열 디렉터리는 카드가 들어갈 때 만들므로(init.mjs) 빈 열 디렉터리를 남기지 않는다.
// kanban/ 자체와 그 위는 지우지 않는다. 숨김 파일(.DS_Store 등)이 남은 디렉터리는 비지 않은 것으로 본다.
const removeIfEmpty = (project, dir) => {
  if (!dir.startsWith(`${project.boardPath}/`) || !existsSync(dir) || readdirSync(dir).length > 0) return
  rmdirSync(dir)
  removeIfEmpty(project, dirname(dir))
}

export const moveFile = (project, from, to) => {
  if (from == to) return
  if (existsSync(to)) throw new ProjectError(`옮길 자리에 이미 파일이 있다: ${relative(project.root, to)}`)
  mkdirSync(dirname(to), { recursive: true })
  if (isTracked(project.root, from)) git(project.root, ['mv', '--', relative(project.root, from), relative(project.root, to)])
  else renameSync(from, to)
  removeIfEmpty(project, dirname(from))
}

export const writeCard = (path, data, body) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, cardText(data, body))
}

// 쓰기 전에 태그 규칙을 본다. readBoard 가 다음에 위반으로 보고할 카드를 쓰지 않는다.
export const assertTags = (project, data, body) => {
  const problems = tagProblems(data, parseComments(body).main, project.profiles)
  if (problems.length > 0) throw new ProjectError(`k${data.id} 의 태그가 규칙에 맞지 않아 쓰지 않았다:\n- ${problems.join('\n- ')}`)
}

export const findCard = (board, id) => {
  const card = [...board.cards, ...board.archived].find((item) => item.id == id)
  if (!card) throw new ProjectError(`k${id} 카드가 없다`)
  return card
}

// 아카이브한 카드까지 포함해 가장 큰 id + 1 을 준다.
export const nextId = (board) => Math.max(0, ...board.cards.map((card) => card.id), ...board.archived.map((card) => card.id)) + 1

const between = (lo, hi) => {
  const value = Math.floor((lo + hi) / 2)
  return value > lo && value < hi ? value : null
}

// position: { top } · { bottom } · { before: id } · { after: id }. column 은 그 열의 카드(순서 번호 순)이고 옮길 카드는 빼고 준다.
// 반환: 새 순서 번호, 또는 빈 번호가 없으면 null(호출하는 쪽이 열을 다시 매긴다).
export const orderFor = (column, position, step, width) => {
  const max = 10 ** width - 1
  const orders = column.map((card) => card.order)
  if (position.top) return orders.length == 0 ? step : between(-1, orders[0])
  if (position.bottom || orders.length == 0) {
    const value = (orders.at(-1) ?? 0) + step
    return value <= max ? value : between(orders.at(-1), max + 1)
  }
  const anchorId = position.before ?? position.after
  const index = column.findIndex((card) => card.id == anchorId)
  if (index == -1) throw new ProjectError(`k${anchorId} 는 이 열에 없다`)
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
  if (cards.length * step > 10 ** width - 1) throw new ProjectError(`${status} 열의 카드 ${cards.length}개를 ${step} 간격으로 매기면 ${width}자리를 넘는다. config.json 의 order.width 를 늘린다`)
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
  if (anchorId == movingId) throw new ProjectError(`k${anchorId} 를 자기 자신 앞뒤에 둘 수 없다`)
  if (!board.cards.some((card) => card.id == anchorId && card.status == status)) throw new ProjectError(`k${anchorId} 는 ${status} 열에 없다`)
}

// card 를 status 열의 position 자리에 옮기고 새 경로를 돌려준다. card.path 의 파일은 이미 있어야 하고 card.data 는 쓴 뒤다.
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
    const dependency = [...board.cards, ...board.archived].find((item) => item.id == id)
    return !dependency || (dependency.kind == 'active' && !resolved.has(dependency.status))
  })
}

// card 를 status 열로 옮긴다. move 와 run 이 함께 쓴다. changes 는 함께 바꿀 frontmatter 값이다.
// dependencies.gate 의 열로 옮길 때 depends_on 카드가 모두 끝나야 한다. force 는 이 검사를 건너뛴다.
// archive.columns 의 열로 들어가면 completed_at 을 적고, 그 열에서 나가면 지운다.
// 반환: { path, renumbered, blocking }. blocking 은 force 로 건너뛴 카드 id 다.
// 파일을 바꾸지 않고 옮길 수 있는지만 본다. 반환: force 로 건너뛸 카드 id.
export const checkMove = (project, board, card, status, { position = { bottom: true }, force = false } = {}) => {
  if (card.kind != 'active') throw new ProjectError(`k${card.id} 는 아카이브에 있다: ${card.relPath}`)
  const column = project.columnOf(status)
  if (!column) throw new ProjectError(`${status} 는 config.json 의 columns 에 없는 status 다`)
  if (!column.types.includes(card.data.type)) throw new ProjectError(`type ${card.data.type} 는 ${status} 열에 둘 수 없다(허용: ${column.types.join(', ')})`)
  const blocking = project.config.dependencies.gate.includes(status) ? unresolved(project, board, card) : []
  if (blocking.length > 0 && !force) throw new ProjectError(`k${card.id} 가 기다리는 카드가 끝나지 않았다: ${blocking.map((item) => `k${item}`).join(', ')}. 그래도 옮기려면 --force`)
  checkPosition(board, status, position, card.id)
  return blocking
}

export const moveCard = (project, board, card, status, { position = { bottom: true }, force = false, changes = {} } = {}) => {
  const blocking = checkMove(project, board, card, status, { position, force })
  const archiveColumns = project.config.archive.columns
  const at = now()
  const entering = archiveColumns.includes(status) && !archiveColumns.includes(card.status)
  const leaving = !archiveColumns.includes(status)
  const data = { ...card.data, ...changes, updated_at: at, completed_at: entering ? at : leaving ? undefined : card.data.completed_at }
  writeCard(card.path, data, card.body)
  return { ...place(project, board, { ...card, data }, status, position), blocking }
}
