import { atom, read, update } from 'claude-code'
import type { EngineInterface, RenderElement } from 'claude-code'

import { ageOf, clipWidth, displayWidth } from './charts'
import type { Age } from './charts'
import { layoutFlow } from './flow-layout'
import type { Component, FlowLayout, PlacedNode } from './flow-layout'
import { cellProps, columnColor, plainCell, sessionCell } from './frames'
import type { Cell } from './frames'
import type { FileAction, Flow, FlowCard, FlowGroup, FlowNotice, FlowSettings, FlowView, Locale } from '../types'

// 세션 흐름 view(보드 모니터 mod 의 두 번째 pane). `uhd-kanban flow --json` 의 결과로 milestone 묶음 하나의 카드를 depends_on 의 층으로 그린다.
// 배치는 flow-layout.ts 가 계산하고, 이 모듈은 머리 줄 · 선 · 노드 · 노드 상세 · 최근 메시지 · hover 툴팁을 그린다. 명령 실행과 타이머는 register.tsx 가 갖는다.
// 설계: docs/session-flow-view.md 4.2 절. 노드를 누르면 그 카드의 상세가 보이고, 같은 노드를 다시 누르면 최근 메시지로 돌아간다.
// 툴팁은 트리 맨 끝에 둔다. 2026-11-20 확인에서 툴팁 뒤에 그린 형제가 툴팁 위에 그려졌다. 노드와 툴팁은 hover.scope 로 묶는다.
// 노드 상세(cardDetail)와 hover 툴팁(cardTooltip)은 보드 모니터 pane(register.tsx)도 막대 칸의 카드에 쓴다. 카드 값은 둘 다 flow 명령의 결과(readFlowCards)다.

// pane-grid 의 member id 이자 자기 pane 의 이름에 쓰는 view 이름.
export const FLOW_VIEW = 'flow'
const RECENT_MESSAGES = 10
const TOOLTIP_WIDTH = 44
// 세션을 다시 띄울 수 있는 판정. docs/session-flow-view.md 7절(2026-11-20 사용자 승인).
const RECOVERABLE = ['resume', 'restart']

const FLOW_TEXT = {
  ko: {
    reading: '세션 흐름을 읽는 중이다',
    noBoard: '이 세션의 project root 위에 .uhd-kanban/config.json 이 없고 이 세션을 메인 세션으로 등록한 보드도 없다',
    failedAt: (clock: string) => `flow 명령이 실패했다 (${clock})`,
    header: (clock: string, main: string | null, working: number, max: number, seconds: number) => `${clock} · 메인 ${main ?? '-'} · 도는 세션 ${working}/${max} · ${seconds}초마다`,
    noMilestone: '소속 없음',
    noGroups: '그릴 묶음이 없다',
    elapsed: (age: string) => `${age}째`,
    compactFallback: ' 폭이 좁아 1줄 노드',
    cycle: (ids: string) => `순환 ${ids}`,
    listed: '폭에 들어가지 않아 목록으로 그렸다',
    before: '앞',
    after: '뒤',
    none: '없음',
    statusLine: (status: string, verdict: string | null, commits: number) => `${status}${verdict == null ? '' : ` · 세션 ${verdict}`} · 커밋 ${commits}개`,
    times: (started: string | null, last: string | null) => `시작 ${started == null ? '-' : `${started} 전`} · 마지막 활동 ${last == null ? '-' : `${last} 전`}`,
    result: '결과',
    progress: '진행',
    record: '기록',
    recover: (id: number) => `uk recover k${id}`,
    details: '상세',
    open: '열기',
    reveal: '위치 보기',
    messages: '최근 메시지',
    noMessages: '메시지가 없다',
    age: ({ value, unit }: Age) => `${value}${{ minute: '분', hour: '시간', day: '일' }[unit]}`,
  },
  en: {
    reading: 'Reading the session flow',
    noBoard: 'No .uhd-kanban/config.json above this session\'s project root and no board registers this session as its main session',
    failedAt: (clock: string) => `The flow command failed (${clock})`,
    header: (clock: string, main: string | null, working: number, max: number, seconds: number) => `${clock} · main ${main ?? '-'} · ${working}/${max} sessions working · every ${seconds}s`,
    noMilestone: 'no milestone',
    noGroups: 'No group to draw',
    elapsed: (age: string) => `${age} so far`,
    compactFallback: ' one-row nodes: too narrow',
    cycle: (ids: string) => `cycle ${ids}`,
    listed: 'Listed: too wide for the pane',
    before: 'before',
    after: 'after',
    none: 'none',
    statusLine: (status: string, verdict: string | null, commits: number) => `${status}${verdict == null ? '' : ` · session ${verdict}`} · ${commits} commits`,
    times: (started: string | null, last: string | null) => `started ${started == null ? '-' : `${started} ago`} · last activity ${last == null ? '-' : `${last} ago`}`,
    result: 'result',
    progress: 'progress',
    record: 'record',
    recover: (id: number) => `uk recover k${id}`,
    details: 'details',
    open: 'open',
    reveal: 'show in folder',
    messages: 'recent messages',
    noMessages: 'No message',
    age: ({ value, unit }: Age) => `${value}${{ minute: 'm', hour: 'h', day: 'd' }[unit]}`,
  },
} satisfies Record<Locale, unknown>

type FlowText = (typeof FLOW_TEXT)[Locale]
type Ui = ReturnType<EngineInterface['ui']['resolve']>

// $ 를 받는 함수는 function 선언으로 쓴다. register.tsx 가 import 해 $ 를 넘기면 claude plugin validate(2.1.329)가 그 뒤로 $ 를 받는 함수 식을 거부한다.
const DEFAULT_SETTINGS: FlowSettings = { group: null, direction: 'down', size: 'full', selected: null }

// atom 은 이 파일에만 둔다. claude plugin validate(2.1.329)는 update 에 같은 파일에서 만든 atom 만 받는다. register.tsx 는 아래 setFlowView · setFlowNotice · readFlowKind 를 부른다.
const flowView = atom({ plugin: 'uhd-kanban', key: 'flowView' } as const, { kind: 'reading' } as FlowView, { shape: 'flow-1' })
// 값을 쓰면 엔진이 pane 을 다시 그린다. 보드 root 마다 $.store 에도 둔다.
const flowSettings = atom({ plugin: 'uhd-kanban', key: 'flowSettings' } as const, DEFAULT_SETTINGS)
// 노드 상세의 recover Button 을 누른 결과 한 줄과 그 카드 id. 그 카드의 상세에만 적고, 다른 카드를 고르면 지운다.
const flowNotice = atom({ plugin: 'uhd-kanban', key: 'flowNotice' } as const, null as FlowNotice | null, { shape: 'notice-2' })

export async function setFlowView($: EngineInterface, value: FlowView) {
  await update($, flowView, () => value)
}

export async function setFlowNotice($: EngineInterface, value: FlowNotice | null) {
  await update($, flowNotice, () => value)
}

export async function readFlowKind($: EngineInterface) {
  return (await read($, flowView)).kind
}

// flow 명령이 낸 카드(id → 카드). 아직 읽지 않았거나 실패했으면 null 이다. ui.render 안에서 부르면 그 그림이 flowView 를 구독한다.
export async function readFlowCards($: EngineInterface) {
  const current = await read($, flowView)
  return current.kind == 'ok' ? new Map(current.flow.cards.map((card) => [card.id, card])) : null
}

async function settingsStoreKey($: EngineInterface) {
  return `flowSettings:${await $.session.root()}`
}

// 저장한 값의 키가 모자라면(앞 판이 적은 값) 기본값으로 채운다.
export async function loadFlowSettings($: EngineInterface) {
  const stored = (await $.store.get(await settingsStoreKey($))) as Partial<FlowSettings> | undefined
  await update($, flowSettings, () => ({ ...DEFAULT_SETTINGS, ...(stored ?? {}) }))
}

async function changeSettings($: EngineInterface, change: (settings: FlowSettings) => FlowSettings) {
  const next = await update($, flowSettings, change)
  await $.store.set(await settingsStoreKey($), next)
}

async function selectCard($: EngineInterface, id: number) {
  await update($, flowNotice, () => null)
  await changeSettings($, (settings) => ({ ...settings, selected: settings.selected == id ? null : id }))
}

const clockText = (ms: number) => {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const ageText = (text: FlowText, now: number, at: string | null) => (at == null || Number.isNaN(Date.parse(at)) ? null : text.age(ageOf(now - Date.parse(at))))

// 고른 묶음이 없거나 사라졌으면 run 중인 milestone, 그것도 없으면 첫 묶음이다.
const currentGroup = (flow: Flow, settings: FlowSettings) => flow.groups.find((group) => group.key == settings.group) ?? flow.groups.find((group) => group.is_running) ?? flow.groups[0]

const cardColor = (card: FlowCard) => columnColor(card.column_index ?? 0)

// 노드의 상태 기호. 세션 판정이 있으면 보드 모니터의 판정 칸과 같은 글자(첫 프레임)이고, 없으면 열 색의 칸이다.
const cardCell = (card: FlowCard): Cell => (card.verdict == null ? plainCell(cardColor(card)) : sessionCell(card.verdict, 0, 0, cardColor(card)))

const cssColor = (value: number) => cellProps(plainCell(value)).color

const scopeOf = (id: number) => `flow-k${id}`

// 묶음 고르기(‹ ›) · 방향(↓ →) · 노드 크기(− +). 고른 값은 반전한다.
// 줄이 넘쳐 두 줄이 되면 툴팁 위치가 어긋나므로 폭이 정해진 Button 을 앞에 두고, 묶음 이름 · 1줄 노드 안내는 남은 폭에서 자른다(width 0 은 laneBlock 의 제목과 같은 이유다).
function controlsRow($: EngineInterface, { Box, Button, Text }: Ui, flow: Flow, group: FlowGroup, settings: FlowSettings, layout: FlowLayout, text: FlowText) {
  const at = flow.groups.indexOf(group)
  const pick = (offset: number) => {
    const next = flow.groups[(at + offset + flow.groups.length) % flow.groups.length]
    return () => void changeSettings($, (current) => ({ ...current, group: next?.key ?? null, selected: null }))
  }
  const toggle = (key: string, glyph: string, isOn: boolean, onPress: () => void) => <Button key={key} plain onPress={onPress}><Text inverse={isOn}>{glyph}</Text></Button>
  return (
    <Box flexDirection="row" height={1}>
      {toggle('flow-prev', '‹', false, pick(-1))}
      <Text> </Text>
      {toggle('flow-next', '›', false, pick(1))}
      <Text> </Text>
      {toggle('flow-down', '↓', settings.direction == 'down', () => void changeSettings($, (current) => ({ ...current, direction: 'down' })))}
      <Text> </Text>
      {toggle('flow-right', '→', settings.direction == 'right', () => void changeSettings($, (current) => ({ ...current, direction: 'right' })))}
      <Text> </Text>
      {toggle('flow-compact', '−', settings.size == 'compact', () => void changeSettings($, (current) => ({ ...current, size: 'compact' })))}
      <Text> </Text>
      {toggle('flow-full', '+', settings.size == 'full', () => void changeSettings($, (current) => ({ ...current, size: 'full' })))}
      <Box width={0} flexGrow={1}>
        <Text wrap="truncate-end"> {group.id == null ? text.noMilestone : `k${group.id}`} <Text dimColor>{at + 1}/{flow.groups.length}{layout.size != settings.size ? ` ·${text.compactFallback}` : ''}</Text></Text>
      </Box>
    </Box>
  )
}

const groupSummary = ({ Text }: Ui, flow: Flow, group: FlowGroup, now: number, text: FlowText) => {
  const elapsed = ageText(text, now, group.started_at)
  const parts = [group.status, elapsed == null ? null : text.elapsed(elapsed), `${group.finished}/${group.total}`].filter((part) => part != null)
  return (
    <Text wrap="truncate-end">
      <Text bold={group.is_running}>{group.id == null ? text.noMilestone : `k${group.id} ${group.title ?? ''}`}</Text>
      <Text dimColor> · {parts.join(' · ')}</Text>
    </Text>
  )
}

// 3줄 노드는 둥근 테두리 안에 상태 기호 · id · 제목, 1줄 노드는 상태 기호 · id 다. 고른 노드는 이중 테두리이거나 id 를 반전한다.
function nodeBox($: EngineInterface, { Box, Button, Text }: Ui, node: PlacedNode, card: FlowCard, isSelected: boolean) {
  const cell = cardCell(card)
  const color = cssColor(cardColor(card))
  const scope = scopeOf(card.id)
  const press = () => void selectCard($, card.id)
  if (node.height == 1) {
    return (
      <Box key={`flow-node:k${card.id}`} position="absolute" top={node.y} left={node.x} hover={{ scope }}>
        <Button key={`flow-k${card.id}`} plain onPress={press}>
          <Text {...cellProps(cell)}>{cell.glyph}</Text>
          <Text color={color} inverse={isSelected}>k{card.id}</Text>
        </Button>
      </Box>
    )
  }
  const label = clipWidth(`k${card.id} ${card.title ?? ''}`, node.width - 4)
  return (
    <Box key={`flow-node:k${card.id}`} position="absolute" top={node.y} left={node.x} width={node.width} height={node.height} borderStyle={isSelected ? 'double' : 'round'} borderColor={color} hover={{ scope, borderStyle: 'double' }}>
      <Button key={`flow-k${card.id}`} plain onPress={press}>
        <Text {...cellProps(cell)}>{cell.glyph}</Text>
        <Text bold={isSelected}> {label}</Text>
      </Button>
    </Box>
  )
}

// component 하나: 선 줄(Text) 위에 노드를 absolute 로 놓는다. 노드 좌표는 이 Box 의 왼쪽 위에서 센다.
function componentBox($: EngineInterface, ui: Ui, component: Component, cards: Map<number, FlowCard>, selected: number | null) {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" width={component.width} height={component.height} flexShrink={0}>
      {component.lines.map((line) => <Text dimColor wrap="truncate-end">{line}</Text>)}
      {component.nodes.flatMap((node) => {
        const card = cards.get(node.id)
        return card ? [nodeBox($, ui, node, card, card.id == selected)] : []
      })}
    </Box>
  )
}

// 1줄 노드로도 폭에 들어가지 않은 component: 카드마다 한 줄에 1줄 노드와 묶음 안 앞 카드를 적는다.
function listedRows($: EngineInterface, ui: Ui, members: number[], cards: Map<number, FlowCard>, selected: number | null) {
  const { Box, Text } = ui
  return members.flatMap((id) => {
    const card = cards.get(id)
    if (!card) return []
    const before = card.depends_on.filter((dep) => members.includes(dep)).map((dep) => `k${dep}`).join(' ')
    const node = { id, x: 0, y: 0, width: 0, height: 1 }
    return [
      <Box flexDirection="row" height={1}>
        <Box width={2 + String(id).length} flexShrink={0}>{nodeBox($, ui, node, card, id == selected)}</Box>
        <Text dimColor wrap="truncate-end">{before == '' ? '' : ` ← ${before}`} {card.title ?? ''}</Text>
      </Box>,
    ]
  })
}

const firstLine = (value: string | null) => (value ?? '').split('\n').find((line) => line.trim() != '') ?? ''

// 노드 상세의 Button 이 부르는 함수. register.tsx 가 명령을 실행한다. recover: uk recover k<id>. file: 카드 파일을 운영체제의 기본 앱이나 파일 관리자로 연다.
export type CardActions = { recover: (id: number) => Promise<void>; file: (id: number, path: string, action: FileAction) => Promise<void> }

// 노드 상세: 제목, 상태 · 세션 판정 · 커밋 수, 시각, 앞 · 뒤 카드, 결과(없으면 진행)의 모든 줄, 대화 기록 경로, 열기 · 위치 보기 Button, recover Button, Button 결과 한 줄.
// 줄을 자르지 않고 columns 폭에서 줄을 바꾼다(2026-11-27 사용자 요청). 본문은 flow 명령이 CARD_TEXT_CHARS(1000자)에서 자른 값이다.
// height 는 글자 폭(displayWidth)을 columns 로 나눠 센 줄 수다. 엔진은 낱말 경계에서 줄을 바꾸므로 실제 줄 수는 이 값 이상이다. 툴팁을 노드 아래에 둘지 정하는 데만 쓴다.
export async function cardDetail($: EngineInterface, { Box, Button, Text }: Ui, card: FlowCard, columns: number, now: number, locale: Locale, actions: CardActions) {
  const text = FLOW_TEXT[locale]
  const notice = await read($, flowNotice)
  const rowsOf = (line: string, width: number) => Math.max(1, Math.ceil(displayWidth(line) / Math.max(1, width)))
  const ids = (values: number[]) => (values.length == 0 ? text.none : values.map((id) => `k${id}`).join(' '))
  const body = card.result ?? card.progress
  const bodyLines = (body ?? '').split('\n').filter((line) => line.trim() != '')
  const title = `k${card.id} ${card.title ?? ''}`
  const status = text.statusLine(card.status, card.verdict, card.commits)
  const times = text.times(ageText(text, now, card.started_at), ageText(text, now, card.last_activity_at))
  const links = `${text.before} ${ids(card.depends_on)} · ${text.after} ${ids(card.dependents)}`
  const recordWidth = displayWidth(`${text.record} `)
  const rows: { element: RenderElement; height: number }[] = [
    { element: <Text bold wrap="wrap">{title}</Text>, height: rowsOf(title, columns) },
    { element: <Text dimColor wrap="wrap">{status}</Text>, height: rowsOf(status, columns) },
    { element: <Text dimColor wrap="wrap">{times}</Text>, height: rowsOf(times, columns) },
    { element: <Text wrap="wrap"><Text dimColor>{text.before} </Text>{ids(card.depends_on)}<Text dimColor> · {text.after} </Text>{ids(card.dependents)}</Text>, height: rowsOf(links, columns) },
    ...(bodyLines.length == 0 ? [] : [
      { element: <Text dimColor>{card.result != null ? text.result : text.progress}</Text>, height: 1 },
      // 들여쓰기를 Box 의 paddingLeft 로 두어 바뀐 줄도 같은 자리에서 시작한다.
      ...bodyLines.map((line) => ({ element: <Box paddingLeft={2}><Text wrap="wrap">{line}</Text></Box>, height: rowsOf(line, columns - 2) })),
    ]),
    // 이름표를 따로 두고 경로는 남은 폭에서 줄을 바꾼다. width 0 은 laneBlock 의 제목과 같은 이유다.
    ...(card.transcript == null ? [] : [{ element: <Box flexDirection="row"><Text dimColor>{text.record} </Text><Box width={0} flexGrow={1}><Text wrap="wrap">{card.transcript}</Text></Box></Box>, height: rowsOf(card.transcript, columns - recordWidth) }]),
    {
      element: (
        <Box flexDirection="row">
          <Button key={`flow-open:k${card.id}`} onPress={() => void actions.file(card.id, card.path, 'open')}>{text.open}</Button>
          <Text> </Text>
          <Button key={`flow-reveal:k${card.id}`} onPress={() => void actions.file(card.id, card.path, 'reveal')}>{text.reveal}</Button>
        </Box>
      ),
      height: 1,
    },
    ...(card.verdict != null && RECOVERABLE.includes(card.verdict) ? [{ element: <Box flexDirection="row"><Button key={`flow-recover:k${card.id}`} onPress={() => void actions.recover(card.id)}>{text.recover(card.id)}</Button></Box>, height: 1 }] : []),
    ...(notice == null || notice.id != card.id ? [] : [{ element: <Text dimColor wrap="wrap">{notice.text}</Text>, height: rowsOf(notice.text, columns) }]),
  ]
  return { elements: rows.map((row) => row.element), height: rows.reduce((sum, row) => sum + row.height, 0) }
}

const messageRows = ({ Text }: Ui, flow: Flow, text: FlowText) => {
  const recent = flow.messages.slice(-RECENT_MESSAGES)
  if (recent.length == 0) return [<Text dimColor>{text.messages}</Text>, <Text dimColor>{text.noMessages}</Text>]
  return [
    <Text dimColor>{text.messages}</Text>,
    ...recent.map((message) => (
      <Text wrap="truncate-end">
        <Text dimColor>{clockText(Date.parse(message.at))} </Text>
        {message.from ?? '-'} → {message.to}
        <Text dimColor>{message.kind == null ? '' : ` [${message.kind}]`} {firstLine(message.text)}</Text>
      </Text>
    )),
  ]
}

// hover 툴팁: 제목 전문, 마지막 progress 첫 줄, 시각. 노드 아래에 두고, 그려진 줄 밖으로 나가면 노드 위에 둔다. 가로는 pane 폭 안으로 자른다.
// 테두리 안 빈칸에 밑의 글자가 비치지 않도록 줄마다 폭을 공백으로 채운다. scope 는 노드 · 칸과 같은 hover 묶음이다.
// action 이 있으면 마지막 줄에 그 Button 을 둔다. 툴팁도 scope 의 한 요소라 포인터를 툴팁으로 옮겨도 툴팁이 보인다.
export type TooltipPlace = { scope: string; top: number; left: number; nodeHeight: number; totalRows: number; columns: number }
export type TooltipAction = { key: string; onPress: () => void }

export const cardTooltip = ({ Box, Button, Text }: Ui, card: FlowCard, place: TooltipPlace, now: number, locale: Locale, action: TooltipAction | null) => {
  const text = FLOW_TEXT[locale]
  const width = Math.max(10, Math.min(TOOLTIP_WIDTH, place.columns))
  const inner = width - 2
  const pad = (line: string) => {
    const clipped = clipWidth(line, inner)
    return `${clipped}${' '.repeat(Math.max(0, inner - displayWidth(clipped)))}`
  }
  const lines = [`k${card.id} ${card.title ?? ''}`, firstLine(card.progress), text.times(ageText(text, now, card.started_at), ageText(text, now, card.last_activity_at))].filter((line) => line != '')
  const height = lines.length + (action == null ? 0 : 1) + 2
  const below = place.top + place.nodeHeight
  const y = below + height <= place.totalRows ? below : Math.max(0, place.top - height)
  const x = Math.max(0, Math.min(place.left, place.columns - width))
  return (
    <Box position="absolute" top={y} left={x} width={width} display="none" hover={{ display: 'flex', scope: place.scope }} borderStyle="single" flexDirection="column">
      {lines.map((line) => <Text>{pad(line)}</Text>)}
      {action == null ? null : (
        <Box flexDirection="row">
          <Button key={action.key} plain onPress={action.onPress}><Text inverse>{text.details}</Text></Button>
          <Text>{' '.repeat(Math.max(0, inner - displayWidth(text.details)))}</Text>
        </Box>
      )}
    </Box>
  )
}

// 자기 pane 과 grid 칸이 함께 쓰는 그리기 함수. columns 는 그릴 너비, actions 는 노드 상세의 Button 이 부르는 함수(register.tsx 가 명령을 실행한다).
export async function drawFlow($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], locale: Locale, columns: number, actions: CardActions) {
  const ui = $.ui.resolve(e)
  const { Box, Text } = ui
  const text = FLOW_TEXT[locale]
  const current = await read($, flowView)
  if (current.kind == 'reading') return <Text dimColor>{text.reading}</Text>
  if (current.kind == 'none') return <Text dimColor>{text.noBoard}</Text>
  if (current.kind == 'error') {
    return (
      <Box flexDirection="column">
        <Text color="error">{text.failedAt(clockText(current.refreshedAt))}</Text>
        <Text>{current.message}</Text>
      </Box>
    )
  }
  const { flow, refreshedAt } = current
  const settings = await read($, flowSettings)
  const width = Math.max(1, columns)
  const header = <Text dimColor wrap="truncate-end">{text.header(clockText(refreshedAt), flow.main, flow.working, flow.max_parallel, flow.interval_seconds)}</Text>
  const group = currentGroup(flow, settings)
  if (!group) return <Box flexDirection="column">{header}<Text dimColor>{text.noGroups}</Text></Box>
  const cards = new Map(flow.cards.map((card) => [card.id, card]))
  const groupCards = group.cards.flatMap((id) => cards.get(id) ?? [])
  const layout = layoutFlow(groupCards, settings.direction, settings.size, width)
  const selected = settings.selected != null && cards.has(settings.selected) ? settings.selected : null
  const top = [
    header,
    controlsRow($, ui, flow, group, settings, layout, text),
    groupSummary(ui, flow, group, refreshedAt, text),
    ...(layout.cycle == null ? [] : [<Text color="warning" wrap="truncate-end">{text.cycle(layout.cycle.map((id) => `k${id}`).join(' → '))}</Text>]),
    <Text> </Text>,
  ]
  // component 마다 시작 줄(top 기준). component 사이에 빈 줄 하나를 둔다.
  const offsets = layout.components.reduce((starts: number[], component, index) => [...starts, (starts[index] ?? top.length) + component.height + 1], [top.length])
  const diagram = layout.components.flatMap((component, index) => [componentBox($, ui, component, cards, selected), ...(index < layout.components.length - 1 ? [<Text> </Text>] : [])])
  const listed = layout.listed.flatMap((members) => [<Text dimColor>{text.listed}</Text>, ...listedRows($, ui, members, cards, selected)])
  const selectedCard = selected == null ? null : cards.get(selected)
  const detail = selectedCard ? await cardDetail($, ui, selectedCard, width, refreshedAt, locale, actions) : null
  const recent = messageRows(ui, flow, text)
  const after = [<Text> </Text>, ...(detail ? detail.elements : recent)]
  const diagramRows = layout.components.reduce((sum, component) => sum + component.height, 0) + Math.max(0, layout.components.length - 1)
  const totalRows = top.length + diagramRows + listed.length + 1 + (detail ? detail.height : recent.length)
  const tooltips = layout.components.flatMap((component, index) => component.nodes.flatMap((node) => {
    const card = cards.get(node.id)
    return card ? [cardTooltip(ui, card, { scope: scopeOf(card.id), top: (offsets[index] ?? 0) + node.y, left: node.x, nodeHeight: node.height, totalRows, columns: width }, refreshedAt, locale, null)] : []
  }))
  return (
    <Box flexDirection="column">
      {top}
      {diagram}
      {listed}
      {after}
      {tooltips}
    </Box>
  )
}
