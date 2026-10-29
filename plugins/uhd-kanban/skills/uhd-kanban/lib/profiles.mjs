// `.uhd-kanban/profiles.json` 은 카드 태그의 프로필 이름(`model:deep`)을 실제 값(`--model opus`)으로 바꾸는 표다.
// 모델 이름이 바뀌면 이 표만 고친다. 카드의 태그는 그대로 둔다.
// models.<프로필>.cli 는 `claude --model` 값, agent 는 Agent 도구의 model 값, ultracode 는 그 모델에서 ultracodeKeywordTrigger 가
// 걸리는 것을 확인했는지다(true 확인함 · false 걸리지 않음 · null 재지 않음). null 인 프로필에는 run 이 ultracode 카드를 띄우지 않는다.
// 확인 방법: 그 모델로 `claude --bg` 에 첫 줄이 ultracode 인 프롬프트를 주고, 대화 기록 jsonl 에 attachment type workflow_keyword_request 가 생기는지 본다.
// 2026-10-29 실측(2.1.312): sonnet · fable · opus · opus[1m] · haiku 모두 생겼다. 그 세션에서 Workflow 도구를 실제로 부르는 것까지는 재지 않았다.

import { bareKeywordLines, hasTriggerLine } from './ultracode.mjs'
import { ProjectError } from './project.mjs'

const MODEL_TAG = 'model:'
const EFFORT_TAG = 'effort:'
export const ULTRACODE_TAG = 'ultracode'

const isNullableString = (value) => value == null || (typeof value == 'string' && value != '')

export const validateProfiles = (profiles) => {
  const problems = []
  const models = profiles?.models
  if (models == null || typeof models != 'object' || Array.isArray(models) || Object.keys(models).length == 0) problems.push('models 는 프로필 이름을 키로 하는 비지 않은 객체다')
  Object.entries(models ?? {}).forEach(([name, profile]) => {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(`models 의 프로필 이름은 영소문자 · 숫자 · - 로 쓴다: ${name}`)
    if (!isNullableString(profile?.cli) || !isNullableString(profile?.agent)) problems.push(`models.${name} 의 cli · agent 는 문자열이나 null 이다`)
    if (![true, false, null].includes(profile?.ultracode ?? null)) problems.push(`models.${name}.ultracode 는 true · false · null 이다`)
  })
  for (const key of ['cli', 'agent']) {
    const list = profiles?.effort?.[key]
    if (!Array.isArray(list) || list.some((level) => typeof level != 'string' || level == '')) problems.push(`effort.${key} 는 effort 값 배열이다`)
  }
  return problems
}

const tagValues = (tags, prefix) => (tags ?? []).filter((tag) => tag.startsWith(prefix)).map((tag) => tag.slice(prefix.length))

// 카드 하나의 model · effort · ultracode 태그를 검사한다. main 은 `## Comments` 앞의 본문이다.
export const tagProblems = (data, main, profiles) => {
  const problems = []
  const models = tagValues(data.tags, MODEL_TAG)
  const efforts = tagValues(data.tags, EFFORT_TAG)
  if (models.length > 1) problems.push(`model: 태그가 ${models.length}개다`)
  models.filter((name) => profiles.models[name] == null).forEach((name) => problems.push(`model:${name} 은 profiles.json 의 models 에 없다(있는 것: ${Object.keys(profiles.models).join(', ')})`))
  if (efforts.length > 1) problems.push(`effort: 태그가 ${efforts.length}개다`)
  efforts.filter((level) => !profiles.effort.cli.includes(level)).forEach((level) => problems.push(`effort:${level} 은 profiles.json 의 effort.cli 에 없다`))
  const tagged = (data.tags ?? []).includes(ULTRACODE_TAG)
  const triggered = hasTriggerLine(main)
  if (tagged && !triggered) problems.push('ultracode 태그가 있는데 본문 첫 줄이 ultracode 가 아니다')
  if (!tagged && triggered) problems.push('본문 첫 줄이 ultracode 인데 ultracode 태그가 없다')
  bareKeywordLines(main.replace(/^\n+/, ''), { firstLineAllowed: true }).forEach((line) => problems.push(`본문 ${line}번째 줄의 ultracode 가 감싸지 않았다. 트리거가 아니면 백틱 · [ ] · 따옴표로 감싼다`))
  return problems
}

// run 이 쓰는 값. 태그가 규칙에 맞는다는 것은 readBoard 가 이미 확인했다. 여기서는 실행할 수 있는지만 본다.
// model: 태그가 없으면 `--model` 을, effort: 태그가 없으면 `--effort` 를 넘기지 않는다. claude 가 자기 기본값으로 띄운다.
// ultracode 가 걸리는지는 모델마다 확인한 값이라, 모델을 모르는 기본값으로는 ultracode 카드를 띄우지 않는다.
export const runSpec = (card, profiles) => {
  const [profileName = null] = tagValues(card.data.tags, MODEL_TAG)
  const profile = profileName == null ? null : profiles.models[profileName]
  if (profile && profile.cli == null) throw new ProjectError(`model:${profileName} 은 claude CLI 로 띄우지 않는 프로필이다(profiles.json 의 cli 가 null)`)
  const ultracode = (card.data.tags ?? []).includes(ULTRACODE_TAG)
  if (ultracode && profile == null) throw new ProjectError(`k${card.id} 는 ultracode 카드인데 model: 태그가 없다. ultracode 는 모델마다 확인한 값이므로 uhd-kanban set k${card.id} --add-tag model:<프로필> 로 단다`)
  if (ultracode && profile.ultracode != true) throw new ProjectError(`model:${profileName}(${profile.cli}) 에서 ultracode 가 걸리는지 확인하지 않았다(profiles.json 의 ultracode 가 ${profile.ultracode}). 확인한 뒤 true 로 고친다`)
  const [effort = null] = tagValues(card.data.tags, EFFORT_TAG)
  const model = profile?.cli ?? null
  const cliArgs = [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])]
  const label = `model=${model ?? '기본값'}${profileName ? `(model:${profileName})` : ''} effort=${effort ?? '기본값'}`
  return { ultracode, cliArgs, label }
}
