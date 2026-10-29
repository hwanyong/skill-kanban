// 카드를 같은 열 안에서 다른 자리로 옮긴다. 파일 이름의 순서 번호만 바뀌고 카드 내용은 바뀌지 않는다.
// uhd-kanban order <k id> (--top|--bottom|--before k|--after k)

import { UsageError, cardId, positionFrom } from '../args.mjs'
import { checkPosition, findCard, place } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { ProjectError } from '../project.mjs'

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError('order <k id> (--top|--bottom|--before k|--after k) 형식이다')
  const id = cardId(positional[0])
  const position = positionFrom(flags, null)
  if (position == null) throw new UsageError('--top · --bottom · --before · --after 중 하나가 필요하다')
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    if (card.kind != 'active') throw new ProjectError(`k${id} 는 아카이브에 있다: ${card.relPath}`)
    checkPosition(board, card.status, position, id)
    const { path, renumbered } = place(project, board, card, card.status, position)
    console.log(`k${id} ${card.order} → ${path.slice(project.root.length + 1)}${renumbered > 0 ? ` (열을 다시 매김: ${renumbered}개)` : ''}`)
    return 0
  })
}
