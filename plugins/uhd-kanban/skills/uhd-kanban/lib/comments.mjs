// 카드 본문 끝의 `## Comments` 절을 읽고 쓴다. 코멘트 하나는 머리 줄 · 빈 줄 · 본문이다.
//   ### c<번호> [<kind>] from=<세션 이름> to=<세션 이름>[,<세션 이름>…] at=<ISO 8601 UTC>
// 번호는 카드마다 1 부터 빈 번호 없이 늘어난다. to 의 `user` 는 사용자다.

import { t } from './i18n.mjs'
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
    const at = t('comments.bodyLine', { line: index + offset + 2 })
    if (line == SECTION) problems.push(t('comments.sectionTwice', { at, section: SECTION }))
    const match = HEADER.exec(line)
    if (match) {
      const [, n, kind, from, to, time] = match
      current = { n: Number(n), kind, from, to: to.split(','), at: time, lines: [] }
      comments.push(current)
      if (current.n != comments.length) problems.push(t('comments.number', { at, expected: comments.length, actual: current.n }))
      if (Number.isNaN(Date.parse(time))) problems.push(t('comments.badTime', { at, time }))
      if (current.to.some((name) => !isName(name))) problems.push(t('comments.badTo', { at }))
      return
    }
    if (HEADER_LIKE.test(line)) problems.push(t('comments.headerLike', { at }))
    if (current) current.lines.push(line)
    else if (line.trim() != '') problems.push(t('comments.textBeforeFirst', { at, section: SECTION }))
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
  if (text.trim() == '') problems.push(t('comments.emptyText'))
  lines.forEach((line, index) => {
    if (HEADER_LIKE.test(line)) problems.push(t('comments.textHeaderLike', { line: index + 1 }))
    if (line == SECTION) problems.push(t('comments.textSection', { line: index + 1, section: SECTION }))
  })
  bareKeywordLines(text).forEach((line) => problems.push(t('comments.bareKeyword', { line })))
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

// `## Comments` 아래 머리 줄의 kind 를 map(이전 kind → 새 kind)대로 바꾼다. 본문(`## Comments` 앞)과 코멘트 본문의 줄은 바꾸지 않는다.
// 머리 줄만 바꾸므로 frontmatter 를 포함한 카드 파일 전체를 받아도 된다. frontmatter 에는 `## Comments` 줄이 없다.
// 반환: { body, count, kinds }. count 는 바꾼 머리 줄 수, kinds 는 바꾼 뒤 머리 줄에 남은 kind 다.
export const renameKinds = (body, map) => {
  const lines = body.split('\n')
  const index = lines.indexOf(SECTION)
  if (index == -1) return { body, count: 0, kinds: [] }
  let count = 0
  const kinds = new Set()
  const renamed = lines.map((line, at) => {
    const match = at > index ? HEADER.exec(line) : null
    if (!match) return line
    const kind = Object.hasOwn(map, match[2]) ? map[match[2]] : match[2]
    kinds.add(kind)
    if (kind == match[2]) return line
    count += 1
    return formatHeader({ n: Number(match[1]), kind, from: match[3], to: match[4].split(','), at: match[5] })
  })
  return { body: renamed.join('\n'), count, kinds: [...kinds] }
}
