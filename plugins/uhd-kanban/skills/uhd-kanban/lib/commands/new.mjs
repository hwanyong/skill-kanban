// 카드를 새로 만든다. id 는 보드에서 가장 큰 id + 1 이다.
// 기본 status 는 config.json 의 initial 이 type 마다 정한다(기본 보드에서 milestone 은 planned, 나머지는 to-do).
// uhd-kanban new --type <type> --title <제목> [--status <status>] [--priority medium] [--tags a,b] [--depends k1,k2] [--collection k1] [--body-file <경로>] [--top|--bottom|--before k|--after k]

import { rmSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { PRIORITIES } from '../board.mjs'
import { UsageError, idsFrom, listFrom, positionFrom, readFlagFile, stringFlag } from '../args.mjs'
import { assertRefs, assertTags, checkPosition, columnAccepting, entryFields, nextId, place, removeIfEmpty, writeCard } from '../cards.mjs'
import { commentProblems } from '../comments.mjs'
import { now } from '../time.mjs'
import { hasControl } from '../control.mjs'
import { editBoard } from '../edit.mjs'
import { renumberNote, t } from '../i18n.mjs'
import { ProjectError } from '../errors.mjs'
import { COLLECTION_TYPE, initialStatus } from '../project.mjs'

// 임시 파일로 쓴 카드를 열 자리에 옮긴다. place 가 실패하면 임시 파일과 이 명령이 처음 만든 빈 열 디렉터리를 지우고 같은 오류를 다시 던진다.
// 임시 파일이 남으면 readBoard 가 badName 위반으로 보고 그 뒤의 쓰기 명령이 모두 거절된다. 재번호의 staging 이 이미 임시 파일을 옮겼을 수 있어 force 로 지운다.
const placeNew = (project, board, card, status, position) => {
  try {
    return place(project, board, card, status, position)
  } catch (error) {
    rmSync(card.path, { force: true })
    removeIfEmpty(project, dirname(card.path))
    throw error
  }
}

export const run = async ({ flags }) => {
  const type = stringFlag(flags, 'type')
  const title = stringFlag(flags, 'title')?.trim()
  if (type == null) throw new UsageError(t('args.required', { flag: '--type' }))
  if (title == null || title == '') throw new UsageError(t('args.required', { flag: '--title' }))
  if (hasControl(title)) throw new UsageError(t('card.titleControl'))
  const priority = stringFlag(flags, 'priority') ?? 'medium'
  if (!PRIORITIES.includes(priority)) throw new UsageError(t('args.priority', { values: PRIORITIES }))
  const dependsOn = idsFrom(flags, 'depends')
  const collection = idsFrom(flags, 'collection')
  const bodyFile = stringFlag(flags, 'body-file')
  const body = bodyFile == null ? '' : readFlagFile(flags, 'body-file')
  const position = positionFrom(flags)
  return editBoard(async ({ project, board }) => {
    const status = stringFlag(flags, 'status') ?? initialStatus(project.config, type)
    if (status == null) throw new ProjectError(t('new.noInitial', { type }))
    const column = columnAccepting(project, status, type)
    assertRefs(board, dependsOn, { key: 'depends_on' })
    assertRefs(board, collection, { key: 'collection', type: COLLECTION_TYPE })
    checkPosition(board, status, position, null)
    const id = nextId(board)
    const at = now()
    const data = {
      id,
      type,
      title,
      priority,
      tags: listFrom(flags.tags),
      depends_on: dependsOn,
      collection: collection.length > 0 ? collection : undefined,
      created_at: at,
      updated_at: at,
      ...entryFields(project, null, {}, status, at),
    }
    // 본문의 ## Comments 절을 readBoard 와 같은 판정으로 본다. readBoard 가 다음에 위반으로 보고할 카드를 쓰지 않는다.
    const problems = commentProblems(body, project.config.comments.kinds)
    if (problems.length > 0) throw new ProjectError(t('new.badComments', { id, problems }))
    assertTags(project, data, body)
    const temp = join(project.boardPath, column.dir, `.new-k${id}.md`)
    writeCard(temp, data, body)
    const { path, renumbered } = placeNew(project, board, { id, path: temp, data }, status, position)
    console.log(`k${id} ${relative(project.root, path)}${renumberNote(renumbered)}`)
    return 0
  })
}
