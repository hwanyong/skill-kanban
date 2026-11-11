// 카드의 제목 · 우선순위 · 태그 · depends_on · collection 을 바꾼다. 제목이 바뀌면 순서 번호(또는 아카이브 날짜)를 그대로 두고 파일 이름을 바꾼다.
// uhd-kanban set <k id> [--title <제목>] [--priority <값>] [--add-tag a,b] [--remove-tag c] [--add-depends k1] [--remove-depends k2] [--add-collection k3] [--remove-collection k4]

import { join, dirname, relative } from 'node:path'
import { PRIORITIES } from '../board.mjs'
import { UsageError, cardId, idsFrom, listFrom, stringFlag } from '../args.mjs'
import { assertRefs, assertTags, findCard, moveFile, updateCard } from '../cards.mjs'
import { hasControl } from '../control.mjs'
import { editBoard } from '../edit.mjs'
import { activeName, archivedName } from '../filename.mjs'
import { t } from '../i18n.mjs'
import { COLLECTION_TYPE } from '../project.mjs'

// 목록에서 remove 를 빼고 없는 add 를 뒤에 붙인다.
const edited = (list, add, remove) => [...list.filter((item) => !remove.includes(item)), ...add.filter((item) => !list.includes(item))]

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError(t('set.usage'))
  const id = cardId(positional[0])
  const title = stringFlag(flags, 'title')?.trim() ?? null
  if (title == '') throw new UsageError(t('set.emptyTitle'))
  if (title != null && hasControl(title)) throw new UsageError(t('card.titleControl'))
  const priority = stringFlag(flags, 'priority')
  if (priority != null && !PRIORITIES.includes(priority)) throw new UsageError(t('args.priority', { values: PRIORITIES }))
  const add = listFrom(flags['add-tag'])
  const remove = listFrom(flags['remove-tag'])
  const lists = {
    depends_on: { add: idsFrom(flags, 'add-depends'), remove: idsFrom(flags, 'remove-depends'), type: null },
    collection: { add: idsFrom(flags, 'add-collection'), remove: idsFrom(flags, 'remove-collection'), type: COLLECTION_TYPE },
  }
  const listChanged = Object.values(lists).some((list) => list.add.length + list.remove.length > 0)
  if (title == null && priority == null && add.length == 0 && remove.length == 0 && !listChanged) throw new UsageError(t('set.nothing'))
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
    const changes = { title: title ?? card.data.title, priority: priority ?? card.data.priority, tags, ...refs }
    assertTags(project, { ...card.data, ...changes }, card.body)
    const name = card.kind == 'active' ? activeName({ order: card.order, id, title: changes.title }, card.width) : archivedName({ date: card.date, id, title: changes.title })
    const target = join(dirname(card.path), name)
    // 실패할 수 있는 이동을 먼저 하고 내용은 옮긴 뒤 쓴다. moveFile 이 실패하면 카드는 옛 이름에 옛 내용 그대로 남는다(slugMismatch 위반을 남기지 않는다).
    moveFile(project, card.path, target)
    updateCard({ ...card, path: target }, changes, card.body)
    console.log(`k${id} ${relative(project.root, target)}`)
    return 0
  })
}
