// 0.4.0 까지 만든 보드를 0.5.0 의 형식으로 바꾼다. 코멘트 kind 를 한국어 낱말에서 영어 id 로 바꾸고 config.json 에 locale 을 넣는다.
// 바꾸는 것: config.json 의 comments.kinds(LEGACY_KINDS 표 · RUN_KINDS 에 없는 것을 더한다) · locale(없으면 ko),
// 열 디렉터리와 archive.dir 의 모든 카드 파일에서 `## Comments` 아래 머리 줄 `### c<n> [<kind>]` 의 kind.
// 보드가 옛 config.json 으로는 loadProject 를 통과하지 못하므로 config.json 을 직접 읽는다. 쓰기 전에 모든 파일의 새 내용을 계산하고 검사한다.
// 다시 실행해도 바꿀 것이 없으면 아무것도 쓰지 않는다. 카드를 먼저 쓰고 config.json 을 마지막에 쓰므로, 중간에 끊겨도 다시 실행하면 이어서 바꾼다.
// uhd-kanban migrate [--dry-run]

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renameKinds } from '../comments.mjs'
import { t } from '../i18n.mjs'
import { LEGACY_KINDS, RUN_KINDS, kindId } from '../kinds.mjs'
import { withLock } from '../lock.mjs'
import { BOARD_DIR, ProjectError, SETTINGS_DIR, findRoot, formatConfig, readJson, validateConfig } from '../project.mjs'

// 0.4.0 까지의 프롬프트와 출력은 한국어였다.
const LEGACY_LOCALE = 'ko'

const listDir = (path) => {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch (error) {
    if (error.code == 'ENOENT') return []
    throw error
  }
}

const markdownIn = (dir) => listDir(dir).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => join(dir, entry.name))

// 열 디렉터리와 archive.dir/<YYYY-MM>/ 의 카드 파일. readBoard 가 읽는 자리와 같다.
const cardPaths = (boardPath, config) => [
  ...config.columns.flatMap((column) => markdownIn(join(boardPath, column.dir))),
  ...listDir(join(boardPath, config.archive.dir))
    .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}$/.test(entry.name))
    .flatMap((month) => markdownIn(join(boardPath, config.archive.dir, month.name))),
]

export const run = async ({ flags }) => {
  const dryRun = flags['dry-run'] == true
  const root = findRoot()
  const settingsPath = join(root, SETTINGS_DIR)
  const configPath = join(settingsPath, 'config.json')
  return withLock({ settingsPath }, async () => {
    const config = readJson(configPath)
    const kinds = config?.comments?.kinds
    if (!Array.isArray(kinds) || kinds.some((kind) => typeof kind != 'string')) throw new ProjectError(t('project.invalid', { path: configPath, problems: [t('config.kinds')] }))
    const nextKinds = [...new Set([...kinds.map(kindId), ...RUN_KINDS])]
    const { locale, ...rest } = config
    const next = { locale: locale ?? LEGACY_LOCALE, ...rest, comments: { ...config.comments, kinds: nextKinds } }
    const problems = validateConfig(next)
    if (problems.length > 0) throw new ProjectError(t('project.invalid', { path: configPath, problems }))
    const boardPath = join(root, BOARD_DIR)
    const cards = cardPaths(boardPath, config).map((path) => {
      const text = readFileSync(path, 'utf8')
      return { path, text, ...renameKinds(text, LEGACY_KINDS) }
    })
    const unknown = cards.flatMap((card) => card.kinds.filter((kind) => !nextKinds.includes(kind)).map((kind) => `${card.path.slice(root.length + 1)}: [${kind}]`))
    if (unknown.length > 0) throw new ProjectError(t('migrate.unknownKinds', { items: unknown }))
    const changed = cards.filter((card) => card.count > 0)
    const configText = formatConfig(next)
    const configChanged = configText != readFileSync(configPath, 'utf8')
    const headers = changed.reduce((sum, card) => sum + card.count, 0)
    if (configChanged) console.log(t('migrate.config', { before: kinds, after: nextKinds, locale: next.locale }))
    console.log(t(dryRun ? 'migrate.summaryDry' : 'migrate.summary', { cards: changed.length, total: cards.length, headers, config: configChanged }))
    if (dryRun) return 0
    changed.forEach((card) => writeFileSync(card.path, card.body))
    if (configChanged) writeFileSync(configPath, configText)
    return 0
  })
}
