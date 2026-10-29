// `.uhd-kanban/profiles.json` 은 카드 태그의 프로필 이름(`model:deep`)을 실제 값(`--model opus`)으로 바꾸는 표다.
// 모델 이름이 바뀌면 이 표만 고친다. 카드의 태그는 그대로 둔다.
// models.<프로필>.cli 는 `claude --model` 값, agent 는 Agent 도구의 model 값, ultracode 는 그 모델에서 ultracodeKeywordTrigger 가
// 걸리는 것을 확인했는지다(true 확인함 · false 걸리지 않음 · null 재지 않음). null 인 프로필에는 run 이 ultracode 카드를 띄우지 않는다.
// 확인 방법: 그 모델로 `claude --bg` 에 첫 줄이 ultracode 인 프롬프트를 주고, 대화 기록 jsonl 에 attachment type workflow_keyword_request 가 생기는지 본다.
// 2026-10-29 실측(2.1.312): sonnet · fable · opus · opus[1m] · haiku 모두 생겼다. 그 세션에서 Workflow 도구를 실제로 부르는 것까지는 재지 않았다.

import { t } from './i18n.mjs'
import { bareKeywordLines, hasTriggerLine } from './ultracode.mjs'
import { ProjectError } from './project.mjs'

const MODEL_TAG = 'model:'
const EFFORT_TAG = 'effort:'
export const ULTRACODE_TAG = 'ultracode'

const isNullableString = (value) => value == null || (typeof value == 'string' && value != '')

export const validateProfiles = (profiles) => {
  const problems = []
  const models = profiles?.models
  if (models == null || typeof models != 'object' || Array.isArray(models) || Object.keys(models).length == 0) problems.push(t('profiles.models'))
  Object.entries(models ?? {}).forEach(([name, profile]) => {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(t('profiles.name', { name }))
    if (!isNullableString(profile?.cli) || !isNullableString(profile?.agent)) problems.push(t('profiles.cliAgent', { name }))
    if (![true, false, null].includes(profile?.ultracode ?? null)) problems.push(t('profiles.ultracode', { name }))
  })
  for (const key of ['cli', 'agent']) {
    const list = profiles?.effort?.[key]
    if (!Array.isArray(list) || list.some((level) => typeof level != 'string' || level == '')) problems.push(t('profiles.effort', { key }))
  }
  return problems
}

const tagValues = (tags, prefix) => (tags ?? []).filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length))

// 카드 하나의 model · effort · ultracode 태그를 검사한다. main 은 `## Comments` 앞의 본문이다.
export const tagProblems = (data, main, profiles) => {
  const problems = []
  const models = tagValues(data.tags, MODEL_TAG)
  const efforts = tagValues(data.tags, EFFORT_TAG)
  if (models.length > 1) problems.push(t('tags.modelCount', { count: models.length }))
  models.filter((name) => profiles.models[name] == null).forEach((name) => problems.push(t('tags.modelUnknown', { name, known: Object.keys(profiles.models) })))
  if (efforts.length > 1) problems.push(t('tags.effortCount', { count: efforts.length }))
  efforts.filter((level) => !profiles.effort.cli.includes(level)).forEach((level) => problems.push(t('tags.effortUnknown', { level })))
  const tagged = (data.tags ?? []).includes(ULTRACODE_TAG)
  const triggered = hasTriggerLine(main)
  if (tagged && !triggered) problems.push(t('tags.ultracodeNoLine'))
  if (!tagged && triggered) problems.push(t('tags.ultracodeNoTag'))
  bareKeywordLines(main.replace(/^\n+/, ''), { firstLineAllowed: true }).forEach((line) => problems.push(t('tags.bareKeyword', { line })))
  return problems
}

// run 이 쓰는 값. 태그가 규칙에 맞는다는 것은 readBoard 가 이미 확인했다. 여기서는 실행할 수 있는지만 본다.
// model: 태그가 없으면 `--model` 을, effort: 태그가 없으면 `--effort` 를 넘기지 않는다. claude 가 자기 기본값으로 띄운다.
// ultracode 가 걸리는지는 모델마다 확인한 값이라, 모델을 모르는 기본값으로는 ultracode 카드를 띄우지 않는다.
export const runSpec = (card, profiles) => {
  const [profileName = null] = tagValues(card.data.tags, MODEL_TAG)
  const profile = profileName == null ? null : profiles.models[profileName]
  if (profile && profile.cli == null) throw new ProjectError(t('run.profileNoCli', { profile: profileName }))
  const ultracode = (card.data.tags ?? []).includes(ULTRACODE_TAG)
  if (ultracode && profile == null) throw new ProjectError(t('run.ultracodeNoModel', { id: card.id }))
  if (ultracode && profile.ultracode != true) throw new ProjectError(t('run.ultracodeUnverified', { profile: profileName, cli: profile.cli, value: profile.ultracode }))
  const [effort = null] = tagValues(card.data.tags, EFFORT_TAG)
  const model = profile?.cli ?? null
  const cliArgs = [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])]
  const label = `model=${model ?? t('run.default')}${profileName ? `(model:${profileName})` : ''} effort=${effort ?? t('run.default')}`
  return { ultracode, cliArgs, label }
}
