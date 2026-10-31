// 카드를 새로 만든다. id 는 보드에서 가장 큰 id + 1 이다.
// 기본 status 는 config.json 의 initial 이 type 마다 정한다(기본 보드에서 milestone 은 planned, 나머지는 to-do).
// uhd-kanban new --type <type> --title <제목> [--status <status>] [--priority medium] [--tags a,b] [--depends k1,k2] [--collection k1] [--body-file <경로>] [--top|--bottom|--before k|--after k]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRIORITIES } from '../board.mjs'
import { UsageError, cardId, listFrom, positionFrom } from '../args.mjs'
import { assertRefs, assertTags, checkPosition, nextId, now, place, writeCard } from '../cards.mjs'
import { hasControl } from '../control.mjs'
import { editBoard } from '../edit.mjs'
import { renumberNote, t } from '../i18n.mjs'
import { COLLECTION_TYPE, ProjectError, initialStatus } from '../project.mjs'

export const run = async ({ flags }) => {
  if (typeof flags.type != 'string') throw new UsageError(t('args.required', { flag: '--type' }))
  if (typeof flags.title != 'string' || flags.title.trim() == '') throw new UsageError(t('args.required', { flag: '--title' }))
  if (hasControl(flags.title.trim())) throw new UsageError(t('card.titleControl'))
  const priority = typeof flags.priority == 'string' ? flags.priority : 'medium'
  if (!PRIORITIES.includes(priority)) throw new UsageError(t('args.priority', { values: PRIORITIES }))
  const dependsOn = listFrom(flags.depends).map((ref) => cardId(ref, '--depends'))
  const collection = listFrom(flags.collection).map((ref) => cardId(ref, '--collection'))
  const body = typeof flags['body-file'] == 'string' ? readFileSync(flags['body-file'], 'utf8') : ''
  const position = positionFrom(flags)
  return editBoard(async ({ project, board }) => {
    const status = typeof flags.status == 'string' ? flags.status : initialStatus(project.config, flags.type)
    if (status == null) throw new ProjectError(t('new.noInitial', { type: flags.type }))
    const column = project.columnOf(status)
    if (!column) throw new ProjectError(t('cards.unknownStatus', { status }))
    if (!column.types.includes(flags.type)) throw new ProjectError(t('card.typeNotAllowed', { type: flags.type, status, types: column.types }))
    assertRefs(board, dependsOn, { key: 'depends_on' })
    assertRefs(board, collection, { key: 'collection', type: COLLECTION_TYPE })
    checkPosition(board, status, position, null)
    const id = nextId(board)
    const at = now()
    const data = {
      id,
      type: flags.type,
      title: flags.title.trim(),
      priority,
      tags: listFrom(flags.tags),
      depends_on: dependsOn,
      collection: collection.length > 0 ? collection : undefined,
      created_at: at,
      updated_at: at,
      completed_at: project.config.archive.columns.includes(status) ? at : undefined,
    }
    assertTags(project, data, body)
    const temp = join(project.boardPath, column.dir, `.new-k${id}.md`)
    writeCard(temp, data, body)
    const { path, renumbered } = place(project, board, { id, path: temp, data }, status, position)
    console.log(`k${id} ${path.slice(project.root.length + 1)}${renumberNote(renumbered)}`)
    return 0
  })
}
