// 받는 이름 앞으로 온 코멘트 중 아직 답하지 않은 것을 낸다. 답했다는 것은 같은 카드의 뒤 코멘트 중 하나가 그 이름이 from 이거나,
// 보낸 쪽이 아닌 쪽이 보낸 쪽 앞으로(to) 쓴 것이라는 뜻이다. 뒤 조건은 메인 세션이 다시 시작해 이름이 바뀐 뒤 새 이름으로 답한 것을 센다.
// 읽은 표시를 따로 저장하지 않는다. 카드 파일이 유일한 기록이다.
// uhd-kanban inbox [<이름>] [--all] [--kind a,b]   이름을 주지 않으면 이 세션의 이름. --all 은 답한 코멘트와 아카이브한 카드까지 낸다. --kind 는 그 kind 의 코멘트만 낸다.

import { readBoard } from '../board.mjs'
import { UsageError, listFrom } from '../args.mjs'
import { parseComments } from '../comments.mjs'
import { kindText, t } from '../i18n.mjs'
import { assertKind, loadProject } from '../project.mjs'
import { currentSessionName, listSessions } from '../sessions.mjs'

const isReply = (later, comment, name) => later.from == name || (later.from != comment.from && later.to.includes(comment.from))

export const run = async ({ positional, flags }) => {
  const all = flags.all == true
  const name = positional[0] ?? currentSessionName(listSessions())
  if (name == null) throw new UsageError(t('inbox.noName'))
  const project = loadProject()
  const kinds = listFrom(flags.kind).map((kind) => assertKind(project, kind))
  const board = readBoard(project)
  if (board.problems.length > 0) console.error(t('inbox.boardProblems', { count: board.problems.length }))
  const cards = all ? [...board.cards, ...board.archived] : board.cards
  const items = cards.flatMap((card) => {
    const { comments } = parseComments(card.body)
    return comments
      .filter((comment) => comment.to.includes(name) && (kinds.length == 0 || kinds.includes(comment.kind)))
      .map((comment) => ({ card, comment, answered: comments.some((later) => later.n > comment.n && isReply(later, comment, name)) }))
      .filter((item) => all || !item.answered)
  })
  items.forEach(({ card, comment, answered }) => {
    console.log(`k${card.id} c${comment.n} [${kindText(comment.kind)}] from=${comment.from} at=${comment.at}${answered ? ` (${t('inbox.answered')})` : ''} ${card.relPath}`)
    console.log(comment.text.split('\n').map((line) => `  ${line}`).join('\n'))
  })
  console.log(t(all ? 'inbox.summaryAll' : 'inbox.summary', { name, count: items.length }))
  return 0
}
