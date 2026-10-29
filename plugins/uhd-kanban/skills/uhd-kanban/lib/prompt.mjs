// claude --bg 세션에 넘길 프롬프트. 카드 본문(`## Comments` 앞)을 그대로 앞에 두고, 카드를 다루는 명령을 뒤에 붙인다.
// ultracode 카드는 본문 첫 줄이 ultracode 이므로 프롬프트 첫 줄도 ultracode 다. 뒤에 붙이는 글에는 그 낱말을 넣지 않는다.

import { join } from 'node:path'
import { parseComments } from './comments.mjs'
import { BOARD_DIR, ProjectError, finishStatus } from './project.mjs'

export const sessionName = (id) => `k${id}`

// [결과] 를 남긴 뒤 카드를 run.finish 의 열로 옮기라는 줄. 그 type 이 run.finish 에 없으면 옮기지 않고 메인 세션이 옮긴다.
const finishLine = (project, card, cli) => {
  const status = finishStatus(project.config, card.data.type)
  if (status == null) return ''
  return `\n- \`[결과]\` 를 남긴 뒤 마지막으로 \`${cli} move k${card.id} ${status}\` 로 카드를 ${status} 열로 옮긴다. 검토에서 고칠 것이 나오면 메인 세션이 카드를 다시 이 세션에 맡긴다.`
}

// run · recover 가 띄운 카드 세션의 이름인가. guard 가 카드 세션을 메인 세션과 가른다.
export const isCardSessionName = (name) => /^k\d+$/.test(name ?? '')

const cliFor = (skillRoot) => `node ${join(skillRoot, 'bin', 'uhd-kanban.mjs')}`

// 카드 파일의 글로브. 카드를 옮기면 열 디렉터리와 순서 번호가 바뀌므로 경로 대신 이것을 준다.
const cardGlob = (project, card) => join(project.root, BOARD_DIR, '*', `*-k${card.id}-*.md`)

export const startPrompt = (project, card, { skillRoot, reportTo }) => {
  const main = parseComments(card.body).main.trim()
  if (main == '') throw new ProjectError(`k${card.id} 의 본문이 비어 프롬프트로 쓸 것이 없다`)
  const cli = cliFor(skillRoot)
  return `${main}

---
이 작업은 uhd-kanban 카드 k${card.id} 다. 카드 파일은 ${cardGlob(project, card)} 이고 프로젝트 루트는 ${project.root} 다.
- 단계를 하나 마칠 때마다 \`${cli} comment k${card.id} --kind 진행 --to ${reportTo} --text "<한 일 · 다음 할 일>"\` 로 남긴다. 세션이 중단되면 이 코멘트에서 이어 간다.
- 물을 것이 있으면 \`--kind 질문\`, 끝나면 \`--kind 결과\` 로 남긴다. 고를 것이 있는 질문은 본문에 무엇을 정해야 하는지 · 선택지 2~4개(각각 결과와 대가) · 권장안과 이유 · 답이 올 때까지 멈추는 일을 적는다. 받는 쪽은 이 코멘트만 읽고 고른다. 명령이 낸 SendMessage 줄은 SendMessage 도구로 보낸다.${finishLine(project, card, cli)}
- \`${cli} inbox ${sessionName(card.id)}\` 로 이 세션 앞으로 온 코멘트를 읽는다.`
}

// 검토에서 돌아온 카드는 [결과] 뒤의 코멘트가 고칠 것이다.
export const resumePrompt = (project, card, { skillRoot }) => `이 세션은 중단됐다가 uhd-kanban recover 로 다시 열렸다.
\`${cliFor(skillRoot)} inbox ${sessionName(card.id)} --all\` 과 카드 파일 ${cardGlob(project, card)} 의 ## Comments 에서 마지막 [진행] 코멘트와 그 뒤의 코멘트를 읽고, 그 뒤부터 이어 간다. [결과] 를 이미 남긴 카드면 그 뒤의 코멘트가 고칠 것이다. 끝나면 처음 프롬프트대로 [결과] 를 다시 남긴다.${finishLine(project, card, cliFor(skillRoot))}`
