// 카드의 제목 · 우선순위 · 태그 · depends_on · collection 을 바꾼다. 제목이 바뀌면 순서 번호(또는 아카이브 날짜)를 그대로 두고 파일 이름을 바꾼다.
// uhd-kanban set <k id> [--title <제목>] [--priority <값>] [--add-tag a,b] [--remove-tag c] [--add-depends k1] [--remove-depends k2] [--add-collection k3] [--remove-collection k4]

import { join, dirname } from 'node:path'
import { PRIORITIES } from '../board.mjs'
import { UsageError, cardId, listFrom } from '../args.mjs'
import { COLLECTION_TYPE, assertRefs, assertTags, findCard, moveFile, now, writeCard } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { activeName, archivedName } from '../filename.mjs'

// 목록에서 remove 를 빼고 없는 add 를 뒤에 붙인다.
const edited = (list, add, remove) => [...list.filter((item) => !remove.includes(item)), ...add.filter((item) => !list.includes(item))]

const idsFrom = (flags, name) => listFrom(flags[name]).map((ref) => cardId(ref, `--${name}`))

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError('set <k id> [--title] [--priority] [--add-tag] [--remove-tag] [--add-depends] [--remove-depends] [--add-collection] [--remove-collection] 형식이다')
  const id = cardId(positional[0])
  const title = typeof flags.title == 'string' ? flags.title.trim() : null
  if (title == '') throw new UsageError('--title 이 비었다')
  const priority = typeof flags.priority == 'string' ? flags.priority : null
  if (priority != null && !PRIORITIES.includes(priority)) throw new UsageError(`--priority 는 ${PRIORITIES.join(' · ')} 중 하나다`)
  const add = listFrom(flags['add-tag'])
  const remove = listFrom(flags['remove-tag'])
  const lists = {
    depends_on: { add: idsFrom(flags, 'add-depends'), remove: idsFrom(flags, 'remove-depends'), type: null },
    collection: { add: idsFrom(flags, 'add-collection'), remove: idsFrom(flags, 'remove-collection'), type: COLLECTION_TYPE },
  }
  const listChanged = Object.values(lists).some((list) => list.add.length + list.remove.length > 0)
  if (title == null && priority == null && add.length == 0 && remove.length == 0 && !listChanged) throw new UsageError('바꿀 것이 없다')
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    const tags = edited(card.data.tags ?? [], add, remove)
    Object.entries(lists).forEach(([key, list]) => assertRefs(board, list.add, { key, self: id, type: list.type }))
    // 바꾸라고 준 목록만 고친다. collection 은 비면 키를 지우고, depends_on 은 new 와 같이 빈 목록으로 남긴다.
    const refs = Object.fromEntries(Object.entries(lists)
      .filter(([, list]) => list.add.length + list.remove.length > 0)
      .map(([key, list]) => {
        const value = edited(card.data[key] ?? [], list.add, list.remove)
        return [key, value.length == 0 && key == 'collection' ? undefined : value]
      }))
    const data = { ...card.data, title: title ?? card.data.title, priority: priority ?? card.data.priority, tags, ...refs, updated_at: now() }
    assertTags(project, data, card.body)
    writeCard(card.path, data, card.body)
    const name = card.kind == 'active' ? activeName({ order: card.order, id, title: data.title }, card.width) : archivedName({ date: card.date, id, title: data.title })
    const target = join(dirname(card.path), name)
    moveFile(project, card.path, target)
    console.log(`k${id} ${target.slice(project.root.length + 1)}`)
    return 0
  })
}
