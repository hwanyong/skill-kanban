// 세션이 SendMessage 도구로 보낸 메시지 하나를 stdin 의 JSON({ to, text, agent_id? })으로 받아 message-log(lib/message-log.mjs)에 적는다.
// 보드 모니터 mod 의 session.send 훅이 보낸 뒤에 부른다. 시각은 이 명령이 적는다.
// uhd-kanban message-log [--session <session id>]   없으면 CLAUDE_CODE_SESSION_ID 다. 보드 모니터 mod 는 --session 을 넘긴다.
// 종료 코드 0: 적었다. 2: session id 나 입력의 형식이 다르다. 3: 보드가 없다.

import { readFileSync } from 'node:fs'
import { callerSessionId } from '../agents.mjs'
import { UsageError, stringFlag } from '../args.mjs'
import { t } from '../i18n.mjs'
import { appendMessage } from '../message-log.mjs'
import { isSessionId } from '../outbox.mjs'
import { loadProject } from '../project.mjs'
import { now } from '../time.mjs'

// JSON 이 아니면 사용법 오류로 끝낸다.
const parseInput = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    throw new UsageError(t('messageLog.badInput'))
  }
}

const readInput = () => {
  const input = parseInput(readFileSync(0, 'utf8'))
  if (typeof input?.to != 'string' || typeof input.text != 'string') throw new UsageError(t('messageLog.badInput'))
  if (input.agent_id != null && typeof input.agent_id != 'string') throw new UsageError(t('messageLog.badInput'))
  return input
}

export const run = async ({ flags }) => {
  const sessionId = stringFlag(flags, 'session') ?? callerSessionId()
  if (!isSessionId(sessionId)) throw new UsageError(t('messageLog.badSession', { session: sessionId ?? '-' }))
  const { to, text, agent_id: agentId } = readInput()
  const project = loadProject()
  appendMessage(project, sessionId, agentId == null ? { at: now(), to, text } : { at: now(), to, text, agent_id: agentId })
  return 0
}
