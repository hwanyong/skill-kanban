// 세션 흐름 view 의 배치: 한 milestone 묶음의 카드를 depends_on 의 층(layer)으로 나눠 좌표를 정하고, 선을 글자 격자로 그린다. 엔진(`$`)을 부르지 않는다. 그리기는 flow.tsx 가 갖는다.
// 층은 묶음 안의 depends_on 을 따라 가장 긴 앞 카드 사슬의 길이다. 묶음 밖 카드에 대한 depends_on 은 층에 넣지 않는다.
// 선으로 이어진 카드끼리를 한 component 로 묶어 차례로 쌓고, 묶음 안에 선이 없는 카드는 마지막 component 에 줄을 바꿔 가며 놓는다.
// 층을 두 칸 이상 건너는 선은 사이 층마다 폭 1 의 dummy 를 두어 노드 위를 지나가지 않게 한다(Sugiyama 방식의 층 배치).
// 층 안 차례는 앞 층 이웃의 평균 위치(barycenter)로 위에서 아래로 한 번, 아래에서 위로 한 번 정렬한다.

export type Direction = 'down' | 'right'
export type NodeSize = 'full' | 'compact'
export type LayoutCard = { id: number; depends_on: number[] }
// x · y 는 component 왼쪽 위에서 센 글자 칸이다.
export type PlacedNode = { id: number; x: number; y: number; width: number; height: number }
// lines: 선 격자의 줄. 줄마다 width 글자이고 선이 없는 칸은 공백이다.
export type Component = { nodes: PlacedNode[]; lines: string[]; width: number; height: number }
// listed: 1줄 노드로도 폭에 들어가지 않아 목록으로 그릴 component 의 카드 id. cycle: 처음 찾은 순환(첫 id 를 끝에 다시 적는다). 없으면 null.
export type FlowLayout = { size: NodeSize; components: Component[]; listed: number[][]; cycle: number[] | null }

// 3줄 노드: 둥근 테두리 안에 한 줄(상태 기호 · id · 제목). 1줄 노드: 상태 기호 · id.
const FULL_WIDTH = 24
const FULL_HEIGHT = 3
// 층 사이: 세로는 나가는 줄 · 꺾는 줄(track 수) · 들어가는 줄, 가로는 그 셋과 RIGHT_LAYER_GAP 칸 중 큰 쪽. 같은 층 안 노드 사이: 세로 배치는 2칸, 가로 배치는 1줄.
const RIGHT_LAYER_GAP = 6
const CROSS_GAP: Record<Direction, number> = { down: 2, right: 1 }

// 선 칸의 방향 비트. back · fwd 는 층 방향(작은 층 · 큰 층), lo · hi 는 층 안 방향이다.
const BACK = 1
const FWD = 2
const LO = 4
const HI = 8
const ARROW = 16
// 위 1 · 아래 2 · 왼쪽 4 · 오른쪽 8 의 합 → 상자 그리기 문자.
const BOX: Record<number, string> = { 1: '│', 2: '│', 3: '│', 4: '─', 8: '─', 12: '─', 10: '┌', 6: '┐', 9: '└', 5: '┘', 11: '├', 7: '┤', 14: '┬', 13: '┴', 15: '┼' }

type Item = { id: number | null; key: string; layer: number }

const nodeSize = (size: NodeSize, cards: LayoutCard[]) => (size == 'full'
  ? { width: FULL_WIDTH, height: FULL_HEIGHT }
  : { width: 2 + Math.max(...cards.map((card) => String(card.id).length)), height: 1 })

// 묶음 안 앞 카드. 자기 자신과 묶음 밖 id 는 뺀다.
const inGroupDeps = (card: LayoutCard, ids: Set<number>) => card.depends_on.filter((id) => id != card.id && ids.has(id))

// DFS 로 순환을 만드는 선(back edge)을 찾는다. 반환: 층 계산에서 뺄 선("앞 id>뒤 id")과 처음 찾은 순환.
const findCycles = (cards: LayoutCard[], deps: Map<number, number[]>) => {
  const state = new Map<number, 'open' | 'closed'>()
  const stack: number[] = []
  const broken = new Set<string>()
  let cycle: number[] | null = null
  const visit = (id: number) => {
    state.set(id, 'open')
    stack.push(id)
    for (const dep of deps.get(id) ?? []) {
      if (state.get(dep) == 'open') {
        broken.add(`${dep}>${id}`)
        cycle ??= [...stack.slice(stack.indexOf(dep)), dep]
        continue
      }
      if (!state.has(dep)) visit(dep)
    }
    stack.pop()
    state.set(id, 'closed')
  }
  cards.forEach((card) => state.has(card.id) || visit(card.id))
  return { broken, cycle }
}

// 선으로 이어진 카드끼리 묶는다. 차례는 cards 의 차례(보드 차례)다.
const componentsOf = (cards: LayoutCard[], edges: [number, number][]) => {
  const linked = new Map<number, number[]>(cards.map((card) => [card.id, []]))
  edges.forEach(([from, to]) => {
    linked.get(from)?.push(to)
    linked.get(to)?.push(from)
  })
  const seen = new Set<number>()
  return cards.flatMap((card) => {
    if (seen.has(card.id)) return []
    const members: number[] = []
    const queue = [card.id]
    seen.add(card.id)
    while (queue.length > 0) {
      const id = queue.shift() as number
      members.push(id)
      for (const next of linked.get(id) ?? []) {
        if (seen.has(next)) continue
        seen.add(next)
        queue.push(next)
      }
    }
    return [members]
  })
}

// 선이 없는 카드를 폭 columns 안에서 줄을 바꿔 가며 놓는다.
const looseComponent = (ids: number[], width: number, height: number, columns: number): Component => {
  const perRow = Math.max(1, Math.floor((columns + 1) / (width + 1)))
  const nodes = ids.map((id, index) => ({ id, x: (index % perRow) * (width + 1), y: Math.floor(index / perRow) * (height + 1), width, height }))
  const rows = Math.ceil(ids.length / perRow)
  const totalWidth = Math.min(ids.length, perRow) * (width + 1) - 1
  const totalHeight = rows * (height + 1) - 1
  return { nodes, lines: Array.from({ length: totalHeight }, () => ' '.repeat(totalWidth)), width: totalWidth, height: totalHeight }
}

// 선으로 이어진 카드 component 하나의 층 배치. 폭에 들어가지 않으면 null.
const layeredComponent = (ids: number[], edges: [number, number][], order: Map<number, number>, direction: Direction, width: number, height: number, columns: number): Component | null => {
  const members = new Set(ids)
  const own = edges.filter(([from, to]) => members.has(from) && members.has(to))
  const deps = new Map<number, number[]>(ids.map((id) => [id, own.filter(([, to]) => to == id).map(([from]) => from)]))
  const layerOf = new Map<number, number>()
  const layerFor = (id: number): number => {
    const known = layerOf.get(id)
    if (known != null) return known
    const layer = Math.max(-1, ...(deps.get(id) ?? []).map(layerFor)) + 1
    layerOf.set(id, layer)
    return layer
  }
  ids.forEach(layerFor)
  const layerCount = Math.max(...layerOf.values()) + 1
  const layers: Item[][] = Array.from({ length: layerCount }, () => [])
  ids.toSorted((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)).forEach((id) => layers[layerOf.get(id) as number]?.push({ id, key: `k${id}`, layer: layerOf.get(id) as number }))
  // 층을 이웃 층끼리만 잇는 선 조각(from · to 는 Item key). 두 층 이상 건너는 선은 dummy 를 거친다.
  const segments: [string, string][] = []
  own.forEach(([from, to]) => {
    const start = layerOf.get(from) as number
    const end = layerOf.get(to) as number
    let previous = `k${from}`
    for (let layer = start + 1; layer < end; layer += 1) {
      const key = `d${from}>${to}@${layer}`
      layers[layer]?.push({ id: null, key, layer })
      segments.push([previous, key])
      previous = key
    }
    segments.push([previous, `k${to}`])
  })
  const position = new Map<string, number>()
  const index = () => layers.forEach((items) => items.forEach((item, at) => position.set(item.key, at)))
  index()
  const reorder = (layer: number, neighbours: (key: string) => string[]) => {
    const items = layers[layer] ?? []
    const center = (item: Item) => {
      const near = neighbours(item.key).map((key) => position.get(key)).filter((at): at is number => at != null)
      return near.length == 0 ? (position.get(item.key) ?? 0) : near.reduce((sum, at) => sum + at, 0) / near.length
    }
    layers[layer] = items.map((item) => ({ item, center: center(item) })).toSorted((a, b) => a.center - b.center).map(({ item }) => item)
    index()
  }
  const before = (key: string) => segments.filter(([, to]) => to == key).map(([from]) => from)
  const after = (key: string) => segments.filter(([from]) => from == key).map(([, to]) => to)
  for (let layer = 1; layer < layerCount; layer += 1) reorder(layer, before)
  for (let layer = layerCount - 2; layer >= 0; layer -= 1) reorder(layer, after)
  const isDown = direction == 'down'
  const layerExtent = isDown ? height : width
  const crossExtent = isDown ? width : height
  const crossGap = CROSS_GAP[direction]
  // 층 안 시작 위치와 가운데. dummy 는 폭 1 이다.
  const crossStart = new Map<string, number>()
  const crossCenter = new Map<string, number>()
  const crossSizes = layers.map((items) => items.reduce((at, item) => {
    const extent = item.id == null ? 1 : crossExtent
    crossStart.set(item.key, at)
    crossCenter.set(item.key, at + Math.floor(extent / 2))
    return at + extent + crossGap
  }, 0) - crossGap)
  const crossSize = Math.max(...crossSizes)
  const layerKey = new Map(layers.flatMap((items, layer) => items.map((item) => [item.key, layer] as const)))
  // 층 사이마다 꺾는 줄(track)을 나눈다. 한 출발 노드의 선은 한 줄을 함께 쓰고, 가로 구간이 겹치는 출발 노드끼리는 다른 줄을 쓴다.
  const trackOf = new Map<string, number>()
  const trackCounts = layers.map((_, layer) => {
    const sources = [...new Set(segments.filter(([from]) => layerKey.get(from) == layer).map(([from]) => from))]
    const spans = sources.map((from) => {
      const points = [from, ...segments.filter(([start]) => start == from).map(([, to]) => to)].map((key) => crossCenter.get(key) as number)
      return { from, lo: Math.min(...points), hi: Math.max(...points) }
    }).filter(({ lo, hi }) => lo != hi).toSorted((a, b) => a.lo - b.lo)
    const ends: number[] = []
    spans.forEach(({ from, lo, hi }) => {
      const free = ends.findIndex((end) => end < lo - 1)
      const track = free == -1 ? ends.length : free
      ends[track] = hi
      trackOf.set(from, track)
    })
    return ends.length
  })
  // 층 사이 줄: 나가는 줄 1 · 꺾는 줄 track 수(없으면 0) · 들어가는 줄 1. 가로 배치는 RIGHT_LAYER_GAP 칸이 모자라면 track 수만큼 넓힌다.
  const gapAfter = (layer: number) => (isDown ? 2 + (trackCounts[layer] ?? 0) : Math.max(RIGHT_LAYER_GAP, 2 + (trackCounts[layer] ?? 0)))
  const starts = layers.map((_, layer) => layers.slice(0, layer).reduce((at, __, before) => at + layerExtent + gapAfter(before), 0))
  const layerStart = (layer: number) => starts[layer] ?? 0
  const layerSize = layerStart(layerCount - 1) + layerExtent
  if ((isDown ? crossSize : layerSize) > columns) return null
  const bits = Array.from({ length: layerSize }, () => Array.from({ length: crossSize }, () => 0))
  const mark = (along: number, cross: number, bit: number) => {
    const row = bits[along]
    if (row && cross >= 0 && cross < crossSize) row[cross] = (row[cross] ?? 0) | bit
  }
  layers.forEach((items, layer) => items.filter((item) => item.id == null).forEach((item) => {
    for (let along = layerStart(layer); along < layerStart(layer) + layerExtent; along += 1) mark(along, crossCenter.get(item.key) as number, BACK | FWD)
  }))
  segments.forEach(([fromKey, toKey]) => {
    const from = crossCenter.get(fromKey) as number
    const to = crossCenter.get(toKey) as number
    const layer = layerKey.get(fromKey) as number
    const out = layerStart(layer) + layerExtent
    const enter = layerStart(layer + 1) - 1
    const turn = from == to ? enter : out + 1 + (trackOf.get(fromKey) ?? 0)
    for (let along = out; along < turn; along += 1) mark(along, from, BACK | FWD)
    if (from != to) {
      mark(turn, from, BACK | (to > from ? HI : LO))
      for (let cross = Math.min(from, to) + 1; cross < Math.max(from, to); cross += 1) mark(turn, cross, LO | HI)
      mark(turn, to, FWD | (to > from ? LO : HI))
    }
    for (let along = from == to ? turn : turn + 1; along < enter; along += 1) mark(along, to, BACK | FWD)
    mark(enter, to, BACK | FWD | (toKey.startsWith('k') ? ARROW : 0))
  })
  // 층 방향 · 층 안 방향을 화면의 위 · 아래 · 왼쪽 · 오른쪽으로 바꾼다.
  const screenBits = (value: number) => isDown
    ? (value & BACK ? 1 : 0) | (value & FWD ? 2 : 0) | (value & LO ? 4 : 0) | (value & HI ? 8 : 0)
    : (value & LO ? 1 : 0) | (value & HI ? 2 : 0) | (value & BACK ? 4 : 0) | (value & FWD ? 8 : 0)
  const glyph = (value: number) => (value & ARROW ? (isDown ? '▼' : '▶') : BOX[screenBits(value)] ?? ' ')
  const lines = isDown
    ? bits.map((row) => row.map(glyph).join(''))
    : Array.from({ length: crossSize }, (_, cross) => bits.map((row) => glyph(row[cross] ?? 0)).join(''))
  const nodes = layers.flatMap((items, layer) => items.filter((item) => item.id != null).map((item) => {
    const along = layerStart(layer)
    const cross = crossStart.get(item.key) as number
    return { id: item.id as number, x: isDown ? cross : along, y: isDown ? along : cross, width, height }
  }))
  return { nodes, lines, width: isDown ? crossSize : layerSize, height: isDown ? layerSize : crossSize }
}

// cards: 한 묶음의 카드(보드 차례). columns: 그릴 폭.
// size 가 full 인데 선이 있는 component 하나라도 폭에 들어가지 않으면 전체를 compact 로 다시 계산한다. compact 로도 들어가지 않는 component 는 listed 로 낸다.
export const layoutFlow = (cards: LayoutCard[], direction: Direction, size: NodeSize, columns: number): FlowLayout => {
  const ids = new Set(cards.map((card) => card.id))
  const deps = new Map(cards.map((card) => [card.id, inGroupDeps(card, ids)]))
  const { broken, cycle } = findCycles(cards, deps)
  const edges = cards.flatMap((card) => (deps.get(card.id) ?? []).filter((dep) => !broken.has(`${dep}>${card.id}`)).map((dep): [number, number] => [dep, card.id]))
  const order = new Map(cards.map((card, at) => [card.id, at]))
  const groups = componentsOf(cards, edges)
  const attempt = (tried: NodeSize) => {
    const { width, height } = nodeSize(tried, cards)
    const linked = groups.filter((members) => members.length > 1)
    const loose = groups.filter((members) => members.length == 1).flat()
    const placed = linked.map((members) => ({ members, component: layeredComponent(members, edges, order, direction, width, height, columns) }))
    const components = placed.flatMap(({ component }) => (component ? [component] : []))
    const listed = placed.flatMap(({ members, component }) => (component ? [] : [members]))
    return { size: tried, components: loose.length == 0 ? components : [...components, looseComponent(loose, width, height, columns)], listed, cycle }
  }
  const first = attempt(size)
  return first.listed.length > 0 && size == 'full' ? attempt('compact') : first
}
