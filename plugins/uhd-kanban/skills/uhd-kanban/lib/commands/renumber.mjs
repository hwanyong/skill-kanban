// 한 열의 순서 번호를 지금 차례 그대로 step 간격으로 다시 매긴다.
// uhd-kanban renumber <status>

import { UsageError } from '../args.mjs'
import { renumberColumn, requireColumn } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { t } from '../i18n.mjs'

// 받는 플래그와 위치 인자 수(lib/args.mjs 의 parseArgs).
export const ARGS = { flags: {}, positional: 1 }

export const run = async ({ positional }) => {
  const [status] = positional
  if (status == null) throw new UsageError(t('renumber.usage'))
  return editBoard(async ({ project, board }) => {
    requireColumn(project, status)
    const cards = board.cards.filter((card) => card.status == status)
    const paths = renumberColumn(project, status, cards)
    console.log(t('renumber.done', { status, count: paths.size }))
    return 0
  })
}
