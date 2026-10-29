// 한 열의 순서 번호를 지금 차례 그대로 step 간격으로 다시 매긴다.
// uhd-kanban renumber <status>

import { UsageError } from '../args.mjs'
import { renumberColumn } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { ProjectError } from '../project.mjs'

export const run = async ({ positional }) => {
  const [status] = positional
  if (status == null) throw new UsageError('renumber <status> 형식이다')
  return editBoard(async ({ project, board }) => {
    if (!project.columnOf(status)) throw new ProjectError(`${status} 는 config.json 의 columns 에 없는 status 다`)
    const cards = board.cards.filter((card) => card.status == status)
    const paths = renumberColumn(project, status, cards)
    console.log(`${status} 열 ${paths.size}개를 다시 매겼다`)
    return 0
  })
}
