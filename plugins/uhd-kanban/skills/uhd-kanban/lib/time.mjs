// 카드 · main.json 에 적는 시각 형식(초 단위 UTC ISO 8601, 끝이 Z)과 날짜 계산 상수를 갖는다.
// 다른 lib 모듈을 import 하지 않는다(i18n.mjs 도 import 하지 않는다).

// value 는 Date 생성자가 받는 값(밀리초 수 · 문자열)이다. 잘못된 날짜면 toISOString 이 RangeError 를 던진다.
export const isoSeconds = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z')

export const now = () => isoSeconds(Date.now())

export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS

// ISO 8601 문자열을 밀리초 수로 바꾼다. 없거나 읽을 수 없으면 null.
export const timeOf = (text) => {
  const ms = Date.parse(text ?? '')
  return Number.isNaN(ms) ? null : ms
}
