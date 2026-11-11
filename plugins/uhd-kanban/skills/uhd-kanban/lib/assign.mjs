// run 과 recover 가 같은 절차로 카드 세션을 띄우고 그 세션을 카드에 적는다.

import { moveCard, updateCard } from './cards.mjs'
import { appendComment } from './comments.mjs'
import { claimMain } from './main.mjs'
import { findSession, launchBackground, listSessions, sessionName, startedAt } from './sessions.mjs'
import { now } from './time.mjs'

// 카드 세션을 띄우고, 띄운 세션 항목을 목록에서 찾아 { shortId, session } 으로 돌려준다. 찾지 못하면 session 은 null 이다.
// claimMain 은 launchBackground 가 성공한 뒤에만 부른다. 띄우지 못하면 launchBackground 가 던지므로 main.json 이 생기지 않는다.
// claimMain 이 main.mjs 에 있는 것은 main.mjs 가 sessions.mjs 를 import 하기 때문이다. sessions.mjs 에서 부르면 import 가 순환한다.
export const launchCard = (project, sessions, args, prompt, cwd) => {
  const shortId = launchBackground(args, prompt, cwd)
  claimMain(project, sessions)
  return { shortId, session: findSession(listSessions({ all: true }), shortId) }
}

// 띄운 세션을 카드에 적는다. [assign] 코멘트를 붙이고, session · session_started_at 을 적고, 카드가 status 열에 없으면 그 열로 옮긴다.
// session 이 없으면(recover 가 띄운 세션을 찾지 못한 때) session · session_started_at 은 바꾸지 않는다. 코멘트를 붙이는 것과 열을 옮기는 것은 session 이 있을 때와 같다.
// 반환: 옮겼으면 moveCard 의 반환값, 옮기지 않았으면 null.
export const assignCard = (project, board, card, status, { from, text, session, force = false }) => {
  const changes = session ? { session: session.sessionId, session_started_at: startedAt(session) } : {}
  const { body } = appendComment(card.body, { kind: 'assign', from, to: [sessionName(card.id)], at: now(), text })
  if (card.status == status) {
    updateCard(card, changes, body)
    return null
  }
  return moveCard(project, board, { ...card, body }, status, { force, changes })
}
