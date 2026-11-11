// run 과 recover 가 같은 절차로 카드 세션을 띄우고 그 세션을 카드에 적는다.

import { moveCard, updateCard } from './cards.mjs'
import { appendComment } from './comments.mjs'
import { claimMain } from './main.mjs'
import { findSession, launchBackground, listSessions, sessionName, startedAt } from './sessions.mjs'
import { setTimeout as sleep } from 'node:timers/promises'
import { now } from './time.mjs'

// 2026-11-11 실측(2.1.322): 띄운 직후 세션 항목에는 pid 가 없고 startedAt 이 띄운 시각이었다. 프로세스가 뜨자 pid 가 생기고 startedAt 이
// 프로세스 시작 시각으로 바뀌었다(0.68초 뒤). pid 가 생기기 전 값을 적으면 두 시각이 초 경계를 넘을 때 session_started_at 이 1초 달라지고,
// classify 가 다시 뜬 세션으로 본다. 그래서 pid 가 생길 때까지 목록을 다시 읽는다.
const SPAWN_WAIT_MS = 10 * 1000
const SPAWN_POLL_MS = 250

// 띄운 세션 항목. pid 가 생길 때까지 기다리고, SPAWN_WAIT_MS 안에 생기지 않으면 pid 없는 항목을 그대로 돌려준다. 목록에 없으면 null.
const spawnedSession = async (shortId) => {
  const deadline = Date.now() + SPAWN_WAIT_MS
  for (;;) {
    const session = findSession(listSessions({ all: true }), shortId)
    if (!session || session.pid != null || Date.now() > deadline) return session
    await sleep(SPAWN_POLL_MS)
  }
}

// 카드 세션을 띄우고, 띄운 세션 항목을 목록에서 찾아 { shortId, session } 으로 돌려준다. 찾지 못하면 session 은 null 이다.
// claimMain 은 launchBackground 가 성공한 뒤에만 부른다. 띄우지 못하면 launchBackground 가 던지므로 main.json 이 생기지 않는다.
// claimMain 이 main.mjs 에 있는 것은 main.mjs 가 sessions.mjs 를 import 하기 때문이다. sessions.mjs 에서 부르면 import 가 순환한다.
export const launchCard = async (project, sessions, args, prompt, cwd) => {
  const shortId = launchBackground(args, prompt, cwd)
  claimMain(project, sessions)
  return { shortId, session: await spawnedSession(shortId) }
}

// 띄운 세션을 카드에 적는다. [assign] 코멘트를 붙이고, session · session_started_at 을 적고, 카드가 status 열에 없으면 그 열로 옮긴다.
// session 에 pid 가 없으면(spawnedSession 이 기다리다 그만둔 때) startedAt 이 띄운 시각이므로 session_started_at 을 비운다. classify 는 빈 값이면 다시 뜬 것으로 보지 않는다.
// session 이 없으면(recover 가 띄운 세션을 찾지 못한 때) session · session_started_at 은 바꾸지 않는다. 코멘트를 붙이는 것과 열을 옮기는 것은 session 이 있을 때와 같다.
// 반환: 옮겼으면 moveCard 의 반환값, 옮기지 않았으면 null.
export const assignCard = (project, board, card, status, { from, text, session, force = false }) => {
  const changes = session ? { session: session.sessionId, session_started_at: session.pid != null ? startedAt(session) : null } : {}
  const { body } = appendComment(card.body, { kind: 'assign', from, to: [sessionName(card.id)], at: now(), text })
  if (card.status == status) {
    updateCard(card, changes, body)
    return null
  }
  return moveCard(project, board, { ...card, body }, status, { force, changes })
}
