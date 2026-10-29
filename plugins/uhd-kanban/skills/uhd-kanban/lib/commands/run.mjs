// 카드 본문을 프롬프트로 `claude --bg` 세션을 띄우고, 카드를 run.status 열로 옮기고, session 에 세션 id 를 적는다.
// 모델 · effort 는 카드의 model: · effort: 태그를 profiles.json 으로 바꾼 값이다. 태그가 없으면 claude 의 기본값이다. 세션 이름은 k<id> 다.
// uhd-kanban run <k id> [--dry-run] [--force]   --force 는 의존성 검사를 건너뛴다.

import { UsageError, cardId } from '../args.mjs'
import { checkMove, findCard, moveCard, now, writeCard } from '../cards.mjs'
import { USER, appendComment } from '../comments.mjs'
import { editBoard } from '../edit.mjs'
import { runSpec } from '../profiles.mjs'
import { ProjectError } from '../project.mjs'
import { sessionName, startPrompt } from '../prompt.mjs'
import { cardSession, currentSessionName, findSession, launchBackground, listSessions, startedAt } from '../sessions.mjs'

export const run = async ({ positional, flags }, { skillRoot }) => {
  if (positional[0] == null) throw new UsageError('run <k id> [--dry-run] [--force] 형식이다')
  const id = cardId(positional[0])
  const force = flags.force == true
  return editBoard(async ({ project, board }) => {
    const card = findCard(board, id)
    const spec = runSpec(card, project.profiles)
    const status = project.config.run.status
    const blocking = card.status == status ? [] : checkMove(project, board, card, status, { force })
    const sessions = listSessions({ all: true })
    const previous = cardSession(card, sessions)
    if (['live', 'pending', 'restart'].includes(previous.verdict)) throw new ProjectError(`k${id} 의 세션 ${card.data.session} 이 아직 있다(state ${previous.session.state}). 새로 띄우지 않는다. 멈췄으면 uhd-kanban recover k${id}`)
    const from = currentSessionName(sessions) ?? USER
    const name = sessionName(id)
    const prompt = startPrompt(project, card, { skillRoot, reportTo: from })
    const args = ['-n', name, ...spec.cliArgs]
    if (flags['dry-run'] == true) {
      console.log(`(dry-run) claude --bg ${args.join(' ')} <프롬프트>${spec.ultracode ? ' (ultracode)' : ''}\n${prompt}`)
      return 0
    }
    const shortId = launchBackground(args, prompt, project.root)
    const session = findSession(listSessions({ all: true }), shortId)
    if (!session) throw new ProjectError(`세션 ${shortId} 를 띄웠지만 claude agents --json 에서 찾지 못해 카드를 바꾸지 않았다. claude stop ${shortId} 로 멈추거나 카드에 session 을 직접 적는다`)
    const text = `claude --bg 로 시작했다. session=${session.sessionId} ${spec.label}${spec.ultracode ? ' ultracode' : ''}`
    const { body } = appendComment(card.body, { kind: '배정', from, to: [name], at: now(), text })
    const changes = { session: session.sessionId, session_started_at: startedAt(session) }
    let path = card.path
    if (card.status == status) writeCard(card.path, { ...card.data, ...changes, updated_at: now() }, body)
    else path = moveCard(project, board, { ...card, body }, status, { force, changes }).path
    console.log(`k${id} ${shortId} ${session.sessionId} ${path.slice(project.root.length + 1)}${blocking.length > 0 ? ` (--force: ${blocking.map((item) => `k${item}`).join(', ')} 미완료)` : ''}`)
    return 0
  })
}
