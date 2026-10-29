// 카드의 제목 · 우선순위 · 태그를 바꾼다. 제목이 바뀌면 순서 번호(또는 아카이브 날짜)를 그대로 두고 파일 이름을 바꾼다.
// uhd-kanban set <k id> [--title <제목>] [--priority <값>] [--add-tag a,b] [--remove-tag c]

import { join, dirname } from 'node:path'
import { PRIORITIES } from '../board.mjs'
import { UsageError, cardId, listFrom } from '../args.mjs'
import { assertTags, findCard, moveFile, now, writeCard } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { activeName, archivedName } from '../filename.mjs'

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError('set <k id> [--title] [--priority] [--add-tag] [--remove-tag] 형식이다')
  const id = cardId(positional[0])
  const title = typeof flags.title == 'string' ? flags.title.trim() : null
  if (title == '') throw new UsageError('--title 이 비었다')
  const priority = typeof flags.priority == 'string' ? flags.priority : null
  if (priority != null && !PRIORITIES.includes(priority)) throw new UsageError(`--priority 는 ${PRIORITIES.join(' · ')} 중 하나다`)
  const add = listFrom(flags['add-tag'])
  const remove = listFrom(flags['remove-tag'])
  if (title == null && priority == null && add.length == 0 && remove.length == 0) throw new UsageError('바꿀 것이 없다')
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    const tags = [...(card.data.tags ?? []).filter((tag) => !remove.includes(tag)), ...add.filter((tag) => !(card.data.tags ?? []).includes(tag))]
    const data = { ...card.data, title: title ?? card.data.title, priority: priority ?? card.data.priority, tags, updated_at: now() }
    assertTags(project, data, card.body)
    writeCard(card.path, data, card.body)
    const name = card.kind == 'active' ? activeName({ order: card.order, id, title: data.title }, card.width) : archivedName({ date: card.date, id, title: data.title })
    const target = join(dirname(card.path), name)
    moveFile(project, card.path, target)
    console.log(`k${id} ${target.slice(project.root.length + 1)}`)
    return 0
  })
}
