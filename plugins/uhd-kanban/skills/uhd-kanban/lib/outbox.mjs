// 카드 세션이 보낼 메시지. uk comment 가 적고, 보드 모니터 mod 의 tool.call 훅이 uk outbox 로 꺼내 $.session.send 로 보낸다.
// 파일은 .uhd-kanban/outbox/<session id>.jsonl 이고 줄마다 { to, text, line } 하나다.
// to 는 SendMessage 가 받는 이름, text 는 보낼 글, line 은 uk comment 가 stdout 에 낸 `SendMessage to=… message=…` 줄이다.
// 쓰기와 꺼내기는 모두 보드 lock 안에서 한다. 꺼내는 쪽이 읽는 사이에 다른 comment 가 줄을 더하면 그 줄을 잃기 때문이다.

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { OUTBOX_NAME } from './root.mjs'

// Claude Code 의 session id(UUID). 파일 이름에 쓰므로 이 형식만 받는다.
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isSessionId = (id) => SESSION_ID.test(id ?? '')

const outboxDir = (project) => join(project.settingsPath, OUTBOX_NAME)
const outboxFile = (project, sessionId) => join(outboxDir(project), `${sessionId}.jsonl`)

export const appendOutbox = (project, sessionId, messages) => {
  if (messages.length == 0) return
  mkdirSync(outboxDir(project), { recursive: true })
  appendFileSync(outboxFile(project, sessionId), messages.map((message) => `${JSON.stringify(message)}\n`).join(''))
}

// outbox 에 파일이 남은 session id 목록. 디렉터리가 없으면 빈 목록.
export const listOutboxSessions = (project) => existsSync(outboxDir(project))
  ? readdirSync(outboxDir(project)).filter((name) => name.endsWith('.jsonl') && isSessionId(name.slice(0, -'.jsonl'.length))).map((name) => name.slice(0, -'.jsonl'.length))
  : []

// 반환: 그 세션의 메시지 목록. 꺼낸 뒤 파일을 지운다. 파일이 없으면 빈 목록.
export const takeOutbox = (project, sessionId) => {
  const path = outboxFile(project, sessionId)
  if (!existsSync(path)) return []
  const messages = readFileSync(path, 'utf8').split('\n').filter((line) => line != '').map((line) => JSON.parse(line))
  rmSync(path)
  return messages
}
