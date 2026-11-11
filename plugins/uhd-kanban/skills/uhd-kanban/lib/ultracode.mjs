// 카드 본문은 세션 프롬프트로 쓰인다. 감싸지 않은 낱말 `ultracode` 는 ultracodeKeywordTrigger 로 그 턴을 Workflow 로 바꾼다.
// 2026-10-29 실측(Claude Code 2.1.312 · `claude --bg` · sonnet): 첫 줄 · 문장 중간 · 줄 끝의 감싸지 않은 낱말은 트리거가 걸렸고,
// 백틱 · [ ] · " " · ' ' 로 감싼 낱말은 걸리지 않았다. 대소문자 · 다른 낱말 안(ultracodeKeywordTrigger) · 코드 블록 안은 재지 않았으므로 감싸지 않은 것으로 센다.
// 규칙: 트리거로 쓰는 낱말은 본문 첫 줄에 `ultracode` 한 줄로만 둔다. 다른 자리의 낱말은 감싼다.

const TRIGGER_LINE = 'ultracode'

const WORD = /ultracode/gi
const PAIRS = [['[', ']'], ['"', '"'], ["'", "'"]]

// 카드 본문의 줄. 앞의 빈 줄은 \n 만 지운다(공백만 있는 줄은 남는다).
const bodyLines = (body) => body.replace(/^\n+/, '').split('\n')
const isTriggerLine = (line) => line.trim() == TRIGGER_LINE

const isWrapped = (line, start, end) => {
  const ticks = [...line.slice(0, start)].filter((ch) => ch == '`').length
  if (ticks % 2 == 1 && line.indexOf('`', end) != -1) return true
  return PAIRS.some(([open, close]) => line[start - 1] == open && line[end] == close)
}

// 반환: 감싸지 않은 낱말이 있는 줄 번호(1부터).
const keywordLines = (lines) => lines.flatMap((line, index) => {
  const bare = [...line.matchAll(WORD)].some((match) => !isWrapped(line, match.index, match.index + match[0].length))
  return bare ? [index + 1] : []
})

export const bareKeywordLines = (text) => keywordLines(text.split('\n'))

// 카드 본문용. 줄 번호는 앞의 빈 줄을 지운 본문 기준으로 센다. 첫 줄이 정확히 TRIGGER_LINE 이면 그 줄은 빼고 센다.
export const bareBodyKeywordLines = (body) => {
  const lines = bodyLines(body)
  return keywordLines(lines).filter((number) => number != 1 || !isTriggerLine(lines[0]))
}

export const hasTriggerLine = (body) => isTriggerLine(bodyLines(body)[0])
