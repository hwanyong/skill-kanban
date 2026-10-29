---
name: uhd-kanban
description: 프로젝트의 칸반 보드(`kanban/` 의 카드 `.md` 파일)를 읽고 고친다. 카드 만들기 · 열 옮기기 · 순서 바꾸기 · 코멘트 · 아카이브 · 카드를 `claude --bg` 세션으로 실행하기 · 멈춘 세션 이어 가기. "칸반", "카드 만들어", "k123 옮겨", "보드 정리", "카드 실행", "inbox 확인" 같은 요청이거나 프로젝트 루트에 `.uhd-kanban/` 이 있으면 연다.
---

# uhd-kanban

보드는 프로젝트마다 한 벌이다. 카드 하나가 `.md` 파일 하나이고, 열(상태)은 디렉터리 이름이, 열 안의 순서는 파일 이름의 순서 번호가 갖는다. 파일 이름순으로 정렬하면 보드의 차례가 된다.

명령은 모두 이 파일이 있는 디렉터리의 `bin/uhd-kanban.mjs` 다. 아래에서 `uk` 는 `node <이 스킬의 base directory>/bin/uhd-kanban.mjs` 를 줄여 적은 것이다. 프로젝트 안 어느 디렉터리에서 불러도 된다. 루트는 `.uhd-kanban/config.json` 이 있는 디렉터리이고, git worktree 안에서 부르면 주 worktree 의 루트를 쓴다.

종료 코드는 0 성공 · 1 규칙 위반이나 실행 실패 · 2 사용법 오류 · 3 부른 디렉터리 위에 보드가 없음이다. 1 이면 stderr 의 문제 목록을 읽고 고친다.

## 지킬 것

1. **frontmatter · 파일 이름 · 디렉터리는 명령으로만 바꾼다.** 순서 번호 · id · 상태가 파일 이름과 frontmatter 에 나뉘어 있고, 명령은 잠금(`.uhd-kanban/lock/` 디렉터리) 안에서 둘을 함께 바꾼다. 파일을 직접 옮기거나 이름을 바꾸지 않는다.
2. **코멘트는 `uk comment` 로만 쓴다.** 번호 · 머리 줄 형식을 명령이 정한다.
3. **카드 본문(`## Comments` 앞)을 직접 고쳤으면 `uk check` 를 실행한다.** 종료 코드 0 이 나와야 한다.
4. **`uk comment` 가 낸 `SendMessage to=<이름> message=<JSON>` 줄은 그대로 SendMessage 도구로 보낸다.** 명령은 메시지를 보내지 않는다(Claude Code 2.1.312 에 메시지를 보내는 CLI 명령이 없다). `# claude agents --json 에 없는 이름이다` 가 붙은 줄은 보내지 말고 사용자에게 알린다.
5. **본문과 코멘트에서 낱말 `ultracode` 는 감싸서 쓴다.** 백틱 · `[ ]` · `" "` · `' '` 중 하나로 감싼다. 감싸지 않은 낱말은 그 본문을 프롬프트로 받은 세션을 Workflow 로 바꾼다. 트리거로 쓸 때만 본문 첫 줄에 `ultracode` 한 줄을 두고 카드에 `ultracode` 태그를 단다. 둘 중 하나만 있으면 `check` 가 위반으로 알린다.

## 파일 배치

| 경로 | 내용 |
|---|---|
| `.uhd-kanban/config.json` | 열 · 순서 번호 · 의존성 · 코멘트 kind · 아카이브 · `run` · `monitor` 설정 |
| `.uhd-kanban/profiles.json` | `model:` 태그의 프로필 이름을 `claude --model` 값으로 바꾸는 표 |
| `kanban/<n>-<status>/<순서 번호>-k<id>-<제목>.md` | 열 안의 카드. 예: `kanban/1-to-do/0010-k457-로그인-오류-재현.md` |
| `kanban/archived/<YYYY-MM>/<YYYY-MM-DD>-k<id>-<제목>.md` | 아카이브한 카드. 날짜는 `completed_at` 의 날짜다 |

열 디렉터리는 카드가 처음 들어갈 때 생기고, 마지막 카드가 나가면 지워진다. 숨김 파일(`.DS_Store` 등)이 남은 디렉터리는 지우지 않는다.

기본 열 아홉 개(`templates/config.json`):

| 디렉터리 | status | 둘 수 있는 type |
|---|---|---|
| `1-to-do` | `to-do` | task · bug · decision |
| `2-in-progress` | `in-progress` | task · bug · decision |
| `3-in-review` | `in-review` | task · bug |
| `4-done` | `done` | task · bug · decision |
| `5-decided` | `decided` | decision |
| `6-planned` | `planned` | milestone |
| `7-implemented` | `implemented` | decision |
| `8-cancelled` | `cancelled` | task · bug |
| `9-active` | `active` | milestone |

## 카드

```markdown
---
id: 457
type: task
title: 로그인 오류 재현
priority: high
tags: [model:deep, effort:high]
depends_on: [455]
created_at: 2026-10-29T08:00:00Z
updated_at: 2026-10-29T09:10:00Z
---

본문. `uk run` 이 이 부분을 세션 프롬프트로 쓴다.

## Comments

### c1 [배정] from=user to=k457 at=2026-10-29T09:00:00Z

claude --bg 로 시작했다. session=… model=opus(model:deep) effort=high
```

| 키 | 값 |
|---|---|
| `id` | 정수. 파일 이름의 `k<id>` 와 같다. 아카이브한 카드까지 포함해 가장 큰 id + 1 이 다음 id 다 |
| `type` | `task` · `bug` · `decision` · `milestone` 중 그 열이 허용하는 것 |
| `priority` | `critical` · `high` · `medium` · `low` |
| `tags` | 문자열 목록. `model:` · `effort:` · `ultracode` 는 아래 「실행」의 규칙을 따른다 |
| `depends_on` | 기다리는 카드 id 목록. `dependencies.gate` 의 열(`in-progress` · `in-review` · `done`)로 옮길 때 그 카드가 모두 `dependencies.resolved` 의 열(`done` · `decided` · `implemented`)이나 아카이브에 있어야 한다. `--force` 로 건너뛴다 |
| `completed_at` | `archive.columns` 의 열(`done`)에 들어갈 때 적히고 그 열에서 나가면 지워진다 |
| `session` · `session_started_at` | `uk run` · `uk recover` 가 적는 세션 id 와 그 세션의 시작 시각 |

상태와 순서는 frontmatter 에 적지 않는다.

## 명령

자리는 `--top` · `--bottom` · `--before <k id>` · `--after <k id>` 중 하나이고 기본은 `--bottom` 이다. 카드는 `k457` 또는 `457` 로 가리킨다.

| 명령 | 하는 일 |
|---|---|
| `uk init [--dir <경로>]` | `.uhd-kanban/`(config.json · profiles.json)과 `kanban/` 을 만든다. 이미 있으면 바꾸지 않고 종료 코드 1 |
| `uk check` | config.json · profiles.json 과 모든 카드를 검증한다. 파일은 바꾸지 않는다 |
| `uk new --type <type> --title <제목> [--status to-do] [--priority medium] [--tags a,b] [--depends k1,k2] [--body-file <경로>] [자리]` | 카드를 만든다 |
| `uk move <k id> <status> [자리] [--force]` | 다른 열로 옮긴다 |
| `uk order <k id> <자리>` | 같은 열 안에서 자리를 바꾼다. 카드 내용은 바뀌지 않는다 |
| `uk renumber <status>` | 그 열의 순서 번호를 지금 차례대로 `order.step` 간격으로 다시 매긴다 |
| `uk set <k id> [--title] [--priority] [--add-tag a,b] [--remove-tag a,b]` | 제목 · 우선순위 · 태그를 바꾼다. 제목이 바뀌면 파일 이름도 바뀐다 |
| `uk archive [--dry-run]` | `archive.columns` 열에서 `completed_at` 뒤 `archive.after_days`(기본 7)일이 지난 카드를 `kanban/archived/<YYYY-MM>/` 로 옮긴다 |
| `uk comment <k id> --kind <kind> --to <이름>[,<이름>] [--from <이름>] (--text <글> \| --text-file <경로>)` | 코멘트를 덧붙이고 SendMessage 줄을 낸다 |
| `uk inbox [<이름>] [--all]` | 그 이름 앞으로 온 코멘트 중 답하지 않은 것을 낸다 |
| `uk run <k id> [--dry-run] [--force]` | 카드 본문으로 `claude --bg` 세션을 띄운다 |
| `uk recover [<k id>…] [--dry-run]` | 멈춘 세션을 `claude --bg --resume` 으로 이어 간다 |
| `uk guard <경로> [--session <session id>]` | 그 세션이 그 파일을 고쳐도 되는지 판정한다. 0: 카드 세션(이름 `k<id>`) · 프로젝트 밖 · `kanban/` · `.uhd-kanban/` 안. 1: 메인 세션이 프로젝트 파일을 고치려 한다(이유는 stderr). `--session` 이 없으면 `CLAUDE_CODE_SESSION_ID` 를 쓴다. 규칙은 `../delegate/SKILL.md` |
| `uk board [--json]` | 열마다 카드 수와 `run.status` 열 카드의 세션 판정을 낸다. 파일 이름만 읽고 카드 파일은 `run.status` 열의 것만 연다. 규칙 검사는 하지 않는다 |

순서 번호 사이에 빈 번호가 없으면 명령이 그 열 전체를 다시 매긴다.

## 코멘트

머리 줄 형식은 `### c<번호> [<kind>] from=<이름> to=<이름>[,<이름>] at=<ISO 8601 UTC>` 다. 번호는 카드마다 1 부터 빈 번호 없이 늘어난다.

- 이름은 `claude agents --json` 의 세션 이름이다. 사용자는 `user` 다. `uk run` 이 띄운 세션의 이름은 `k<id>` 다.
- `--from` 을 주지 않으면 이 세션의 이름을 쓴다(`CLAUDE_CODE_SESSION_ID` 로 `claude agents --json` 에서 찾는다).
- kind 는 `config.json` 의 `comments.kinds` 중 하나다. `배정` · `진행` · `질문` · `결과` 는 `run` · `recover` 가 쓰므로 빼면 `check` 가 위반으로 알린다.
- 본문에 `### c` 로 시작하는 줄과 `## Comments` 줄을 쓸 수 없다.
- 답했다는 것은 같은 카드에 그 이름이 `from` 인 코멘트가 뒤에 있다는 뜻이다. 읽은 표시는 따로 저장하지 않는다.

## 실행

`uk run k457` 이 하는 일:

1. 카드의 `model:<프로필>` 태그를 `profiles.json` 으로 `--model` 값으로 바꾼다. `effort:<값>` 태그가 있으면 `--effort` 로 넘긴다. 태그가 없으면 그 옵션을 넘기지 않아 claude 의 기본 모델 · 기본 effort 로 띄운다.
2. 카드를 `run.status` 열(`in-progress`)로 옮긴다. 의존성 검사는 `move` 와 같다.
3. `claude --bg -n k457 --model … <프롬프트>` 를 프로젝트 루트에서 실행한다. 프롬프트는 카드 본문 뒤에 `진행` · `질문` · `결과` 코멘트를 남기는 명령을 붙인 것이다.
4. 카드에 `session` · `session_started_at` 과 `[배정]` 코멘트를 적는다.

| 프로필 | `--model` | ultracode 확인 |
|---|---|---|
| `model:top` | `fable` | 확인함 |
| `model:deep-1m` | `opus[1m]` | 확인함 |
| `model:deep` | `opus` | 확인함 |
| `model:standard` | `sonnet` | 확인함 |
| `model:fast` | `haiku` | 확인함 |
| `model:user` | 없음 | 사람이 하는 카드다. `run` 이 띄우지 않는다 |

「확인함」은 2026-10-29(2.1.312)에 그 모델의 대화 기록에 `workflow_keyword_request` 가 생긴 것까지다. Workflow 도구를 실제로 부르는지는 확인하지 않았다. `profiles.json` 의 `ultracode` 가 `true` 가 아닌 프로필과 `model:` 태그가 없는 카드(기본 모델이 무엇인지 표에 없다)에는 `run` 이 ultracode 카드를 띄우지 않는다.

**`run` · `recover` 는 신뢰된 workspace 에서만 된다.** `claude --bg` 는 workspace trust 를 상위 디렉터리에서 물려받지 않는다. 프로젝트 루트에서 `claude` 를 한 번 열어 trust 대화 상자를 수락해야 한다. 수락하지 않았으면 `Workspace not trusted` 로 실패하고 카드는 바뀌지 않는다. trust 설정은 사용자가 바꾼다.

`run` 은 카드의 이전 세션이 아직 돌거나 다시 뜨는 중이면 새로 띄우지 않는다.

## 이어 가기

`uk recover` 는 `run.status` 열의 카드마다 `claude agents --json --all` 의 세션 상태와 대화 기록 `~/.claude/projects/<프로젝트>/<session>.jsonl` 의 마지막 줄로 판정한다.

| 판정 | 조건 | 하는 일 |
|---|---|---|
| 돈다 | 프로세스가 있고 아래 「멈춤」이 아니다 | 없음 |
| 다시 뜨는 중 | `pid` 없이 `state working` | 없음. 잠시 뒤 다시 실행한다 |
| 끝남 | `state done` | 없음. 결과 코멘트를 보고 카드를 옮긴다 |
| 이어 감 | 세션이 목록에 없거나 `state stopped` | `claude --bg --resume <session>` |
| 멈춤 | 데몬이 다시 띄웠고(`startedAt` 이 `session_started_at` 과 다르다) `status idle` 이고 대화 기록의 마지막 줄이 user | `claude stop` 뒤 `claude --bg --resume <session>` |

이어 간 세션은 새 session id 로 뜬다(2026-10-29 실측). `recover` 는 카드의 `session` · `session_started_at` 을 새 값으로 고치고 `[배정]` 코멘트를 남긴다. 이어 간 세션은 카드의 마지막 `[진행]` 코멘트부터 이어 간다.

`session` 이 비었거나 대화 기록이 없는 카드는 이어 갈 수 없으므로 종료 코드 1 로 알린다.

## 보드 모니터

이 스킬이 든 플러그인 `uhd-kanban` 의 hooks 모듈(`hooks/register.tsx`)이 세션 디렉터리 위에 보드가 있으면 pane 을 열고, 열마다 카드 하나를 한 칸으로 그린다. 축(열마다 카드 수)이 위에 있고 막대는 아래로 자란다. `run.status` 열의 칸은 세션 판정(`recover` 와 같은 판정)으로 색이 바뀐다.

- 갱신 주기는 `config.json` 의 `monitor.interval_seconds` 다(10 이상의 정수, 기본 60). 값을 바꾸면 다음 갱신부터 그 주기로 다시 읽는다.
- 같은 모듈이 Edit · Write · NotebookEdit 앞에서 `uk guard` 를 실행하고, 종료 코드 1 이면 사용자에게 확인 창을 띄운다(`../delegate/SKILL.md`).
- pane 은 `uk board --json` 의 stdout 을 그리기만 한다. 보드가 없는 디렉터리(종료 코드 3)에서는 열지 않는다. 닫힌 pane 은 `/kanban-board` 로 다시 연다.
