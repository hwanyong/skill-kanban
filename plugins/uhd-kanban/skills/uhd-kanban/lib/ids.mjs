// config.json 의 status · type · comments.kinds · archive.dir · 열 dir 의 이름 부분, profiles.json 의 프로필 이름,
// status_history 항목의 status 가 따르는 id 규칙(영소문자 · 숫자 · -, 영소문자로 시작).
// 사람에게 보이는 설명은 messages/<locale>.mjs 의 config.columnStatus 등이 같은 규칙으로 적는다.

// 다른 정규식 안에 끼워 쓰는 소스.
export const ID_PATTERN = '[a-z][a-z0-9-]*'

// 플래그를 붙이지 않는다. g 를 붙이면 lastIndex 가 남아 여러 곳에서 같은 객체를 쓸 수 없다.
export const ID = new RegExp(`^${ID_PATTERN}$`)
