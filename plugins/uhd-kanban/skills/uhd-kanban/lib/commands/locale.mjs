// 이 디렉터리에서 쓸 출력 언어를 stdout 에 한 줄로 낸다. 보드 모니터 mod 가 pane 의 글을 고를 때 부른다.
// 정하는 규칙은 i18n.mjs 가 갖는다(보드 config.json 의 locale, 없으면 환경 변수). mod 가 같은 규칙을 다시 쓰지 않으려는 것이다.
// uhd-kanban locale

import { LOCALE } from '../i18n.mjs'

// 받는 플래그와 위치 인자 수(lib/args.mjs 의 parseArgs).
export const ARGS = { flags: {}, positional: 0 }

export const run = async () => {
  console.log(LOCALE)
  return 0
}
