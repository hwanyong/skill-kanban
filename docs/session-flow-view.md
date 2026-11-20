# 세션 흐름 view 설계(uhd-kanban 두 번째 pane)

2026-11-20 설계, 같은 날 1단계 구현(uhd-kanban 0.19.0). 결정 A(uhd-kanban 안의 두 번째 pane)와 결정 B(hover 를 선언한 칸은 제목 줄만 activate Client 로 덮는다)를 전제로 한다.

카드와 카드 세션, 카드 사이의 `depends_on`, 세션 사이의 메시지를 한 pane 에 그린다. 벤치마킹 대상은 hide(with-hide/hide)의 미션 맵이다. hide 의 사용 허가는 FSL-1.1-ALv2 이므로 코드는 가져오지 않고 기능만 참고한다.

## 1. 이름

| 무엇 | 값 | 기존 보드 모니터의 값 |
|---|---|---|
| pane-grid member id | `uhd-kanban.flow` | `uhd-kanban` |
| pane id(`$.ui.open`) | `uhd-kanban-flow` | `uhd-kanban-board` |
| 슬래시 명령 | `/kanban-flow` | `/kanban-board` |
| 데이터 명령 | `uk flow --json` | `uk board --json` |
| 메시지 기록 명령 | `uk message-log [--session <id>]`(stdin JSON 하나) | - |

member id 는 pane-grid 0.6.0(origin/main 036e392)이 받는다. 그 판의 `skills/add-pane-grid-cell/pane-grid.ts` 가 `readPlacement` · `placementIn` · `fillSlot` · `offerChoice` 의 인자를 member id 로 받고, `offerKey(memberId)` · `hoversKey(memberId)` 를 더했다. uhd-kanban 의 `hooks/pane-grid.ts` 는 그 판의 사본이다.

## 2. hide 기능과 uhd-kanban 대응

| hide 기능 | uhd-kanban 의 대응 | 범위 |
|---|---|---|
| 미션 | 열린 milestone 과 그 `collection` 소속 카드. 소속이 없는 카드는 `소속 없음` 묶음 | 1단계 |
| 노드 | 작업 카드 하나 | 1단계 |
| 노드 사이의 선 | 카드의 `depends_on` | 1단계 |
| Conductor | 메인 세션(`.uhd-kanban/main.json` 의 `name`) | 1단계(머리 줄에 이름만) |
| worker 상태 | `cardSession` 의 verdict(live · resume · restart · pending · done · unknown · none) | 1단계 |
| 머리 줄 `Running · 50m so far · 1/4 done` | milestone 의 진행 상태 · 첫 `session_started_at` 부터 지난 시간 · 끝낸 수/전체 수 · 도는 세션 수/`run.max_parallel` | 1단계 |
| 노드 상세 Connections | 그 카드의 `depends_on`(앞) 과 그 카드를 `depends_on` 에 적은 카드(뒤, `lib/cards.mjs` 의 `dependentsOf`) | 1단계 |
| 노드 상세 Result | 마지막 `result` 코멘트 본문 앞 3줄. 없으면 마지막 `progress` | 1단계 |
| 노드 상세 Record | 대화 기록 파일 경로(`cardSession` 의 `transcript`) | 1단계 |
| 노드 상세 Resume | `uk recover k<id>` 실행 Button(7절) | 1단계 |
| 노드 상세 Terminal | 대응 없음. pane 에서 다른 세션의 터미널을 열 수단이 엔진에 없다 | 하지 않는다 |
| ↓ / → 방향 전환 | 같은 배치를 세로 · 가로로 그린다 | 1단계 |
| 확대 −/+/Fit | 노드 크기 단계(3줄 노드 · 1줄 노드). 터미널 글자는 배율을 바꿀 수 없다 | 1단계 |
| hover 툴팁 | 노드 Box 의 `hover`. pane-grid 칸 안에서는 0.6.0 의 `hovers:` 선언이 필요하다 | 1단계 |
| 세션 사이 메시지 | 보낸 쪽의 `session.send` 훅이 적은 기록과 카드 코멘트(`from=` · `to=`) | 1단계 |
| PR · branch 표시 | 카드에 필드가 없다. `commits` 개수만 보인다 | 하지 않는다 |
| Done when | 카드에 필드가 없다 | 하지 않는다 |
| Unread · Seen | 읽음 상태를 적는 곳이 없다 | 하지 않는다 |

## 3. 데이터

### 3.1 `uk flow --json`

`skills/uhd-kanban/lib/commands/flow.mjs`. 보드를 읽는 규칙은 `board.mjs` 와 같은 함수를 쓴다(`viewBoard` · `boardLanes` · `cardSession` · `parseComments`). 그리기는 mod 가 하고 이 명령은 값만 낸다.

| 필드 | 값 | 근거 함수 |
|---|---|---|
| `root` · `interval_seconds` · `run_status` · `max_parallel` · `main` · `working` | 보드 root, 갱신 주기, `run.status`, `run.max_parallel`, 메인 세션 이름, 도는 세션 수 | `loadProject` · `maxParallel` · `readMain` · `RUNNING_VERDICTS` |
| `columns[]` | 작업 카드를 받는 열마다 `{ status, index }`. 노드 테두리 색을 고른다 | `config.columns` |
| `groups[]` | milestone 마다 `{ key, id, title, status, is_running, finished, total, started_at, cards[] }`. 차례는 `boardLanes` 와 같다 | `boardLanes` |
| `cards[]` | `{ id, title, status, column_index, depends_on, dependents, verdict, session, started_at, completed_at, last_activity_at, commits, progress, result, transcript }` | `cardSession` · `parseComments` · `dependentsOf` · `lastActivityAt` |
| `messages[]` | `{ at, from, to, kind, card, text }`. 3.2 의 기록과 카드 코멘트를 시각 차례로 합친 최근 200개. 기록에서 온 것은 `kind` · `card` 가 `null` 이다 | `lib/message-log.mjs` 의 `readMessages`. 파일 이름은 i18n 문구 디렉터리 `lib/messages/` 와 겹치지 않게 정했다 |

- `started_at` 은 그 묶음 카드의 `session_started_at` 중 가장 이른 값이다. 머리 줄의 지난 시간이 이 값에서 나온다.
- `result` · `progress` 는 그 kind 의 마지막 코멘트 본문이고 1000자에서 자른다. 메시지 본문은 200자에서 자른다. 2026-11-20 plugin-pane-grid 보드(카드 38장)에서 자르지 않은 출력이 1,053,790 바이트였기 때문이다. 전문은 카드 파일과 대화 기록에 있다.
- `messages` 의 `from` 은 보낸 session id 를 이름으로 바꾼 값이다. 카드 세션은 `k<id>`, 메인 세션은 `main.json` 의 이름, 나머지는 `claude agents --json` 의 `name` 이고, 이름을 찾지 못하면 session id 그대로다.
- `messages` 의 `to` 는 SendMessage 의 `to` 에서 두 가지를 바꾼 값이다. `이름 [짧은 id]` 는 이름만 남긴다. 받은 메시지에 답할 때의 `to` 는 보낸 세션의 소켓 주소 `uds:/tmp/cc-socks/<pid>.sock` 이므로(2026-11-20 확인 실행), 지금 그 pid 로 도는 세션이 있으면 그 세션의 이름으로 바꾼다.

`uk board --json` 에 합치지 않는다. 보드 모니터는 `interval_seconds` 마다 `board` 를 실행하는데, 세션 흐름 view 를 열지 않은 세션에서 대화 기록 읽기와 메시지 합치기가 매번 함께 돌기 때문이다. 두 명령은 각자의 pane(또는 grid 칸)이 열려 있을 때만 실행한다.

### 3.2 메시지 기록

1차 확인 실행(2026-11-20, 2.1.329)에서 SendMessage 한 번에 보낸 세션의 `session.send`(`to` · `text` · `origin.kind: "model"`)가 실행됐다. 받은 세션의 `session.receive` 에는 보낸 세션 id 필드가 없었다. 그래서 보낸 쪽에서 기록한다.

| 단계 | 하는 일 | 파일 |
|---|---|---|
| 1 | `session.send` 훅이 `next(e)` 의 결과에서 `isDelivered` 가 참이고 `e.origin.kind` 가 `model` 일 때만 다음 단계를 실행한다 | `hooks/register.tsx` |
| 2 | `$.process.run(['node', <bin>, 'message-log', '--session', $.session.id()], { stdin })` 로 `{ to, text, agent_id? }` 를 넘긴다. `agent_id` 는 subagent 가 보냈을 때만 있다. 실패는 무시한다(`.catch(() => null)`) | `lib/commands/message-log.mjs` |
| 3 | `.uhd-kanban/message-log/<session id>.jsonl` 에 `{ at, to, text, agent_id? }` 한 줄을 더한다. 시각은 이 명령이 적는다 | `lib/message-log.mjs` |

- `from` 이름은 적지 않는다. 이름은 `/rename` 으로 바뀌므로 `uk flow` 가 읽을 때 session id 로 찾는다(3.1).
- `message-log` 이름을 `lib/root.mjs` 의 `MESSAGE_LOG_NAME` 으로 두고 실행 중 파일 이름 목록에 더해 `.uhd-kanban/.gitignore` 가 무시하게 했다(0.18.1 의 `IGNORE_ENTRIES`).
- 카드 세션의 보고(progress · question · result)는 `uk comment` 가 카드 코멘트로 이미 적는다. mod 가 그 보고를 `$.session.send` 로 보낼 때의 `origin` 은 엔진 타입에서 `{ kind: 'plugin', name }` 이므로 1단계의 조건에서 빠진다. 이 경로를 실제로 실행해 확인하지는 않았다.
- 메시지 본문은 전문을 적는다. `.uhd-kanban/` 은 프로젝트 안에 있고 위 무시 규칙으로 git 에 들어가지 않는다.
- `uk message-log` 의 종료 코드: 0 적었다, 2 session id 나 입력의 형식이 다르다, 3 보드가 없다.

## 4. 그리기

### 4.1 배치 계산: `hooks/flow-layout.ts`

입력은 한 묶음의 카드(`{ id, depends_on }`)와 방향(↓ · →)과 노드 크기 단계와 그릴 너비이고, 출력은 `FlowLayout { size, components, listed, cycle }` 이다. component 마다 노드 좌표와 선 줄(문자열)이 있고, 그리기 코드는 이 출력만 읽는다.

1. component: `depends_on` 으로 이어진 카드끼리 한 component 다. 묶음 밖 카드에 대한 `depends_on` 은 배치에서 빼고 노드 상세의 앞 · 뒤에만 보인다. 이어진 카드가 없는 카드는 마지막 component 하나에 모아 너비에 맞춰 여러 줄로 놓는다.
2. 순환: DFS 로 찾은 back edge 를 층 계산에서 뺀다. 처음 찾은 순환을 `cycle` 로 내고 머리 줄에 `순환 k1 → k6 → k1` 로 적는다. 지금 `uk check` 는 `depends_on` 의 id 가 있는지만 보고 순환은 보지 않는다(`lib/cards.mjs` 의 `assertRefs`).
3. 층(layer): `depends_on` 을 따라 가장 긴 앞 카드 사슬의 길이. 층을 건너뛰는 선에는 dummy 노드를 둔다.
4. 층 안 차례: barycenter(앞 층에서 연결된 노드 차례의 평균) 정렬을 위에서 아래로 한 번, 아래에서 위로 한 번 한다.
5. 좌표: 3줄 노드는 24칸 x 3줄, 1줄 노드는 `2 + id 자릿수` 칸 x 1줄이다. 같은 층 안 노드 사이는 세로 배치 2칸, 가로 배치 1줄이다. 층 사이는 나가는 줄 · 꺾는 줄 · 들어가는 줄이고, 꺾는 줄은 보내는 노드마다 track 을 하나 받는다. 가로 범위가 겹치는 두 노드는 다른 track 을 쓴다. 가로 배치는 층 사이를 6칸보다 좁히지 않는다.
6. 선: 칸마다 방향 비트를 모아 괘선 문자 하나로 바꾼다. 화살표는 `▼` · `▶` 다.

3줄 노드로 그린 component 하나라도 너비를 넘으면 묶음 전체를 1줄 노드로 다시 계산한다. 1줄 노드로도 넘는 component 는 `listed` 로 내고 그리기 코드가 `k1 → k2, k3` 꼴의 목록 줄로 그린다. 세로로 넘치는 것은 pane 스크롤로 본다.

### 4.2 요소 차례: `hooks/flow.tsx`

| 차례 | 요소 | 이유 |
|---|---|---|
| 1 | 머리 줄(Text) | 갱신 시각 · 메인 세션 이름 · 도는 세션 수 · 묶음 진행 · 순환 |
| 2 | 조작 줄(Button, Text) | 묶음 고르기 Button(`‹` · `›`), 방향 Button(`↓` · `→`), 노드 크기 Button(`−` · `+`). 고른 Button 은 반전한다. 묶음 이름과 1줄 노드로 바꾼 이유는 폭 0 · `flexGrow` Box 안에서 잘라 한 줄을 지킨다 |
| 3 | 선 줄(Text) | 줄마다 Text 하나 |
| 4 | 노드(`position="absolute"` Box 안의 Button) | 선 줄 위에 그린다. 테두리 색은 그 카드 열의 `columnColor`, 상태 기호는 `sessionCell` · `plainCell` 이 고른다. 고른 노드는 이중 테두리다 |
| 5 | 목록 줄 · 노드 상세 · 최근 메시지 | 노드를 누르면 고른 카드의 상세가 보이고, 고르지 않았으면 최근 메시지 10개가 보인다 |
| 6 | hover 툴팁(absolute Box) | 트리 맨 끝에 둔다. 2026-11-20 확인에서 툴팁 뒤에 그린 형제가 툴팁 위에 그려졌기 때문이다. 노드와 `hover.scope` 를 `flow-k<id>` 로 같게 한다 |

- 툴팁 내용: `k<id>` 와 카드 제목, 마지막 progress 첫 줄, 시작 · 마지막 활동 시각. 노드 아래에 두고, 그린 줄 수를 넘으면 노드 위에 둔다. 가로 위치는 그릴 너비 안으로 자른다. 줄마다 폭을 공백으로 채워 밑의 글자가 테두리 안에 보이지 않게 한다.
- 노드 상세의 기록 줄은 `기록` 이름표를 자르는 Text 밖에 두고 경로만 `truncate-start` 로 자른다.
- grid 칸에 그릴 때 `cell:uhd-kanban.flow` Box 안에 `hoversKey('uhd-kanban.flow')` Box 를 둔다. 0.6.0 앞 판에서는 활성 칸에서만 툴팁이 나타난다.
- 고른 묶음 · 방향 · 노드 크기 · 고른 카드는 보드 root 마다 `$.store` 의 `flowSettings:<root>` 에 둔다(보드 모니터의 `collapsedLanes:<root>` 와 같은 방식).
- `claude plugin validate` 의 두 가지 규칙 때문에 모양이 정해졌다. ① import 너머로 `$` 를 받는 함수는 `function` 선언이어야 한다. 그래서 `flow.tsx` 의 export 함수(`drawFlow` · `loadFlowSettings` · `setFlowView` · `setFlowNotice` · `readFlowKind`)는 화살표 함수가 아니다. ② `update` · `read` 는 같은 파일에서 정의한 atom 만 받는다. 그래서 `flowView` · `flowSettings` · `flowNotice` atom 은 `flow.tsx` 에 두고 `register.tsx` 는 위 함수로만 바꾼다.

### 4.3 `hooks/register.tsx` 변경

| 무엇 | 바꾸기 전 | 바꾼 뒤 |
|---|---|---|
| 갱신 타이머 | `tick` 이 보드 모니터 pane 이나 칸이 있을 때 `board` 를 실행 | 같은 타이머가 열린 pane 마다 `board` · `flow` 를 실행. 주기는 둘 다 `interval_seconds` |
| `ui.render` | `PANE` 하나, grid 훅이 `uhd-kanban` 칸 하나 | `uhd-kanban-flow` pane 훅 추가, grid 훅이 `MEMBERS` 의 member id 두 개마다 `offer:` Box 와 칸을 그린다 |
| `state.set`(pane-grid `layout`) | `placeOwnPane` 이 `uhd-kanban` 만 본다 | member id 마다 실행한다. 칸에 놓이면 그 member 의 자기 pane 을 닫는다 |
| `session.send` | 없음 | 3.2 의 기록 |
| `command.run` | `/kanban-board` | `/kanban-flow` 추가 |
| `session.start` | 보드가 있으면 보드 모니터 pane 을 연다 | 바꾸지 않았다. 세션 흐름 view 는 `/kanban-flow` 나 grid 배치로만 연다 |

## 5. 확인 차례와 결과

`~/.claude/CLAUDE.md` §16 에 따라 단위 시험 파일을 쓰지 않고 아래 계층부터 실제 실행으로 확인했다. 2026-11-20 결과다. 실제 보드는 `plugin-pane-grid` 저장소의 `kanban/`(카드 38장)을 복사한 git 저장소에서 읽었다.

| 차례 | 계층 | 확인한 것 | 일부러 깨 본 것 |
|---|---|---|---|
| 1 | `uk flow --json` | k6 의 `depends_on` `[1, 2, 3, 4, 7, 9]` 와 k7 의 `dependents` `[6]` 이 카드 파일(`grep -l` 로 k7 을 적은 카드가 k6 하나였다)과 같았다 | k1 을 없는 session id 로 in-progress 열에 두자 verdict 가 `resume` 이었다 |
| 2 | `uk message-log` | stdin 한 줄이 `.uhd-kanban/message-log/<session id>.jsonl` 에 들어갔고 `git status` 에 그 디렉터리가 보이지 않았다 | 형식이 다른 입력에서 종료 코드 2, 보드가 없는 디렉터리에서 종료 코드 3 이었고 그 디렉터리에는 파일이 생기지 않았다 |
| 3 | `session.send` 훅 | 시험 세션 두 개(tmux)에서 SendMessage 를 보냈다. 보낸 쪽과 답한 쪽 파일에 한 줄씩 들어갔고, `uk flow` 의 `messages` 에 `flow-probe-a → flow-probe-b` 와 그 반대 방향이 이름으로 나왔다 | 받는 이름이 두 세션에 겹쳐 전달이 거절된 SendMessage(`isDelivered` 거짓)는 기록되지 않았다 |
| 4 | `flow-layout.ts` | 시험 DAG 와 실제 보드에서 두 방향 모두 층 · 차례가 카드와 같았다. 120칸에서 3줄 노드가 넘쳐 1줄 노드로 바뀌었고, 30칸에서는 일부 component 가 목록 줄로 나왔다 | k1 의 `depends_on` 을 `[6]` 으로 바꾸자 머리 줄에 `순환 k1 → k6 → k1` 이 나왔다 |
| 5 | 자기 pane | tmux 160x45 에서 `/kanban-flow` 로 열었다. SGR 클릭으로 → Button 을 누르자 가로 배치로 바뀌었고, 노드를 누르자 상세가 나왔다. 설정이 `/reload-plugins` 뒤에도 남았다. 상세의 `uk recover k1` Button 을 누르자 상세 아래에 `종료 코드 1 · <stderr 마지막 줄>` 이 나왔다 | - |
| 6 | grid 칸 | pane-grid 0.6.0 에서 `/grid place uhd-kanban.flow c7` 과 `/grid place uhd-kanban c8` 을 함께 두었다. 두 칸이 각자 그려졌고 자기 pane 은 닫혔다. 35칸 너비 칸에서 조작 줄이 한 줄이었다. c8 이 활성인 동안 c7 노드 위의 SGR motion 으로 툴팁이 나왔다 | `hoversKey` Box 를 뺀 판에서 같은 motion 을 보내자 툴팁이 나오지 않았다 |

- tmux 시험 세션을 이 세션의 Bash 에서 띄우면 `CLAUDE_CODE_*` 환경 변수를 물려받는다. 그 상태에서 시험 세션에 `/rename` 을 보내자 이 세션의 job 이름이 함께 바뀌었다. 시험 세션은 `env -u <CLAUDE_* 이름들> claude` 로 띄운다.

## 6. 단계

| 단계 | 내용 | 상태 |
|---|---|---|
| 1 | 3절 데이터 · 4절 그리기 · 노드 상세(Connections · Result · Record · Resume) · 메시지 기록 · README 두 벌(`README.md` · `README.ko.md`) | 2026-11-20 구현 · 확인 |

## 7. 결정

| 결정 | 정한 것 | 정한 날 |
|---|---|---|
| pane 의 Button 이 세션을 띄우게 할지 | 노드 상세에 Resume Button 을 두고, verdict 가 resume · restart 일 때만 `uk recover k<id>` 를 실행한다 | 2026-11-20 사용자 승인 |
