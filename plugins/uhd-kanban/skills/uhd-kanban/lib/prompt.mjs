// claude --bg 세션에 넘길 프롬프트. 카드 본문(`## Comments` 앞)을 그대로 앞에 두고, 카드를 다루는 명령을 뒤에 붙인다.
// 뒤에 붙이는 글은 보드의 locale(config.json)로 쓴다. 명령을 부른 터미널의 언어가 아니라 카드 세션이 읽을 언어다.
// ultracode 카드는 본문 첫 줄이 ultracode 이므로 프롬프트 첫 줄도 ultracode 다. 뒤에 붙이는 글에는 그 낱말을 넣지 않는다.

import { join } from 'node:path'
import { parseComments } from './comments.mjs'
import { t, translator } from './i18n.mjs'
import { ProjectError } from './errors.mjs'
import { finishStatus } from './project.mjs'
import { BOARD_DIR } from './root.mjs'
import { sessionName } from './sessions.mjs'

// [result] 를 남긴 뒤 카드를 run.finish 의 열로 옮기라는 줄. 그 type 이 run.finish 에 없으면 옮기지 않고 메인 세션이 옮긴다.
const finishLine = (project, card, cli) => {
  const status = finishStatus(project.config, card.data.type)
  if (status == null) return ''
  return translator(project.locale)('prompt.finish', { cli, id: card.id, status })
}

const cliFor = (skillRoot) => `node ${join(skillRoot, 'bin', 'uhd-kanban.mjs')}`

// 카드 파일의 글로브. 카드를 옮기면 열 디렉터리와 순서 번호가 바뀌므로 경로 대신 이것을 준다.
// 순서 번호 자리는 order.width 자리 숫자로 고정한다. `*-k<id>-*.md` 는 제목에 그 id 를 적은 다른 카드(`0020-k2-k1-후속.md`)와도 맞고,
// 글로브 문법으로는 「길이가 정해지지 않은 숫자」를 적을 수 없다. 아카이브한 카드(`<YYYY-MM-DD>-k<id>-…`)와는 맞지 않는다.
const cardGlob = (project, card) => join(project.root, BOARD_DIR, '*', `${'[0-9]'.repeat(project.config.order.width)}-k${card.id}-*.md`)

export const startPrompt = (project, card, { skillRoot, reportTo }) => {
  const main = parseComments(card.body).main.trim()
  if (main == '') throw new ProjectError(t('prompt.emptyBody', { id: card.id }))
  const cli = cliFor(skillRoot)
  return translator(project.locale)('prompt.start', {
    main,
    id: card.id,
    glob: cardGlob(project, card),
    root: project.root,
    cli,
    reportTo,
    session: sessionName(card.id),
    finish: finishLine(project, card, cli),
  })
}

// 검토에서 돌아온 카드는 [result] 뒤의 코멘트가 고칠 것이다.
export const resumePrompt = (project, card, { skillRoot }) => translator(project.locale)('prompt.resume', {
  cli: cliFor(skillRoot),
  session: sessionName(card.id),
  glob: cardGlob(project, card),
  finish: finishLine(project, card, cliFor(skillRoot)),
})
