// 카드 세션의 outbox(lib/outbox.mjs)를 꺼내 stdout 에 JSON 배열 한 줄로 내고 지운다. 보드 모니터 mod 의 tool.call 훅이 부르고 그 배열을 $.session.send 로 보낸다.
// 배열의 항목은 { to, text, line } 이다. 꺼낼 것이 없으면 [] 이다.
// uhd-kanban outbox [--session <session id>]   없으면 CLAUDE_CODE_SESSION_ID 다. 보드 모니터 mod 는 --session 을 넘긴다.
// 종료 코드 0: 냈다. 2: session id 가 없거나 형식이 다르다. 3: 보드가 없다.

import { callerSessionId } from '../agents.mjs'
import { UsageError, stringFlag } from '../args.mjs'
import { t } from '../i18n.mjs'
import { withLock } from '../lock.mjs'
import { isSessionId, takeOutbox } from '../outbox.mjs'
import { loadProject } from '../project.mjs'

export const run = async ({ flags }) => {
  const sessionId = stringFlag(flags, 'session') ?? callerSessionId()
  if (!isSessionId(sessionId)) throw new UsageError(t('outbox.badSession', { session: sessionId ?? '-' }))
  const project = loadProject()
  const messages = await withLock(project.settingsPath, async () => takeOutbox(project, sessionId))
  console.log(JSON.stringify(messages))
  return 0
}
