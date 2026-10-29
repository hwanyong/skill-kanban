// 카드 본문을 프롬프트로 `claude --bg` 세션을 띄우고, 카드를 run.status 열로 옮기고, session 에 세션 id 를 적는다.
// 모델 · effort 는 카드의 model: · effort: 태그를 profiles.json 으로 바꾼 값이다. 태그가 없으면 claude 의 기본값이다. 세션 이름은 k<id> 다.
// uhd-kanban run <k id> [--dry-run] [--force]   --force 는 의존성 검사를 건너뛴다.

import { UsageError, cardId } from '../args.mjs'
import { checkMove, findCard, moveCard, now, writeCard } from '../cards.mjs'
import { USER, appendComment } from '../comments.mjs'
import { editBoard } from '../edit.mjs'
import { forceNote, t, translator } from '../i18n.mjs'
import { runSpec } from '../profiles.mjs'
import { ProjectError, maxParallel } from '../project.mjs'
import { sessionName, startPrompt } from '../prompt.mjs'
import { BACKGROUND_ARGS, RUNNING_VERDICTS, cardSession, hasRoom, runningCards, currentSessionName, findSession, launchBackground, listSessions, startedAt } from '../sessions.mjs'

export const run = async ({ positional, flags }, { skillRoot }) => {
  if (positional[0] == null) throw new UsageError(t('run.usage'))
  const id = cardId(positional[0])
  const force = flags.force == true
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    const spec = runSpec(card, project.profiles)
    const status = project.config.run.status
    const blocking = card.status == status ? [] : checkMove(project, board, card, status, { force })
    const sessions = listSessions({ all: true })
    const previous = cardSession(card, sessions)
    if (RUNNING_VERDICTS.includes(previous.verdict)) throw new ProjectError(t('run.stillRunning', { id, session: card.data.session, state: previous.session.state }))
    const running = runningCards(project, board, sessions)
    if (!hasRoom(project, running.length)) throw new ProjectError(t('run.full', { max: maxParallel(project.config), ids: running.map((item) => `k${item.id}`) }))
    const from = currentSessionName(sessions) ?? USER
    const name = sessionName(id)
    const prompt = startPrompt(project, card, { skillRoot, reportTo: from })
    const args = ['-n', name, ...spec.cliArgs]
    if (flags['dry-run'] == true) {
      console.log(`(dry-run) claude ${[...BACKGROUND_ARGS, ...args].join(' ')} <${t('run.prompt')}>${spec.ultracode ? ' (ultracode)' : ''}\n${prompt}`)
      return 0
    }
    const shortId = launchBackground(args, prompt, project.root)
    const session = findSession(listSessions({ all: true }), shortId)
    if (!session) throw new ProjectError(t('run.notFound', { shortId }))
    const text = translator(project.locale)('run.assigned', { session: session.sessionId, label: `${spec.label}${spec.ultracode ? ' ultracode' : ''}` })
    const { body } = appendComment(card.body, { kind: 'assign', from, to: [name], at: now(), text })
    const changes = { session: session.sessionId, session_started_at: startedAt(session) }
    let path = card.path
    if (card.status == status) writeCard(card.path, { ...card.data, ...changes, updated_at: now() }, body)
    else path = moveCard(project, board, { ...card, body }, status, { force, changes }).path
    console.log(`k${id} ${shortId} ${session.sessionId} ${path.slice(project.root.length + 1)}${forceNote(blocking)}`)
    return 0
  })
}
