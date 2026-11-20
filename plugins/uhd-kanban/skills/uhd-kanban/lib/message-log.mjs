// 세션이 SendMessage 도구로 보낸 메시지의 기록. 보드 모니터 mod 의 session.send 훅이 uk message-log 로 적고, flow 명령이 읽는다.
// 파일은 .uhd-kanban/message-log/<보낸 session id>.jsonl 이고 줄마다 { at, to, text, agent_id } 하나다. agent_id 는 subagent 가 보냈을 때만 있다.
// 2026-11-20 실측(2.1.329): 받는 세션의 session.receive 에는 보낸 세션의 id 가 없었다. 그래서 보내는 세션이 자기 id 로 적는다.
// 카드 세션의 보고(uk comment)는 카드 코멘트에 이미 있으므로 적지 않는다. mod 가 그 보고를 $.session.send 로 보내면 origin.kind 가 plugin 이고, 훅은 model 만 넘긴다.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { isSessionId } from './outbox.mjs'
import { MESSAGE_LOG_NAME } from './root.mjs'

const SUFFIX = '.jsonl'

const logDir = (project) => join(project.settingsPath, MESSAGE_LOG_NAME)

export const appendMessage = (project, sessionId, entry) => {
  mkdirSync(logDir(project), { recursive: true })
  appendFileSync(join(logDir(project), `${sessionId}${SUFFIX}`), `${JSON.stringify(entry)}\n`)
}

// JSON 이 아닌 줄(다른 프로세스가 쓰는 중인 마지막 줄)은 뺀다.
const parseLine = (line) => {
  try {
    return [JSON.parse(line)]
  } catch {
    return []
  }
}

// 반환: [{ from_session, at, to, text, agent_id }]. 디렉터리가 없으면 빈 목록.
export const readMessages = (project) => {
  const dir = logDir(project)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => name.slice(0, -SUFFIX.length))
    .filter((sessionId) => isSessionId(sessionId))
    .flatMap((sessionId) => readFileSync(join(dir, `${sessionId}${SUFFIX}`), 'utf8').split('\n').filter((line) => line != '').flatMap(parseLine).map((entry) => ({ from_session: sessionId, ...entry })))
}
