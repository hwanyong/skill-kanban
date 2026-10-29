// 카드 본문은 세션 프롬프트로 쓰인다. 감싸지 않은 낱말 `ultracode` 는 ultracodeKeywordTrigger 로 그 턴을 Workflow 로 바꾼다.
// 2026-10-29 실측(Claude Code 2.1.312 · `claude --bg` · sonnet): 첫 줄 · 문장 중간 · 줄 끝의 감싸지 않은 낱말은 트리거가 걸렸고,
// 백틱 · [ ] · " " · ' ' 로 감싼 낱말은 걸리지 않았다. 대소문자 · 다른 낱말 안(ultracodeKeywordTrigger) · 코드 블록 안은 재지 않았으므로 감싸지 않은 것으로 센다.
// 규칙: 트리거로 쓰는 낱말은 본문 첫 줄에 `ultracode` 한 줄로만 둔다. 다른 자리의 낱말은 감싼다.

export const TRIGGER_LINE = 'ultracode'

const WORD = /ultracode/gi
const PAIRS = [['[', ']'], ['"', '"'], ["'", "'"]]

const isWrapped = (line, start, end) => {
  const ticks = [...line.slice(0, start)].filter((ch) => ch == '`').length
  if (ticks % 2 == 1 && line.indexOf('`', end) != -1) return true
  return PAIRS.some(([open, close]) => line[start - 1] == open && line[end] == close)
}

// 반환: 감싸지 않은 낱말이 있는 줄 번호(1부터). firstLineAllowed 면 첫 줄이 정확히 TRIGGER_LINE 일 때 그 줄은 빼고 센다.
export const bareKeywordLines = (text, { firstLineAllowed = false } = {}) => text.split('\n').flatMap((line, index) => {
  if (firstLineAllowed && index == 0 && line.trim() == TRIGGER_LINE) return []
  const bare = [...line.matchAll(WORD)].some((match) => !isWrapped(line, match.index, match.index + match[0].length))
  return bare ? [index + 1] : []
})

export const hasTriggerLine = (body) => body.replace(/^\n+/, '').split('\n')[0].trim() == TRIGGER_LINE
