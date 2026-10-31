// 카드를 다른 열로 옮긴다. 기본 자리는 그 열의 맨 아래다. 규칙은 cards.mjs 의 moveCard 가 갖는다.
// dependencies.abandoned 의 열(cancelled)로 옮기면 그 카드를 기다리는 카드와 고칠 명령을 낸다. 그 카드들은 --force 없이 다시 옮길 수 없다.
// uhd-kanban move <k id> <status> [--top|--bottom|--before k|--after k] [--force]

import { UsageError, cardId, positionFrom } from '../args.mjs'
import { dependentsOf, findCard, moveCard } from '../cards.mjs'
import { editBoard } from '../edit.mjs'
import { abandonedStatuses } from '../project.mjs'
import { forceNote, renumberNote, startedNote, t } from '../i18n.mjs'

export const run = async ({ positional, flags }) => {
  const [ref, status] = positional
  if (ref == null || status == null) throw new UsageError(t('move.usage'))
  const id = cardId(ref)
  const position = positionFrom(flags)
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    const { path, renumbered, blocking, started } = moveCard(project, board, card, status, { position, force: flags.force == true })
    console.log(`k${id} ${card.status} → ${status}: ${path.slice(project.root.length + 1)}${renumberNote(renumbered)}${forceNote(blocking)}${startedNote(started)}`)
    if (!abandonedStatuses(project.config).includes(status)) return 0
    const waiting = dependentsOf(board, id)
    if (waiting.length == 0) return 0
    console.log(t('move.waiting', { id, count: waiting.length, status, gate: project.config.dependencies.gate }))
    const accepts = project.columnOf(status).types
    waiting.forEach((card) => console.log(t('move.waitingItem', { card, id, status, cancel: accepts.includes(card.data.type) })))
    return 0
  })
}
