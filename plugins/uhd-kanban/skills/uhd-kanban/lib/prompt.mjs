// claude --bg 세션에 넘길 프롬프트. 카드 본문(`## Comments` 앞)을 그대로 앞에 두고, 카드를 다루는 명령을 뒤에 붙인다.
// ultracode 카드는 본문 첫 줄이 ultracode 이므로 프롬프트 첫 줄도 ultracode 다. 뒤에 붙이는 글에는 그 낱말을 넣지 않는다.

import { join } from 'node:path'
import { parseComments } from './comments.mjs'
import { ProjectError } from './project.mjs'

export const sessionName = (id) => `k${id}`

// run · recover 가 띄운 카드 세션의 이름인가. guard 가 카드 세션을 메인 세션과 가른다.
export const isCardSessionName = (name) => /^k\d+$/.test(name ?? '')

const cliFor = (skillRoot) => `node ${join(skillRoot, 'bin', 'uhd-kanban.mjs')}`

export const startPrompt = (project, card, { skillRoot, reportTo }) => {
  const main = parseComments(card.body).main.trim()
  if (main == '') throw new ProjectError(`k${card.id} 의 본문이 비어 프롬프트로 쓸 것이 없다`)
  const cli = cliFor(skillRoot)
  return `${main}

---
이 작업은 uhd-kanban 카드 k${card.id} 다. 카드 파일은 ${card.relPath} 이고 프로젝트 루트는 ${project.root} 다.
- 단계를 하나 마칠 때마다 \`${cli} comment k${card.id} --kind 진행 --to ${reportTo} --text "<한 일 · 다음 할 일>"\` 로 남긴다. 세션이 중단되면 이 코멘트에서 이어 간다.
- 물을 것이 있으면 \`--kind 질문\`, 끝나면 \`--kind 결과\` 로 남긴다. 명령이 낸 SendMessage 줄은 SendMessage 도구로 보낸다.
- \`${cli} inbox ${sessionName(card.id)}\` 로 이 세션 앞으로 온 코멘트를 읽는다.`
}

export const resumePrompt = (project, card, { skillRoot }) => `이 세션은 중단됐다가 uhd-kanban recover 로 다시 열렸다.
\`${cliFor(skillRoot)} inbox ${sessionName(card.id)} --all\` 과 카드 파일 ${join(project.root, card.relPath)} 의 ## Comments 에서 마지막 [진행] 코멘트를 읽고, 그 뒤부터 이어 간다.`
