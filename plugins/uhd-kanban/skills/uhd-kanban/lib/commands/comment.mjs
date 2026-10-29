// 카드에 코멘트를 덧붙이고, 받는 세션마다 SendMessage 로 보낼 줄을 stdout 에 낸다.
// 이 명령은 메시지를 보내지 않는다. Claude Code 에 메시지를 보내는 CLI 명령이 없어(2.1.312), 그 줄을 읽은 AI 가 SendMessage 도구를 부른다.
// uhd-kanban comment <k id> --kind <kind> --to <이름>[,<이름>] [--from <이름>] (--text <글> | --text-file <경로>)

import { readFileSync } from 'node:fs'
import { UsageError, cardId, listFrom } from '../args.mjs'
import { findCard, now, writeCard } from '../cards.mjs'
import { USER, appendComment, isName, textProblems } from '../comments.mjs'
import { editBoard } from '../edit.mjs'
import { ProjectError } from '../project.mjs'
import { currentSessionName, listSessions } from '../sessions.mjs'

const readText = (flags) => {
  const given = ['text', 'text-file'].filter((key) => typeof flags[key] == 'string')
  if (given.length != 1) throw new UsageError('--text 와 --text-file 중 하나만 준다')
  return given[0] == 'text' ? flags.text : readFileSync(flags['text-file'], 'utf8')
}

// 세션 목록을 못 읽어도 코멘트는 쓴다. 받는 이름을 대조하지 못했다는 것만 알린다.
const trySessions = () => {
  try {
    return listSessions()
  } catch (error) {
    console.error(`claude agents --json 을 읽지 못해 받는 이름을 대조하지 않았다: ${error.message.split('\n')[0]}`)
    return null
  }
}

export const run = async ({ positional, flags }) => {
  if (positional[0] == null) throw new UsageError('comment <k id> --kind <kind> --to <이름> (--text | --text-file) 형식이다')
  const id = cardId(positional[0])
  if (typeof flags.kind != 'string') throw new UsageError('--kind 가 필요하다')
  const to = listFrom(flags.to)
  if (to.length == 0) throw new UsageError('--to 가 필요하다')
  const text = readText(flags).replace(/\s+$/, '')
  const sessions = trySessions()
  const from = typeof flags.from == 'string' ? flags.from : sessions && currentSessionName(sessions)
  if (from == null) throw new UsageError('이 세션의 이름을 claude agents --json 에서 찾지 못했다. --from 을 준다')
  const badNames = [from, ...to].filter((name) => !isName(name))
  if (badNames.length > 0) throw new UsageError(`이름에 공백 · 쉼표 · = · [ ] 을 쓸 수 없다: ${badNames.join(', ')}`)
  const problems = textProblems(text)
  if (problems.length > 0) throw new ProjectError(`코멘트 본문을 쓸 수 없다:\n- ${problems.join('\n- ')}`)
  return editBoard(async ({ project, board }) => {
    const kinds = project.config.comments.kinds
    if (!kinds.includes(flags.kind)) throw new ProjectError(`kind ${flags.kind} 는 config.json 의 comments.kinds 에 없다(허용: ${kinds.join(', ')})`)
    const card = findCard(board, id)
    const { body, n } = appendComment(card.body, { kind: flags.kind, from, to, at: now(), text })
    writeCard(card.path, { ...card.data, updated_at: now() }, body)
    console.log(`k${id} c${n} ${card.path.slice(project.root.length + 1)}`)
    const known = new Set((sessions ?? []).map((session) => session.name))
    const summary = `k${id} c${n} [${flags.kind}] ${text.split('\n')[0]}`
    to.filter((name) => name != USER).forEach((name) => {
      const note = sessions == null ? ' # 세션 목록을 읽지 못했다' : known.has(name) ? '' : ' # claude agents --json 에 없는 이름이다'
      console.log(`SendMessage to=${name} message=${JSON.stringify(summary)}${note}`)
    })
    return 0
  })
}
