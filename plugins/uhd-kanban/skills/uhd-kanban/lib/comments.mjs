// 카드 본문 끝의 `## Comments` 절을 읽고 쓴다. 코멘트 하나는 머리 줄 · 빈 줄 · 본문이다.
//   ### c<번호> [<kind>] from=<세션 이름> to=<세션 이름>[,<세션 이름>…] at=<ISO 8601 UTC>
// 번호는 카드마다 1 부터 빈 번호 없이 늘어난다. to 의 `user` 는 사용자다.

import { bareKeywordLines } from './ultracode.mjs'

export const SECTION = '## Comments'
export const USER = 'user'

const HEADER = /^### c(\d+) \[([^\]\n]+)\] from=(\S+) to=(\S+) at=(\S+)$/
const HEADER_LIKE = /^### c\d/
const NAME = /^[^\s,=\[\]]+$/

export const isName = (name) => NAME.test(name)

const trimBlank = (lines) => {
  const start = lines.findIndex((line) => line.trim() != '')
  if (start == -1) return []
  const end = lines.findLastIndex((line) => line.trim() != '')
  return lines.slice(start, end + 1)
}

// 반환: { main, comments, problems }. main 은 `## Comments` 앞의 본문이다. comments: { n, kind, from, to, at, text }.
export const parseComments = (body) => {
  const lines = body.split('\n')
  const index = lines.indexOf(SECTION)
  if (index == -1) return { main: body, comments: [], problems: [] }
  const main = lines.slice(0, index).join('\n')
  const problems = []
  const comments = []
  let current = null
  lines.slice(index + 1).forEach((line, offset) => {
    const at = `본문 ${index + offset + 2}번째 줄`
    if (line == SECTION) problems.push(`${at}: ${SECTION} 절이 두 번 있다`)
    const match = HEADER.exec(line)
    if (match) {
      const [, n, kind, from, to, time] = match
      current = { n: Number(n), kind, from, to: to.split(','), at: time, lines: [] }
      comments.push(current)
      if (current.n != comments.length) problems.push(`${at}: 코멘트 번호가 c${comments.length} 이어야 하는데 c${current.n} 이다`)
      if (Number.isNaN(Date.parse(time))) problems.push(`${at}: at 이 날짜가 아니다: ${time}`)
      if (current.to.some((name) => !isName(name))) problems.push(`${at}: to 의 이름이 비었거나 공백 · = · [ ] 이 들었다`)
      return
    }
    if (HEADER_LIKE.test(line)) problems.push(`${at}: ### c 로 시작하지만 코멘트 머리 줄 형식이 아니다`)
    if (current) current.lines.push(line)
    else if (line.trim() != '') problems.push(`${at}: ${SECTION} 아래 첫 코멘트 머리 줄 앞에 글이 있다`)
  })
  return {
    main,
    comments: comments.map(({ lines: textLines, ...rest }) => ({ ...rest, text: trimBlank(textLines).join('\n') })),
    problems,
  }
}

// 코멘트 본문으로 쓸 수 없는 것을 모은다. 비었는지 · 머리 줄로 읽힐 줄 · 감싸지 않은 ultracode.
export const textProblems = (text) => {
  const problems = []
  const lines = text.split('\n')
  if (text.trim() == '') problems.push('코멘트 본문이 비었다')
  lines.forEach((line, index) => {
    if (HEADER_LIKE.test(line)) problems.push(`${index + 1}번째 줄이 ### c 로 시작한다. 코멘트 머리 줄로 읽힌다`)
    if (line == SECTION) problems.push(`${index + 1}번째 줄이 ${SECTION} 이다`)
  })
  bareKeywordLines(text).forEach((line) => problems.push(`${line}번째 줄의 ultracode 가 감싸지 않았다. 트리거가 아니면 백틱 · [ ] · 따옴표로 감싼다`))
  return problems
}

export const formatHeader = ({ n, kind, from, to, at }) => `### c${n} [${kind}] from=${from} to=${to.join(',')} at=${at}`

// 반환: 코멘트를 덧붙인 본문. comment 의 n 은 무시하고 다음 번호를 쓴다.
export const appendComment = (body, comment) => {
  const { main, comments } = parseComments(body)
  const n = comments.length + 1
  const entries = [...comments, { ...comment, n }].map((item) => `${formatHeader(item)}\n\n${item.text}`)
  return { body: `${main.replace(/\n*$/, '')}\n\n${SECTION}\n\n${entries.join('\n\n')}\n`, n }
}
