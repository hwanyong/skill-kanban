// 사람이 읽는 출력(stdout · stderr)과 카드 세션 프롬프트의 언어를 고른다. 메시지는 messages/<locale>.mjs 의 표에 있다.
// 언어는 프로젝트마다 하나다. 보드의 config.json 의 locale 이 정하고, 키가 없거나 보드 밖이면 환경 변수(LC_ALL → LC_MESSAGES → LANG)로 정한다.
// 카드 파일에 기록하는 값(코멘트 kind · status · type)은 언어와 무관하게 영어 id 다. 표시 이름만 표에 있다.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import en from './messages/en.mjs'
import ko from './messages/ko.mjs'
import { SETTINGS_DIR, findRootOrNull } from './root.mjs'

const TABLES = { en, ko }
export const LOCALES = Object.keys(TABLES)

// 표마다 키가 같아야 한다. 한쪽에만 있는 키는 그 언어에서 메시지가 빠지므로 불러올 때 멈춘다.
const missingKeys = LOCALES.flatMap((locale) => LOCALES
  .flatMap((other) => Object.keys(TABLES[other]).filter((key) => !Object.hasOwn(TABLES[locale], key)))
  .map((key) => `messages/${locale}.mjs: ${key}`))
if (missingKeys.length > 0) throw new Error(`message tables differ:\n- ${[...new Set(missingKeys)].join('\n- ')}`)

// POSIX 의 우선순위대로 LC_ALL · LC_MESSAGES · LANG 중 처음 비지 않은 값을 본다. ko 로 시작하면 ko, 나머지는 en 이다.
export const envLocale = (env = process.env) => ((env.LC_ALL || env.LC_MESSAGES || env.LANG || '').startsWith('ko') ? 'ko' : 'en')

// config 의 locale 이 표에 있으면 그것, 아니면 환경 변수의 값. 표에 없는 locale 은 validateConfig 가 위반으로 알린다.
export const configLocale = (config) => (LOCALES.includes(config?.locale) ? config.locale : envLocale())

// 이 프로세스를 부른 디렉터리의 보드. config.json 을 읽지 못하면 환경 변수로 정하고, 읽지 못한 이유는 loadProject 가 알린다.
const callerLocale = () => {
  const root = findRootOrNull(process.cwd())
  if (root == null) return envLocale()
  try {
    return configLocale(JSON.parse(readFileSync(join(root, SETTINGS_DIR, 'config.json'), 'utf8')))
  } catch {
    return envLocale()
  }
}

export const translator = (locale) => (key, params = {}) => {
  const entry = TABLES[locale][key]
  if (entry == null) throw new Error(`no message key: ${key}`)
  return typeof entry == 'function' ? entry(params) : entry
}

export const LOCALE = callerLocale()
export const t = translator(LOCALE)

// 코멘트 kind 를 사람에게 보일 때의 글. 표시 이름이 id 와 다르면 `progress(진행)` 처럼 함께 적는다. 표에 없는 kind 는 id 만 적는다.
export const kindText = (kind, locale = LOCALE) => {
  const label = TABLES[locale][`kind.${kind}`]
  return label == null || label == kind ? kind : `${kind}(${label})`
}

// 여러 명령이 같은 꼴로 덧붙이는 출력. 값이 없으면 빈 글이다.
export const renumberNote = (count) => (count > 0 ? ` ${t('note.renumbered', { count })}` : '')
export const forceNote = (blocking) => (blocking.length > 0 ? ` ${t('note.forced', { ids: blocking.map((id) => `k${id}`) })}` : '')
export const startedNote = (started) => (started.length > 0 ? ` ${t('note.started', { ids: started.map((id) => `k${id}`) })}` : '')
