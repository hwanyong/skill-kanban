// 카드 frontmatter 의 YAML 부분 집합을 읽고 쓴다.
// 받는 값: 정수 · 불리언 · null(빈 값) · 문자열(따옴표 없는 것 · JSON 형식 큰따옴표) · 위 스칼라의 목록(`[a, b]` · `- a`).
// 그 밖의 YAML(중첩 맵 · 여러 줄 스칼라 · 앵커)은 줄 번호와 함께 FrontmatterError 로 거절한다.
// 쓰는 쪽(serialize)은 읽는 쪽이 같은 값으로 되읽는 형태만 낸다: parse(serialize(d)).data 는 d 와 같다.

import { t } from './i18n.mjs'

export class FrontmatterError extends Error {
  constructor(message, line) {
    super(line == null ? message : t('frontmatter.atLine', { line, message }))
    this.line = line
  }
}

const KEY = /^([a-z_][a-z0-9_]*):(?:\s+(.*))?$/
const INTEGER = /^-?(0|[1-9]\d*)$/
const NEEDS_QUOTE = /^[\s\-?:,\[\]{}#&*!|>'"%@`]|[:#]\s|\s#|:$|\s$|^$|[\u0000-\u001f\u007f]/

const parseScalar = (raw, line) => {
  const text = raw.trim()
  if (text == '' || text == 'null' || text == '~') return null
  if (text == 'true') return true
  if (text == 'false') return false
  if (INTEGER.test(text)) return Number(text)
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text)
    } catch {
      throw new FrontmatterError(t('frontmatter.badQuoted', { text }), line)
    }
  }
  if (/^[\[\]{}'&*!|>%@`]/.test(text)) throw new FrontmatterError(t('frontmatter.unsupported', { text }), line)
  return text
}

// 큰따옴표 안의 쉼표를 나누지 않도록 문자 단위로 읽는다.
const splitInline = (inner, line) => {
  const items = []
  let current = ''
  let quoted = false
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i]
    if (quoted && ch == '\\') {
      current += ch + (inner[i + 1] ?? '')
      i += 1
      continue
    }
    if (ch == '"') quoted = !quoted
    if (ch == ',' && !quoted) {
      items.push(current)
      current = ''
      continue
    }
    current += ch
  }
  if (quoted) throw new FrontmatterError(t('frontmatter.unclosedQuote'), line)
  if (current.trim() != '' || items.length > 0) items.push(current)
  return items.map((item) => {
    if (item.trim() == '') throw new FrontmatterError(t('frontmatter.emptyItem'), line)
    return parseScalar(item, line)
  })
}

const parseValue = (raw, line) => {
  const text = raw.trim()
  if (!text.startsWith('[')) return parseScalar(text, line)
  if (!text.endsWith(']')) throw new FrontmatterError(t('frontmatter.listEnd', { text }), line)
  return splitInline(text.slice(1, -1), line)
}

// text 는 카드 파일 전체다. 첫 줄이 `---` 이고 다음 `---` 줄까지가 frontmatter 다.
export const parse = (text) => {
  const lines = text.split('\n')
  if (lines[0] != '---') throw new FrontmatterError(t('frontmatter.noStart'), 1)
  const end = lines.indexOf('---', 1)
  if (end == -1) throw new FrontmatterError(t('frontmatter.noEnd'), 1)
  const data = {}
  let listKey = null
  for (let i = 1; i < end; i += 1) {
    const line = i + 1
    const row = lines[i]
    if (row.trim() == '' || row.trimStart().startsWith('#')) continue
    const item = row.match(/^\s+-\s+(.*)$/) ?? row.match(/^-\s+(.*)$/)
    if (item) {
      if (listKey == null) throw new FrontmatterError(t('frontmatter.itemWithoutKey'), line)
      data[listKey].push(parseScalar(item[1], line))
      continue
    }
    const pair = row.match(KEY)
    if (!pair) throw new FrontmatterError(t('frontmatter.notPair', { row }), line)
    const [, key, rest] = pair
    if (Object.hasOwn(data, key)) throw new FrontmatterError(t('frontmatter.duplicateKey', { key }), line)
    if (rest == null || rest.trim() == '') {
      const next = lines[i + 1] ?? ''
      const opensList = i + 1 < end && /^\s*-\s/.test(next)
      data[key] = opensList ? [] : null
      listKey = opensList ? key : null
      continue
    }
    data[key] = parseValue(rest, line)
    listKey = null
  }
  const body = lines.slice(end + 1).join('\n')
  return { data, body }
}

const formatScalar = (value) => {
  if (value == null) return ''
  if (typeof value == 'boolean') return String(value)
  if (typeof value == 'number') {
    if (!Number.isInteger(value)) throw new FrontmatterError(t('frontmatter.notInteger', { value }))
    return String(value)
  }
  if (typeof value != 'string') throw new FrontmatterError(t('frontmatter.notScalar', { value: JSON.stringify(value) }))
  const ambiguous = INTEGER.test(value) || ['true', 'false', 'null', '~'].includes(value)
  return ambiguous || NEEDS_QUOTE.test(value) ? JSON.stringify(value) : value
}

// 목록 안 문자열은 쉼표 · ] · 큰따옴표도 따옴표로 감싸야 되읽을 때 나뉘지 않는다.
const formatListItem = (value) => {
  const text = formatScalar(value)
  return typeof value == 'string' && !text.startsWith('"') && /[,\]"]/.test(value) ? JSON.stringify(value) : text
}

// keyOrder 에 있는 키를 그 순서로 먼저 쓰고, 나머지 키는 이름순으로 쓴다. 값이 undefined 인 키는 쓰지 않는다.
export const serialize = (data, keyOrder = []) => {
  const keys = [...keyOrder.filter((key) => Object.hasOwn(data, key)), ...Object.keys(data).filter((key) => !keyOrder.includes(key)).sort()]
  const rows = keys.filter((key) => data[key] !== undefined).map((key) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(key)) throw new FrontmatterError(t('frontmatter.badKey', { key }))
    const value = data[key]
    if (!Array.isArray(value)) return `${key}: ${formatScalar(value)}`.trimEnd()
    return `${key}: [${value.map(formatListItem).join(', ')}]`
  })
  return ['---', ...rows, '---'].join('\n')
}
