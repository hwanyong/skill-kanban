// 카드를 새로 만든다. id 는 보드에서 가장 큰 id + 1 이다.
// uhd-kanban new --type <type> --title <제목> [--status to-do] [--priority medium] [--tags a,b] [--depends k1,k2] [--body-file <경로>] [--top|--bottom|--before k|--after k]

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PRIORITIES } from '../board.mjs'
import { UsageError, cardId, listFrom, positionFrom } from '../args.mjs'
import { assertTags, checkPosition, findCard, nextId, now, place, writeCard } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { ProjectError } from '../project.mjs'

export const run = async ({ flags }) => {
  if (typeof flags.type != 'string') throw new UsageError('--type 이 필요하다')
  if (typeof flags.title != 'string' || flags.title.trim() == '') throw new UsageError('--title 이 필요하다')
  const status = typeof flags.status == 'string' ? flags.status : 'to-do'
  const priority = typeof flags.priority == 'string' ? flags.priority : 'medium'
  if (!PRIORITIES.includes(priority)) throw new UsageError(`--priority 는 ${PRIORITIES.join(' · ')} 중 하나다`)
  const dependsOn = listFrom(flags.depends).map((ref) => cardId(ref, '--depends'))
  const body = typeof flags['body-file'] == 'string' ? readFileSync(flags['body-file'], 'utf8') : ''
  const position = positionFrom(flags)
  return editBoard(async ({ project, board }) => {
    const column = project.columnOf(status)
    if (!column) throw new ProjectError(`${status} 는 config.json 의 columns 에 없는 status 다`)
    if (!column.types.includes(flags.type)) throw new ProjectError(`type ${flags.type} 는 ${status} 열에 둘 수 없다(허용: ${column.types.join(', ')})`)
    dependsOn.forEach((id) => findCard(board, id))
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
      created_at: at,
      updated_at: at,
      completed_at: project.config.archive.columns.includes(status) ? at : undefined,
    }
    assertTags(project, data, body)
    const temp = join(project.boardPath, column.dir, `.new-k${id}.md`)
    writeCard(temp, data, body)
    const { path, renumbered } = place(project, board, { id, path: temp, data }, status, position)
    console.log(`k${id} ${path.slice(project.root.length + 1)}${renumbered > 0 ? ` (열을 다시 매김: ${renumbered}개)` : ''}`)
    return 0
  })
}
