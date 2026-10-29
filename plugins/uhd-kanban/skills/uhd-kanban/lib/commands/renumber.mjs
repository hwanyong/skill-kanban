// 한 열의 순서 번호를 지금 차례 그대로 step 간격으로 다시 매긴다.
// uhd-kanban renumber <status>

import { UsageError } from '../args.mjs'
import { renumberColumn } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { t } from '../i18n.mjs'
import { ProjectError } from '../project.mjs'

export const run = async ({ positional }) => {
  const [status] = positional
  if (status == null) throw new UsageError(t('renumber.usage'))
  return editBoard(async ({ project, board }) => {
    if (!project.columnOf(status)) throw new ProjectError(t('cards.unknownStatus', { status }))
    const cards = board.cards.filter((card) => card.status == status)
    const paths = renumberColumn(project, status, cards)
    console.log(t('renumber.done', { status, count: paths.size }))
    return 0
  })
}
