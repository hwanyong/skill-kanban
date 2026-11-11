// 보드를 바꾸는 명령의 공통 절차: 프로젝트를 읽고, lock 을 잡고, lock 안에서 보드를 다시 읽는다.
// 보드에 규칙 위반이 있으면 바꾸지 않는다. 위반 위에서 순서 번호를 다시 매기면 위반이 다른 카드로 퍼진다.
// 읽기만 하는 명령(check · board · inbox)도 viewBoard 로 lock 안에서 읽는다. 남이 쓰는 중에 읽으면 renumber 의 임시 이름과 반쯤 쓴 파일을 본다.

import { readBoard } from './board.mjs'
import { t } from './i18n.mjs'
import { withLock } from './lock.mjs'
import { ProjectError } from './errors.mjs'
import { loadProject } from './project.mjs'

// editBoard 는 viewBoard 를 부르지 않는다. work 까지 같은 lock 안에서 실행해야 한다.
export const viewBoard = (project) => withLock(project.settingsPath, async () => readBoard(project))

export const editBoard = async (work) => {
  const project = loadProject()
  return withLock(project.settingsPath, async () => {
    const board = readBoard(project)
    if (board.problems.length > 0) throw new ProjectError(t('edit.boardInvalid', { problems: board.problems }))
    return work({ project, board })
  })
}
