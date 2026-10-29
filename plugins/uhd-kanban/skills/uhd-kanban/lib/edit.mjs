// 보드를 바꾸는 명령의 공통 절차: 프로젝트를 읽고, lock 을 잡고, lock 안에서 보드를 다시 읽는다.
// 보드에 규칙 위반이 있으면 바꾸지 않는다. 위반 위에서 순서 번호를 다시 매기면 위반이 다른 카드로 퍼진다.

import { readBoard } from './board.mjs'
import { withLock } from './lock.mjs'
import { ProjectError, loadProject } from './project.mjs'

export const editBoard = async (work) => {
  const project = loadProject()
  return withLock(project, async () => {
    const board = readBoard(project)
    if (board.problems.length > 0) throw new ProjectError(`보드에 규칙 위반 ${board.problems.length}건이 있어 바꾸지 않았다. uhd-kanban check 로 확인한다:\n- ${board.problems.join('\n- ')}`)
    return work({ project, board })
  })
}
