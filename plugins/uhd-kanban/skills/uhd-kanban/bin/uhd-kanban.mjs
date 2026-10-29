#!/usr/bin/env node
// uhd-kanban 명령의 진입점. 하위 명령을 lib/commands/*.mjs 에 넘긴다.
// 종료 코드: 0 성공 · 1 규칙 위반이나 실행 실패 · 2 사용법 오류 · 3 부른 디렉터리 위에 보드(.uhd-kanban/config.json)가 없다.

import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { NoProjectError, ProjectError } from '../lib/project.mjs'
import { UsageError, parseArgs } from '../lib/args.mjs'

const COMMANDS = {
  init: 'init.mjs',
  check: 'check.mjs',
  new: 'new.mjs',
  move: 'move.mjs',
  order: 'order.mjs',
  renumber: 'renumber.mjs',
  set: 'set.mjs',
  archive: 'archive.mjs',
  comment: 'comment.mjs',
  inbox: 'inbox.mjs',
  run: 'run.mjs',
  recover: 'recover.mjs',
  board: 'board.mjs',
}

const USAGE = `사용법: uhd-kanban <명령> [인자]
  init [--dir <경로>]   프로젝트 루트에 .uhd-kanban/ 과 kanban/ 을 만든다
  check                 config.json 과 모든 카드를 검증한다
  new --type <type> --title <제목> [--status] [--priority] [--tags a,b] [--depends k1,k2] [--body-file] [자리]
  move <k id> <status> [자리] [--force]
  order <k id> <자리>
  renumber <status>
  set <k id> [--title] [--priority] [--add-tag a,b] [--remove-tag a,b]
  archive [--dry-run]
  comment <k id> --kind <kind> --to <이름>[,<이름>] [--from <이름>] (--text <글> | --text-file <경로>)
  inbox [<이름>] [--all]
  run <k id> [--dry-run] [--force]   카드 본문으로 claude --bg 세션을 띄운다
  recover [<k id>…] [--dry-run]      세션이 멈춘 카드를 claude --bg --resume 으로 이어 간다
  board [--json]        열마다 카드 수와 run.status 열 카드의 세션 상태를 낸다
  자리: --top · --bottom · --before <k id> · --after <k id> (기본 --bottom)`

const [name, ...rest] = process.argv.slice(2)
const file = COMMANDS[name]
if (!file) {
  console.error(name ? `알 수 없는 명령이다: ${name}\n${USAGE}` : USAGE)
  process.exit(2)
}

const skillRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const { run } = await import(join(skillRoot, 'lib', 'commands', file))
try {
  process.exitCode = await run(parseArgs(rest), { skillRoot })
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`${error.message}\n${USAGE}`)
    process.exit(2)
  }
  if (!(error instanceof ProjectError)) throw error
  console.error(error.message)
  process.exit(error instanceof NoProjectError ? 3 : 1)
}
