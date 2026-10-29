// 명령줄 인자를 { positional, flags } 로 나눈다. `--name value` · `--name=value` · 값 없는 `--name`(true) 을 받는다.

import { t } from './i18n.mjs'

export class UsageError extends Error {}

// `k457` · `457` 을 정수 id 로 바꾼다.
export const cardId = (ref, name = t('args.cardIdName')) => {
  const id = Number(String(ref ?? '').replace(/^k/, ''))
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(t('args.cardId', { name, ref }))
  return id
}

// --top · --bottom · --before <id> · --after <id> 중 하나를 읽는다. 없으면 fallback 을 쓴다.
export const positionFrom = (flags, fallback = { bottom: true }) => {
  const given = ['top', 'bottom', 'before', 'after'].filter((key) => flags[key] != null)
  if (given.length > 1) throw new UsageError(t('args.onePosition', { flags: given.map((key) => `--${key}`) }))
  if (given.length == 0) return fallback
  const [key] = given
  if (key == 'top' || key == 'bottom') return { [key]: true }
  return { [key]: cardId(flags[key], `--${key}`) }
}

// 쉼표로 나눈 목록. 빈 항목은 버린다.
export const listFrom = (value) => (typeof value == 'string' ? value.split(',').map((item) => item.trim()).filter((item) => item != '') : [])

export const parseArgs = (argv) => {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s)
    const next = argv[i + 1]
    if (inline != null) flags[key] = inline
    else if (next != null && !next.startsWith('--')) {
      flags[key] = next
      i += 1
    } else flags[key] = true
  }
  return { positional, flags }
}
