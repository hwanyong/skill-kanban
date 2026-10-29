// 카드를 다른 열로 옮긴다. 기본 자리는 그 열의 맨 아래다. 규칙은 cards.mjs 의 moveCard 가 갖는다.
// uhd-kanban move <k id> <status> [--top|--bottom|--before k|--after k] [--force]

import { UsageError, cardId, positionFrom } from '../args.mjs'
import { findCard, moveCard } from '../cards.mjs'
import { editBoard } from '../edit.mjs'

export const run = async ({ positional, flags }) => {
  const [ref, status] = positional
  if (ref == null || status == null) throw new UsageError('move <k id> <status> 형식이다')
  const id = cardId(ref)
  const position = positionFrom(flags)
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    const { path, renumbered, blocking } = moveCard(project, board, card, status, { position, force: flags.force == true })
    console.log(`k${id} ${card.status} → ${status}: ${path.slice(project.root.length + 1)}${renumbered > 0 ? ` (열을 다시 매김: ${renumbered}개)` : ''}${blocking.length > 0 ? ` (--force: ${blocking.map((item) => `k${item}`).join(', ')} 미완료)` : ''}`)
    return 0
  })
}
