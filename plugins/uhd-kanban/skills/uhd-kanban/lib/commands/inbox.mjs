// 받는 이름 앞으로 온 코멘트 중 아직 답하지 않은 것을 낸다. 답했다는 것은 같은 카드의 뒤 코멘트 중 하나가 그 이름이 from 이거나,
// 보낸 쪽이 아닌 쪽이 보낸 쪽 앞으로(to) 쓴 것이라는 뜻이다. 뒤 조건은 메인 세션이 다시 시작해 이름이 바뀐 뒤 새 이름으로 답한 것을 센다.
// 등록된 메인 세션의 이름과 역할 이름 main 은 같은 받는 쪽이다(lib/main.mjs 의 addressNames). 메인 세션을 바꾼 뒤에도 main 앞으로 온 코멘트를 새 세션이 읽는다.
// 읽은 표시를 따로 저장하지 않는다. 카드 파일이 유일한 기록이다.
// lock 안에서 읽는다. 남이 쓰는 중에 읽으면 renumber 의 임시 이름(.renumber-k<id>.md)과 반쯤 쓴 파일을 위반으로 보고 ENOENT 로 죽었다(2026-11-11 실측: renumber 반복 중 check 80번 중 66번 거짓 위반, board --json 100번 중 2번 ENOENT).
// uhd-kanban inbox [<이름>] [--all] [--kind a,b]   이름을 주지 않으면 이 세션의 이름. --all 은 답한 코멘트와 아카이브한 카드까지 낸다. --kind 는 그 kind 의 코멘트만 낸다.

import { UsageError, listFrom } from '../args.mjs'
import { parseComments } from '../comments.mjs'
import { viewBoard } from '../edit.mjs'
import { kindText, t } from '../i18n.mjs'
import { addressNames } from '../main.mjs'
import { assertKind, loadProject } from '../project.mjs'
import { currentSessionName, listSessions } from '../sessions.mjs'

const isReply = (later, comment, names) => names.includes(later.from) || (later.from != comment.from && later.to.includes(comment.from))

export const run = async ({ positional, flags }) => {
  const all = flags.all == true
  const name = positional[0] ?? currentSessionName(listSessions())
  if (name == null) throw new UsageError(t('inbox.noName'))
  const project = loadProject()
  const kinds = listFrom(flags.kind).map((kind) => assertKind(project, kind))
  const names = addressNames(project, name)
  const board = await viewBoard(project)
  if (board.problems.length > 0) console.error(t('inbox.boardProblems', { count: board.problems.length }))
  const cards = all ? [...board.cards, ...board.archived] : board.cards
  const items = cards.flatMap((card) => {
    const { comments } = parseComments(card.body)
    return comments
      .filter((comment) => comment.to.some((to) => names.includes(to)) && (kinds.length == 0 || kinds.includes(comment.kind)))
      .map((comment) => ({ card, comment, answered: comments.some((later) => later.n > comment.n && isReply(later, comment, names)) }))
      .filter((item) => all || !item.answered)
  })
  items.forEach(({ card, comment, answered }) => {
    console.log(`k${card.id} c${comment.n} [${kindText(comment.kind)}] from=${comment.from} at=${comment.at}${answered ? ` (${t('inbox.answered')})` : ''} ${card.relPath}`)
    console.log(comment.text.split('\n').map((line) => `  ${line}`).join('\n'))
  })
  console.log(t(all ? 'inbox.summaryAll' : 'inbox.summary', { name, count: items.length }))
  return 0
}
