// `claude agents --json` 의 출력을 읽는다. 검증과 메시지는 부르는 쪽이 정한다.
// 메시지를 내지 않는다. root.mjs 가 i18n.mjs 보다 먼저 이 모듈을 부르기 때문이다(i18n.mjs 가 root.mjs 로 보드의 locale 을 읽는다).

import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

// all 이면 끝난 백그라운드 세션까지 낸다(`--all`).
export const readAgents = ({ all = false } = {}) => JSON.parse(execFileSync('claude', ['agents', '--json', ...(all ? ['--all'] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))

// Claude Code 의 설정 디렉터리. CLAUDE_CONFIG_DIR 가 있으면 그 값이고 없으면 ~/.claude 다. 대화 기록 · jobs 가 그 아래에 있다.
export const claudeConfigDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

// 이 CLI 를 부른 세션의 id. Claude Code 가 Bash 에 넣고, pane 은 $.process.run 의 env 로 넣는다.
export const callerSessionId = () => process.env.CLAUDE_CODE_SESSION_ID

// `claude agents --json` 의 항목을 전체 session id 로 찾는다. 없으면 null. 짧은 id 로 찾는 것은 sessions.mjs 의 findSession 이다.
export const sessionById = (sessions, id) => sessions.find((session) => session.sessionId == id) ?? null
