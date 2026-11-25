// 카드 본문을 프롬프트로 `claude --bg` 세션을 띄우고, 카드를 run.status 열로 옮기고, session 에 세션 id 를 적는다.
// 카드 세션이 보고할 이름은 lib/main.mjs 의 reportName 이다. 등록된 메인 세션이 부르면 역할 이름 main 이다.
// 모델 · effort 는 카드의 model: · effort: 태그를 profiles.json 으로 바꾼 값이다. 태그가 없으면 claude 의 기본값이다. 세션 이름은 k<id> 다.
// 프로필의 settings 나 config.json 의 run.settings 가 가리키는 settings 파일과 run.env 를 합쳐 --settings 로 넘긴다(lib/session-settings.mjs 의 sessionSettings).
// [assign] 코멘트에 model · effort 와 함께 그 settings 파일 경로를 적는다.
// uhd-kanban run <k id> [--dry-run] [--force]   --force 는 의존성 검사를 건너뛴다.

import { relative } from 'node:path'
import { UsageError, cardId } from '../args.mjs'
import { assignCard, launchCard } from '../assign.mjs'
import { checkMove, findCard } from '../cards.mjs'
import { USER } from '../comments.mjs'
import { editBoard } from '../edit.mjs'
import { forceNote, startedNote, t, translator } from '../i18n.mjs'
import { reportName } from '../main.mjs'
import { runSpec } from '../profiles.mjs'
import { ProjectError } from '../errors.mjs'
import { UNLIMITED, maxParallel } from '../project.mjs'
import { startPrompt } from '../prompt.mjs'
import { saveSessionSettings, sessionSettings } from '../session-settings.mjs'
import { RUNNING_VERDICTS, backgroundCommand, cardSession, hasRoom, runningCards, listSessions, sessionName } from '../sessions.mjs'

export const run = async ({ positional, flags }, { skillRoot }) => {
  if (positional[0] == null) throw new UsageError(t('run.usage'))
  const id = cardId(positional[0])
  const force = flags.force == true
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    const spec = runSpec(card, project.profiles)
    const settings = sessionSettings(project, spec)
    const status = project.config.run.status
    const blocking = card.status == status ? [] : checkMove(project, board, card, status, { force })
    const sessions = listSessions({ all: true })
    const previous = cardSession(card, sessions)
    if (RUNNING_VERDICTS.includes(previous.verdict)) throw new ProjectError(t('run.stillRunning', { id, session: card.data.session, state: previous.session.state }))
    const running = runningCards(project, board, sessions)
    if (!hasRoom(project, running.length)) throw new ProjectError(t('run.full', { max: maxParallel(project.config), ids: running.map((item) => `k${item.id}`), unlimited: UNLIMITED }))
    const from = reportName(project, sessions) ?? USER
    const name = sessionName(id)
    const prompt = startPrompt(project, card, { skillRoot, reportTo: from })
    const args = ['-n', name, ...spec.cliArgs, ...settings.args]
    if (flags['dry-run'] == true) {
      console.log(`(dry-run) ${backgroundCommand(args)}${spec.ultracode ? ' (ultracode)' : ''}\n${prompt}`)
      return 0
    }
    saveSessionSettings(settings)
    const { shortId, session } = await launchCard(project, sessions, args, prompt, project.root)
    if (!session) throw new ProjectError(t('run.notFound', { shortId }))
    const text = translator(project.locale)('run.assigned', { session: session.sessionId, label: `${spec.label}${settings.source ? ` settings=${settings.source}` : ''}${spec.ultracode ? ' ultracode' : ''}` })
    const moved = assignCard(project, board, card, status, { from, text, session, force })
    const path = moved?.path ?? card.path
    console.log(`k${id} ${shortId} ${session.sessionId} ${relative(project.root, path)}${forceNote(blocking)}${startedNote(moved?.started ?? [])}`)
    return 0
  })
}
