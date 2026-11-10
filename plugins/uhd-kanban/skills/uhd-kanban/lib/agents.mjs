// `claude agents --json` 의 출력을 읽는다. 검증과 메시지는 부르는 쪽이 정한다.
// 메시지를 내지 않는다. root.mjs 가 i18n.mjs 보다 먼저 이 모듈을 부르기 때문이다(i18n.mjs 가 root.mjs 로 보드의 locale 을 읽는다).

import { execFileSync } from 'node:child_process'

// all 이면 끝난 백그라운드 세션까지 낸다(`--all`).
export const readAgents = ({ all = false } = {}) => JSON.parse(execFileSync('claude', ['agents', '--json', ...(all ? ['--all'] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
