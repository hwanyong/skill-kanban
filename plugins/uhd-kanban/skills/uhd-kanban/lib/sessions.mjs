// `claude agents --json` 으로 이 Mac 에서 도는 Claude Code 세션 목록을 읽는다.
// 2026-10-29 실측(2.1.312): 항목마다 pid · id(짧은 id) · cwd · kind · startedAt · sessionId · name · status · state 가 있다. pid · status 는 프로세스가 있을 때만 있다.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ProjectError } from './project.mjs'

// all 이면 끝난 백그라운드 세션까지 낸다(`--all`).
export const listSessions = ({ all = false } = {}) => {
  const text = execFileSync('claude', ['agents', '--json', ...(all ? ['--all'] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const sessions = JSON.parse(text)
  if (!Array.isArray(sessions)) throw new ProjectError('claude agents --json 의 stdout 이 배열이 아니다')
  return sessions
}

// 이 프로세스를 띄운 세션의 이름. CLAUDE_CODE_SESSION_ID 가 없거나 목록에 없으면 null.
export const currentSessionName = (sessions) => {
  const id = process.env.CLAUDE_CODE_SESSION_ID
  if (!id) return null
  return sessions.find((session) => session.sessionId == id)?.name ?? null
}

// `claude --bg` 를 실행하고 세션의 짧은 id 를 돌려준다. 2026-10-29 실측: stdout 에 `claude stop <짧은 id>` 줄이 있다.
// 띄우지 못하면(예: `Workspace not trusted`) stdout · stderr 를 오류 메시지에 그대로 넣는다.
// 프롬프트는 `--` 뒤에 둔다. 카드 본문이 `-` 로 시작하면(마크다운 목록) claude 가 그 줄을 옵션으로 읽는다.
export const launchBackground = (args, prompt, cwd) => {
  const result = spawnSync('claude', ['--bg', ...args, '--', prompt], { cwd, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const match = /claude stop (\S+)/.exec(output)
  if (result.status != 0 || !match) throw new ProjectError(`claude --bg 가 세션을 띄우지 못했다(종료 코드 ${result.status}):\n${output}`)
  return match[1]
}

export const stopSession = (shortId) => {
  const result = spawnSync('claude', ['stop', shortId], { encoding: 'utf8' })
  if (result.status != 0) throw new ProjectError(`claude stop ${shortId} 가 종료 코드 ${result.status} 로 끝났다:\n${`${result.stdout}${result.stderr}`.trim()}`)
}

// 세션 항목의 startedAt(밀리초)을 카드에 적는 ISO 8601 문자열로 바꾼다.
export const startedAt = (session) => new Date(session.startedAt).toISOString().replace(/\.\d{3}Z$/, 'Z')

// 대화 기록에서 마지막 user · assistant 줄의 type. 기록이 없으면 null.
export const lastTurnRole = (path) => {
  if (path == null) return null
  const line = readFileSync(path, 'utf8').trim().split('\n').findLast((text) => /^\{"[^"]+":/.test(text) && /"type":"(user|assistant)"/.test(text))
  return line ? JSON.parse(line).type : null
}

// 2026-10-29 실측(2.1.312, `kill -9` 시험 두 번): 데몬이 강제 종료된 백그라운드 세션을 새 pid · 새 startedAt 으로 다시 띄웠다.
// 포그라운드 도구 실행 중에 죽인 세션은 status busy 로 그 턴을 이어 갔다. 턴을 끝내고 백그라운드 작업을 기다리던 세션은
// 그 작업이 stopped 됐다는 알림을 user 줄로 받고 답하지 않은 채 status idle 로 멈췄다. 다시 뜨기 전 2초 동안은 pid · status 없이 state working 이었다.
// `claude stop` 뒤에는 pid 없이 state stopped 였다. 일을 마친 세션은 state done 이었다.
// idle 은 질문을 남기고 답을 기다리는 세션과 같아 보이므로, 다시 떴고(startedAt 이 기록과 다르다) 마지막 줄이 user 일 때만 멈춘 것으로 본다.
// 반환: live(돈다) · resume(이어 간다) · restart(stop 한 뒤 이어 간다) · pending(다시 뜨는 중) · done(끝났다).
export const classify = (session, recordedStart, lastRole) => {
  if (session == null || session.state == 'stopped') return 'resume'
  if (session.state == 'done') return 'done'
  if (session.pid == null) return 'pending'
  const respawned = recordedStart != null && startedAt(session) != recordedStart
  if (respawned && session.status == 'idle' && lastRole == 'user') return 'restart'
  return 'live'
}

// 카드의 session 을 sessions 목록과 대화 기록으로 판정한다. recover 와 board 가 같은 판정을 쓴다.
// 반환: { verdict, session, transcript }. verdict 는 classify 의 값이거나, 카드에 session 이 없으면 none.
export const cardSession = (card, sessions) => {
  const sessionId = card.data.session
  if (!sessionId) return { verdict: 'none', session: null, transcript: null }
  const session = sessions.find((item) => item.sessionId == sessionId) ?? null
  const transcript = transcriptPath(sessionId)
  return { verdict: classify(session, card.data.session_started_at, lastTurnRole(transcript)), session, transcript }
}

// 짧은 id 로 세션 항목을 찾는다. 항목의 id 와 같거나 sessionId 가 그것으로 시작하면 같은 세션으로 본다.
export const findSession = (sessions, shortId) => sessions.find((session) => session.id == shortId || session.sessionId?.startsWith(shortId)) ?? null

// 대화 기록(jsonl)의 경로. ~/.claude/projects/<프로젝트>/<sessionId>.jsonl 을 한 단계만 찾는다. 없으면 null.
export const transcriptPath = (sessionId) => {
  const base = join(homedir(), '.claude', 'projects')
  if (!existsSync(base)) return null
  const dir = readdirSync(base, { withFileTypes: true }).find((entry) => entry.isDirectory() && existsSync(join(base, entry.name, `${sessionId}.jsonl`)))
  return dir ? join(base, dir.name, `${sessionId}.jsonl`) : null
}
