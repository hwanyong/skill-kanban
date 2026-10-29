// run.status 열의 카드마다 세션 상태를 보고, 멈춘 세션을 `claude --bg --resume <session>` 으로 이어 간다. 판정은 sessions.mjs 의 cardSession 이다.
// 2026-10-29 실측: `--bg --resume` 은 이전 대화를 이어받은 새 session id 로 떴다. 그래서 카드의 session 을 새 id 로 고쳐 적는다.
// 체크포인트는 카드의 [진행] 코멘트다. 이어 간 세션에 그 코멘트를 읽으라고 프롬프트로 준다.
// uhd-kanban recover [<k id>…] [--dry-run] [--force]   id 를 주지 않으면 run.status 열의 카드 전부.
// --force 는 끝난(state done) 세션도 이어 간다. 세션이 끝났는데 카드에 작업이 남은 때다. 이어 감 판정과 같이 run.max_parallel 에 센다.

import { cardId } from '../args.mjs'
import { findCard, now, writeCard } from '../cards.mjs'
import { USER, appendComment } from '../comments.mjs'
import { editBoard } from '../edit.mjs'
import { runSpec } from '../profiles.mjs'
import { maxParallel } from '../project.mjs'
import { resumePrompt, sessionName } from '../prompt.mjs'
import { BACKGROUND_ARGS, cardSession, hasRoom, runningCards, currentSessionName, findSession, launchBackground, listSessions, startedAt, stopSession } from '../sessions.mjs'

const LABELS = {
  live: '돈다',
  pending: '다시 뜨는 중이다(pid 없이 state working). 잠시 뒤 recover 를 다시 실행한다',
  done: '세션이 끝났는데(state done) 카드가 열에 남았다. 결과 코멘트를 보고 카드를 옮기거나, 작업이 남았으면 --force 로 이어 간다',
}

export const run = async ({ positional, flags }, { skillRoot }) => {
  const ids = positional.map((ref) => cardId(ref))
  const dryRun = flags['dry-run'] == true
  const force = flags.force == true
  return editBoard(async ({ project, board }) => {
    const status = project.config.run.status
    const cards = ids.length > 0 ? ids.map((id) => findCard(board, id)) : board.cards.filter((card) => card.status == status)
    const sessions = listSessions({ all: true })
    const from = currentSessionName(sessions) ?? USER
    const counts = { live: 0, pending: 0, done: 0, resumed: 0, waiting: 0, failed: 0 }
    // 멈춘(restart) 세션은 이미 센 것을 바꿔 띄우므로 수가 늘지 않는다. 목록에 없거나 stopped 인(resume) 세션만 하나씩 늘린다.
    let running = runningCards(project, board, sessions).length
    for (const card of cards) {
      const sessionId = card.data.session
      const found = cardSession(card, sessions)
      const { session, transcript } = found
      const verdict = force && found.verdict == 'done' ? 'resume' : found.verdict
      if (verdict == 'none') {
        counts.failed += 1
        console.log(`k${card.id} 이어 갈 수 없다: session 이 비었다. uhd-kanban run 으로 새로 띄운다`)
        continue
      }
      if (LABELS[verdict]) {
        counts[verdict] += 1
        console.log(`k${card.id} ${LABELS[verdict]}: ${sessionId} state=${session.state ?? '-'} status=${session.status ?? '-'} pid=${session.pid ?? '-'}`)
        continue
      }
      if (!transcript) {
        counts.failed += 1
        console.log(`k${card.id} 이어 갈 수 없다: 대화 기록 ${sessionId}.jsonl 이 ~/.claude/projects 에 없다`)
        continue
      }
      if (verdict == 'resume' && !hasRoom(project, running)) {
        counts.waiting += 1
        console.log(`k${card.id} 기다린다: 동시에 도는 카드 세션이 run.max_parallel(${maxParallel(project.config)})개에 찼다`)
        continue
      }
      if (verdict == 'resume') running += 1
      const spec = runSpec(card, project.profiles)
      const args = ['--resume', sessionId, '-n', sessionName(card.id), ...spec.cliArgs]
      const why = verdict == 'restart' ? `데몬이 다시 띄웠지만(startedAt ${startedAt(session)}) 마지막 user 줄에 답하지 않고 idle 이다` : session ? `state ${session.state}${found.verdict == 'done' ? ', --force' : ''}` : 'claude agents --json --all 에 없다'
      counts.resumed += 1
      if (dryRun) {
        console.log(`(dry-run) k${card.id} ${why} → ${verdict == 'restart' ? `claude stop ${session.id} 뒤 ` : ''}claude ${[...BACKGROUND_ARGS, ...args].join(' ')} <프롬프트>`)
        continue
      }
      if (verdict == 'restart') stopSession(session.id)
      const shortId = launchBackground(args, resumePrompt(project, card, { skillRoot }), project.root)
      const resumed = findSession(listSessions({ all: true }), shortId)
      const changes = resumed ? { session: resumed.sessionId, session_started_at: startedAt(resumed) } : {}
      const text = `recover 로 이어 갔다(${why}). claude --bg --resume ${sessionId} → session=${resumed?.sessionId ?? `${shortId}(claude agents --json 에서 찾지 못했다)`}`
      const { body } = appendComment(card.body, { kind: '배정', from, to: [sessionName(card.id)], at: now(), text })
      writeCard(card.path, { ...card.data, ...changes, updated_at: now() }, body)
      console.log(`k${card.id} 이어 갔다(${why}): ${shortId} ${resumed?.sessionId ?? ''}`)
    }
    console.log(`카드 ${cards.length}개 · 돈다 ${counts.live} · 다시 뜨는 중 ${counts.pending} · 끝남 ${counts.done} · ${dryRun ? '이어 갈' : '이어 간'} 것 ${counts.resumed} · 자리를 기다린다 ${counts.waiting} · 이어 갈 수 없다 ${counts.failed}`)
    return counts.failed + counts.waiting > 0 ? 1 : 0
  })
}
