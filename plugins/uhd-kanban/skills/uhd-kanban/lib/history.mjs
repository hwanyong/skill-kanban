// 카드 frontmatter 의 status_history: 카드가 열에 들어간 시각과 그 열의 status 를 차례대로 적은 목록이다.
// frontmatter.mjs 가 받는 값은 스칼라와 스칼라 목록뿐이라 항목 하나를 문자열 `<ISO 8601 UTC> <status>` 로 적는다.
// 적는 곳은 uk new(첫 항목)와 cards.mjs 의 moveCard(열이 바뀔 때) 두 곳이다. 이 키보다 먼저 만든 카드에는 키가 없다.

export const HISTORY_KEY = 'status_history'

const ENTRY = /^(\S+Z) ([a-z][a-z0-9-]*)$/

export const historyEntry = (at, status) => `${at} ${status}`

// data 에 status 로 들어간 항목을 덧붙인 새 목록. 키가 없던 카드는 이 항목부터 시작한다.
export const appendStatus = (data, status, at) => [...(Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : []), historyEntry(at, status)]

// 반환: { entries: [{ at, status }], problems: [{ index, value }] }. 형식이 틀린 항목은 entries 에서 빼고 problems 에 넣는다.
export const parseHistory = (data) => {
  const list = data[HISTORY_KEY]
  if (list == null) return { entries: [], problems: [] }
  if (!Array.isArray(list)) return { entries: [], problems: [{ index: null, value: list }] }
  return list.reduce((result, value, index) => {
    const match = typeof value == 'string' ? ENTRY.exec(value) : null
    if (!match || Number.isNaN(Date.parse(match[1]))) return { ...result, problems: [...result.problems, { index, value }] }
    return { ...result, entries: [...result.entries, { at: match[1], status: match[2] }] }
  }, { entries: [], problems: [] })
}
