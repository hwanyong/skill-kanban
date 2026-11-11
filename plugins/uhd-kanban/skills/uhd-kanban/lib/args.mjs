// 명령줄 인자를 { positional, flags } 로 나눈다. `--name value` · `--name=value` · 값 없는 `--name`(true) 을 받는다.
// SWITCHES 의 플래그는 다음 토큰을 값으로 읽지 않는다. 그래서 `--force k1` 의 k1 은 위치 인자다.

import { readFileSync } from 'node:fs'
import { t } from './i18n.mjs'
import { ProjectError } from './errors.mjs'

export class UsageError extends Error {}

// `k457` · `457` 을 정수 id 로 바꾼다. 지수 · 16진수 · 공백 · 소수점 표기는 받지 않는다.
export const cardId = (ref, name = t('args.cardIdName')) => {
  const match = /^k?(\d+)$/.exec(String(ref ?? ''))
  const id = match == null ? 0 : Number(match[1])
  if (id <= 0) throw new UsageError(t('args.cardId', { name, ref }))
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

// parseArgs 는 값 없는 `--name` 을 true 로 적으므로 문자열일 때만 값으로 본다. 아니면 null.
export const stringFlag = (flags, name) => (typeof flags[name] == 'string' ? flags[name] : null)

// `--body-file` · `--text-file` 의 파일을 읽는다. 읽지 못하면 Node 스택 대신 한 줄 오류로 끝낸다(종료 코드 1).
export const readFlagFile = (flags, name) => {
  try {
    return readFileSync(flags[name], 'utf8')
  } catch (error) {
    throw new ProjectError(t('args.readFile', { flag: `--${name}`, path: flags[name], message: error.message }))
  }
}

// 값을 받지 않는 불 값 플래그. parseArgs 가 다음 토큰을 값으로 먹지 않는다. 새 불 값 플래그를 더하면 이 집합에도 함께 적는다.
const SWITCHES = new Set(['force', 'dry-run', 'all', 'json', 'top', 'bottom'])

// `--name k1,k2` 를 정수 id 목록으로 바꾼다.
export const idsFrom = (flags, name) => listFrom(flags[name]).map((ref) => cardId(ref, `--${name}`))

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
    else if (SWITCHES.has(key)) flags[key] = true
    else if (next != null && !next.startsWith('--')) {
      flags[key] = next
      i += 1
    } else flags[key] = true
  }
  return { positional, flags }
}
