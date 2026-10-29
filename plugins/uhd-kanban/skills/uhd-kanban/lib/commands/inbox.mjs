// 받는 이름 앞으로 온 코멘트 중 아직 답하지 않은 것을 낸다. 답했다는 것은 같은 카드에 그 이름이 from 인 코멘트가 뒤에 있다는 뜻이다.
// 읽은 표시를 따로 저장하지 않는다. 카드 파일이 유일한 기록이다.
// uhd-kanban inbox [<이름>] [--all]   이름을 주지 않으면 이 세션의 이름. --all 은 답한 코멘트와 아카이브한 카드까지 낸다.

import { readBoard } from '../board.mjs'
import { UsageError } from '../args.mjs'
import { parseComments } from '../comments.mjs'
import { loadProject } from '../project.mjs'
import { currentSessionName, listSessions } from '../sessions.mjs'

export const run = async ({ positional, flags }) => {
  const all = flags.all == true
  const name = positional[0] ?? currentSessionName(listSessions())
  if (name == null) throw new UsageError('이 세션의 이름을 claude agents --json 에서 찾지 못했다. inbox <이름> 으로 준다')
  const project = loadProject()
  const board = readBoard(project)
  if (board.problems.length > 0) console.error(`보드에 규칙 위반 ${board.problems.length}건이 있다. uhd-kanban check 로 확인한다`)
  const cards = all ? [...board.cards, ...board.archived] : board.cards
  const items = cards.flatMap((card) => {
    const { comments } = parseComments(card.body)
    return comments
      .filter((comment) => comment.to.includes(name))
      .map((comment) => ({ card, comment, answered: comments.some((later) => later.n > comment.n && later.from == name) }))
      .filter((item) => all || !item.answered)
  })
  items.forEach(({ card, comment, answered }) => {
    console.log(`k${card.id} c${comment.n} [${comment.kind}] from=${comment.from} at=${comment.at}${answered ? ' (답함)' : ''} ${card.relPath}`)
    console.log(comment.text.split('\n').map((line) => `  ${line}`).join('\n'))
  })
  console.log(`${name} 앞으로 ${all ? '온' : '답하지 않은'} 코멘트 ${items.length}개`)
  return 0
}
