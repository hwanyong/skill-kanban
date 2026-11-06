// `claude agents --json` 으로 이 Mac 에서 도는 Claude Code 세션 목록을 읽는다.
// 2026-10-29 실측(2.1.312): 항목마다 pid · id(짧은 id) · cwd · kind · startedAt · sessionId · name · status · state 가 있다. pid · status 는 프로세스가 있을 때만 있다.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { t } from './i18n.mjs'
import { ProjectError, UNLIMITED, maxParallel } from './project.mjs'

// all 이면 끝난 백그라운드 세션까지 낸다(`--all`).
export const listSessions = ({ all = false } = {}) => {
  const text = execFileSync('claude', ['agents', '--json', ...(all ? ['--all'] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const sessions = JSON.parse(text)
  if (!Array.isArray(sessions)) throw new ProjectError(t('sessions.notArray'))
  return sessions
}

// 이 프로세스를 띄운 세션의 이름. CLAUDE_CODE_SESSION_ID 가 없거나 목록에 없으면 null.
export const currentSessionName = (sessions) => {
  const id = process.env.CLAUDE_CODE_SESSION_ID
  if (!id) return null
  return sessions.find((session) => session.sessionId == id)?.name ?? null
}

// run · recover 가 띄우는 세션은 모두 권한 확인 없이 돈다(2026-10-29 사용자 지시). 카드 세션은 백그라운드라 확인 창에 답할 사람이 없다.
// 2026-10-29 실측(2.1.312): `claude --bg --dangerously-skip-permissions` 로 띄운 세션의 대화 기록에 permissionMode bypassPermissions 가 적혔다.
export const BACKGROUND_ARGS = ['--bg', '--dangerously-skip-permissions']

// `claude --bg` 를 실행하고 세션의 짧은 id 를 돌려준다. 2026-10-29 실측: stdout 에 `claude stop <짧은 id>` 줄이 있다.
// 띄우지 못하면(예: `Workspace not trusted`) stdout · stderr 를 오류 메시지에 그대로 넣는다.
// 프롬프트는 `--` 뒤에 둔다. 카드 본문이 `-` 로 시작하면(마크다운 목록) claude 가 그 줄을 옵션으로 읽는다.
export const launchBackground = (args, prompt, cwd) => {
  const result = spawnSync('claude', [...BACKGROUND_ARGS, ...args, '--', prompt], { cwd, encoding: 'utf8' })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  const match = /claude stop (\S+)/.exec(output)
  if (result.status != 0 || !match) throw new ProjectError(t('sessions.launchFailed', { status: result.status, output }))
  return match[1]
}

export const stopSession = (shortId) => {
  const result = spawnSync('claude', ['stop', shortId], { encoding: 'utf8' })
  if (result.status != 0) throw new ProjectError(t('sessions.stopFailed', { shortId, status: result.status, output: `${result.stdout}${result.stderr}`.trim() }))
}

// 세션 항목의 startedAt(밀리초)을 카드에 적는 ISO 8601 문자열로 바꾼다.
export const startedAt = (session) => new Date(session.startedAt).toISOString().replace(/\.\d{3}Z$/, 'Z')

// 대화 기록의 마지막 user · assistant 줄. role 은 그 줄의 type, cwd 는 그 줄의 cwd(세션이 그때 일하던 디렉터리)다.
// toolPending 은 그 줄이 assistant 이고 stop_reason 이 tool_use 인가다. 도구 호출을 냈는데 결과(tool_result 의 user 줄)가 아직 없다는 뜻이다.
// 2026-11-05 실측(2.1.318): 한 메시지의 thinking · text · tool_use 블록이 줄마다 나뉘어 적히고 세 줄 모두 같은 stop_reason 을 갖는다.
// 턴을 끝내고 사람을 기다리는 메시지는 stop_reason end_turn 이다. 기록이 없으면 role · cwd 는 null, toolPending 은 false 다.
// 2026-11-05 실측(2.1.318): `claude -w` 로 worktree 에서 돈 세션이 pid 없이 state failed 가 되면 claude agents --json 의 cwd 는 저장소 root 였다.
// worktree 경로는 대화 기록 줄의 cwd 에만 남았다. 그래서 recover 는 이 cwd 에서 `claude --bg --resume` 을 실행한다.
export const lastTurn = (path) => {
  const empty = { role: null, cwd: null, toolPending: false }
  if (path == null) return empty
  const line = readFileSync(path, 'utf8').trim().split('\n').findLast((text) => /^\{"[^"]+":/.test(text) && /"type":"(user|assistant)"/.test(text))
  if (!line) return empty
  const { type, cwd, message } = JSON.parse(line)
  return { role: type, cwd: cwd ?? null, toolPending: type == 'assistant' && message?.stop_reason == 'tool_use' }
}

// 2026-10-29 실측(2.1.312, `kill -9` 시험 두 번): 데몬이 강제 종료된 백그라운드 세션을 새 pid · 새 startedAt 으로 다시 띄웠다.
// 포그라운드 도구 실행 중에 죽인 세션은 status busy 로 그 턴을 이어 갔다. 턴을 끝내고 백그라운드 작업을 기다리던 세션은
// 그 작업이 stopped 됐다는 알림을 user 줄로 받고 답하지 않은 채 status idle 로 멈췄다. 다시 뜨기 전 2초 동안은 pid · status 없이 state working 이었다.
// `claude stop` 뒤에는 pid 없이 state stopped 였다. 일을 마친 세션은 state done 이었다.
// idle 은 질문을 남기고 답을 기다리는 세션과 같아 보이므로, 다시 떴고(startedAt 이 기록과 다르다) 마지막 줄이 user 이거나 결과 없는 도구 호출일 때만 멈춘 것으로 본다.
// 답을 기다리는 세션의 마지막 줄은 stop_reason end_turn 인 assistant 줄이라 둘 다 아니다.
// 2026-11-05 Mac Studio 재부팅(2.1.318): 카드 세션 k91 이 pid 없이 state failed 로 남았다. 실행 파일에서 읽은 조건은 이렇다. 데몬이 다시 떴을 때
// 세션 프로세스가 없으면 state failed(detail "process gone while supervisor was down")로 적고, ~/.claude/jobs/<짧은 id>/state.json 에 reapedMidWorkAt 을 적는다.
// 마지막 갱신이 48시간(172800000 ms)보다 오래됐으면 failed 대신 stopped 로 적는다. 이 세션에 `claude stop` 을 실행해도 state 는 failed 그대로였다.
// claude agents --json 은 detail · reapedMidWorkAt 을 내지 않으므로 pid 없는 state failed 를 모두 이어 갈 세션으로 본다.
// 실행 파일에는 데몬이 세션을 다시 띄우는 동안 state failed 를 적는 분기(detail 끝의 "; respawning")도 있다. 그 동안 recover 가 띄우면 같은 대화의 세션이 둘이 된다. 이 분기의 길이는 재지 않았다.
// 같은 날 k91 은 `claude --bg --resume` 으로 새 세션 e831a4dd 를 16:09:50Z 에 띄운 뒤, 16:35:42Z 에 원래 세션 c5fe7506 이 새 pid 로 다시 떴다.
// 두 세션이 같은 worktree 를 cwd 로 함께 돌았다. 무엇이 c5fe7506 을 다시 띄웠는지는 확인하지 못했다.
// 재부팅 재현(2.1.318): CLAUDE_CONFIG_DIR 를 따로 준 데몬에서 도구 실행 중인 세션과 데몬을 함께 SIGKILL 하고 데몬을 다시 띄우자 k91 과 같이 state failed · reapedMidWorkAt 이 됐다.
// `claude respawn <짧은 id>` 는 같은 session id · 같은 worktree 로 띄웠지만, 끊긴 도구 호출을 다시 하지 않고 status idle 로 3분 넘게 남았다. 프롬프트를 줄 수 없어 recover 는 쓰지 않는다.
// k91 의 c5fe7506 도 다시 뜬 뒤 status idle 이었고, 대화 기록의 마지막 줄은 재부팅 전(10:20:17Z)의 assistant Bash tool_use 였다. 다시 뜬 뒤에는 줄이 더해지지 않았다.
// 그래서 다시 뜬 세션이 idle 이고 마지막 줄이 결과 없는 도구 호출이면 restart 다(2026-11-05 사용자 결정).
// 반환: live(돈다) · resume(이어 간다) · restart(stop 한 뒤 이어 간다) · pending(다시 뜨는 중) · done(끝났다) · unknown(아래 표에 없는 state).
// pid 가 없고 stopped · done 이 아닌 세션의 state 마다 판정. 표에 없는 값은 unknown 이다. Claude Code 가 새 state 를 쓰기 시작하면 pending 처럼 기다리지 않고 그 값을 그대로 보이게 한다.
const EXITED_VERDICTS = { failed: 'resume', working: 'pending' }

// turn 은 lastTurn 의 값이다.
export const classify = (session, recordedStart, turn) => {
  if (session == null || session.state == 'stopped') return 'resume'
  if (session.state == 'done') return 'done'
  if (session.pid == null) return EXITED_VERDICTS[session.state] ?? 'unknown'
  const respawned = recordedStart != null && startedAt(session) != recordedStart
  if (respawned && session.status == 'idle' && (turn.role == 'user' || turn.toolPending)) return 'restart'
  return 'live'
}

// 카드의 session 을 sessions 목록과 대화 기록으로 판정한다. recover 와 board 가 같은 판정을 쓴다.
// 반환: { verdict, session, transcript, cwd, toolPending }. verdict 는 classify 의 값이거나, 카드에 session 이 없으면 none. toolPending 은 lastTurn 의 값이다.
// cwd 는 대화 기록의 마지막 cwd 이고, 그 디렉터리가 없으면(worktree 를 지웠다) null 이다.
export const cardSession = (card, sessions) => {
  const sessionId = card.data.session
  if (!sessionId) return { verdict: 'none', session: null, transcript: null, cwd: null, toolPending: false }
  const session = sessions.find((item) => item.sessionId == sessionId) ?? null
  const transcript = transcriptPath(sessionId)
  const turn = lastTurn(transcript)
  const cwd = turn.cwd != null && existsSync(turn.cwd) ? turn.cwd : null
  return { verdict: classify(session, card.data.session_started_at, turn), session, transcript, cwd, toolPending: turn.toolPending }
}

// 프로세스가 있거나 다시 뜨는 중인 판정. run.max_parallel 이 세는 것과 run 이 새로 띄우지 않는 것이 이 판정이다.
// restart(멈춤)도 프로세스가 남아 있고 recover 가 같은 카드의 세션으로 바꿔 띄우므로 센다.
// unknown 도 센다(2026-11-05 사용자 결정 「보수적으로 자리 차지」). 그 state 가 아직 도는 세션인지 알 수 없으므로, 사람이 정하기 전에는 자리를 비우지 않고 같은 카드를 run 으로 다시 띄우지도 않는다.
export const RUNNING_VERDICTS = ['live', 'pending', 'restart', 'unknown']

// run.status 열에서 세션이 도는 카드. sessions 는 listSessions({ all: true }) 의 값이다.
export const runningCards = (project, board, sessions) =>
  board.cards.filter((card) => card.status == project.config.run.status && RUNNING_VERDICTS.includes(cardSession(card, sessions).verdict))

// 도는 카드가 running 개일 때 하나를 더 띄울 수 있는가.
export const hasRoom = (project, running) => maxParallel(project.config) == UNLIMITED || running < maxParallel(project.config)

// 짧은 id 로 세션 항목을 찾는다. 항목의 id 와 같거나 sessionId 가 그것으로 시작하면 같은 세션으로 본다.
export const findSession = (sessions, shortId) => sessions.find((session) => session.id == shortId || session.sessionId?.startsWith(shortId)) ?? null

// Claude Code 의 설정 디렉터리. CLAUDE_CONFIG_DIR 가 있으면 그 값이고 없으면 ~/.claude 다. 대화 기록 · jobs 가 그 아래에 있다.
export const claudeConfigDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

// 대화 기록(jsonl)의 경로. <설정 디렉터리>/projects/<프로젝트>/<sessionId>.jsonl 을 한 단계만 찾는다. 없으면 null.
export const transcriptPath = (sessionId) => {
  const base = join(claudeConfigDir(), 'projects')
  if (!existsSync(base)) return null
  const dir = readdirSync(base, { withFileTypes: true }).find((entry) => entry.isDirectory() && existsSync(join(base, entry.name, `${sessionId}.jsonl`)))
  return dir ? join(base, dir.name, `${sessionId}.jsonl`) : null
}
