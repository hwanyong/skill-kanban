// 명령줄 인자를 { positional, flags, help } 로 나눈다. 명령마다 lib/commands/<명령>.mjs 의 ARGS 가 받는 플래그와 위치 인자 수를 정한다.
// ARGS 에 없는 플래그 · 넘치는 위치 인자는 명령을 실행하기 전에 UsageError(종료 코드 2)로 멈춘다.
// 2026-11-27 doghoodie-ios 에서 `uk archive --help` 가 모르는 플래그를 무시하고 카드 297장을 보관했다(doghoodie-main 보고).

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

// ARGS.flags 의 값. SWITCH 는 값을 받지 않는다(`--force k1` 의 k1 은 위치 인자다). VALUE 는 값이 꼭 있어야 하고, OPTIONAL 은 값이 없으면 true 다.
export const SWITCH = 'switch'
export const VALUE = 'value'
export const OPTIONAL = 'optional'

// positionFrom 이 읽는 플래그. 자리를 받는 명령의 ARGS.flags 에 펼쳐 넣는다.
export const POSITION_FLAGS = { top: SWITCH, bottom: SWITCH, before: VALUE, after: VALUE }

// 이 토큰이 하나라도 있으면 명령을 실행하지 않고 사용법만 낸다. 값 자리의 `-h`(`--title -h`)도 도움말로 보는데, 그 쪽이 아무것도 바꾸지 않는 쪽이다.
const HELP = new Set(['--help', '-h'])
export const wantsHelp = (argv) => argv.some((arg) => HELP.has(arg))

// `--name k1,k2` 를 정수 id 목록으로 바꾼다.
export const idsFrom = (flags, name) => listFrom(flags[name]).map((ref) => cardId(ref, `--${name}`))

// spec 은 명령의 ARGS = { flags: { <이름>: SWITCH | VALUE | OPTIONAL }, positional: <최대 개수> } 다.
export const parseArgs = (argv, spec) => {
  if (wantsHelp(argv)) return { positional: [], flags: {}, help: true }
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (/^-[A-Za-z]/.test(arg)) throw new UsageError(t('args.unknownFlag', { flag: arg }))
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const [key, inline] = arg.slice(2).split(/=(.*)/s)
    const kind = Object.hasOwn(spec.flags, key) ? spec.flags[key] : null
    if (kind == null) throw new UsageError(t('args.unknownFlag', { flag: `--${key}` }))
    // `--dry-run=false` 를 받으면 flags['dry-run'] 이 문자열이 되어 `== true` 검사를 지나지 못하고 실제로 실행된다. 그래서 거절한다.
    if (kind == SWITCH && inline != null) throw new UsageError(t('args.switchValue', { flag: `--${key}` }))
    const next = argv[i + 1]
    const takesNext = kind != SWITCH && inline == null && next != null && !next.startsWith('--')
    if (kind == VALUE && inline == null && !takesNext) throw new UsageError(t('args.flagValue', { flag: `--${key}` }))
    flags[key] = inline ?? (takesNext ? next : true)
    if (takesNext) i += 1
  }
  if (positional.length > spec.positional) throw new UsageError(t('args.extraPositional', { values: positional.slice(spec.positional) }))
  return { positional, flags, help: false }
}
