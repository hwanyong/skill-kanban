// 카드를 다른 열로 옮긴다. 기본 자리는 그 열의 맨 아래다. 규칙은 cards.mjs 의 moveCard 가 갖는다.
// dependencies.abandoned 의 열(cancelled)로 옮기면 그 카드를 기다리는 카드와 고칠 명령을 낸다. 그 카드들은 --force 없이 다시 옮길 수 없다.
// uhd-kanban move <k id> <status> [--top|--bottom|--before k|--after k] [--force]

import { UsageError, cardId, positionFrom } from '../args.mjs'
import { dependentsOf, findCard, moveCard } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { abandonedStatuses } from '../project.mjs'

export const run = async ({ positional, flags }) => {
  const [ref, status] = positional
  if (ref == null || status == null) throw new UsageError('move <k id> <status> 형식이다')
  const id = cardId(ref)
  const position = positionFrom(flags)
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    const { path, renumbered, blocking } = moveCard(project, board, card, status, { position, force: flags.force == true })
    console.log(`k${id} ${card.status} → ${status}: ${path.slice(project.root.length + 1)}${renumbered > 0 ? ` (열을 다시 매김: ${renumbered}개)` : ''}${blocking.length > 0 ? ` (--force: ${blocking.map((item) => `k${item}`).join(', ')} 미완료)` : ''}`)
    if (!abandonedStatuses(project.config).includes(status)) return 0
    const waiting = dependentsOf(board, id)
    if (waiting.length == 0) return 0
    console.log(`k${id} 를 기다리는 카드 ${waiting.length}개는 ${status} 카드가 끝나지 않으므로 --force 없이 ${project.config.dependencies.gate.join(' · ')} 열로 옮길 수 없다. 카드마다 하나를 고른다:`)
    const accepts = project.columnOf(status).types
    waiting.forEach((card) => console.log(`- k${card.id}(${card.status}) ${card.data.title}: 의존을 지운다 uhd-kanban set k${card.id} --remove-depends k${id}${accepts.includes(card.data.type) ? ` · 함께 그만둔다 uhd-kanban move k${card.id} ${status}` : ''}`))
    return 0
  })
}
