import type { EngineInterface, RenderElement, RenderNode } from 'claude-code'

// pane-grid reading module. Copy this file to <your mod>/hooks/pane-grid.ts without editing the exports you keep.
// The guide's Step 1 lists the exports you may delete.
// Source: https://github.com/hwanyong/pane-grid/blob/main/skills/add-pane-grid-cell/pane-grid.ts
// Guide: https://github.com/hwanyong/pane-grid/blob/main/docs/add-pane-grid-cell.md
//
// pane-grid's state types live in the pane-grid repository only, so this module checks the values it reads at run time.
// When pane-grid is not installed every read is undefined and your mod keeps drawing in its own pane or band.
//
// A member id names one pane your mod puts in a cell: `<plugin>` for a mod with one pane, or `<plugin>.<view>` for each
// pane of a mod with two or more (`uhd-kanban` and `uhd-kanban.flow`). `<plugin>` is the name in .claude-plugin/plugin.json;
// `<view>` is yours to pick from a-z, 0-9, `_`, `-`. pane-grid places each member id in a cell of its own. The functions
// below take the member id where earlier copies took the plugin name, so a mod with one pane passes the same string.
//
// Load order does not matter. When your mod loads after pane-grid, next(e) holds nothing of pane-grid's: your mod
// appends an empty `offer:<member id>` Box for each member id (offerKey), so empty cells list it, and its
// `cell:<member id>` Box, where pane-grid collects both. When your mod loads before pane-grid, next(e) holds pane-grid's
// drawing: fillSlot puts your cell into the `slot:<member id>` Box pane-grid drew for it, and offerChoice adds your Button
// to each empty cell's `choices:<cell>` Box. pane-grid's ui.press hook answers that Button by its key.

const GRID_LAYOUT = { plugin: 'pane-grid', key: 'layout' } as const
const GRID_SHOWN = { plugin: 'pane-grid', key: 'shown' } as const
// The layout format's version, as pane-grid's types/index.d.ts GridVersion names it. pane-grid writes it into the layout
// value from this constant, so the two cannot drift. Your mod need not import it; placementIn uses it.
export const GRID_VERSION = 1
// The render keys pane-grid draws and fillSlot and offerChoice read: `slot:<member id>`, `choices:<cell>[:active]`,
// `none:<cell>` and the choice Button `place:<cell>:<member id>`. pane-grid draws them from these constants, so the two
// sides cannot drift. Your mod need not import them; fillSlot and offerChoice use them.
export const SLOT_KEY = 'slot:'
export const CHOICES_KEY = 'choices:'
export const ACTIVE_SUFFIX = ':active'
export const NONE_KEY = 'none:'
export const PLACE_KEY = 'place:'
const HOVERS_KEY = 'hovers:'
// The key prefix of the Box pane-grid draws over the content rows of a cell that is not the active one, in a cell where a
// member id is placed: `cover:<member id>`. fillSlot removes it when your cell holds the hoversKey Box. Your mod need not import it.
export const COVER_KEY = 'cover:'
// The key prefix of the empty Box a mod loaded after pane-grid draws for each member id. pane-grid reads it with this
// constant. Your mod need not import it; offerKey uses it.
export const OFFER_KEY = 'offer:'
// Empty-cell choices take hotkeys 1-9 in the active cell only; numbered in every cell, one number would mean two cells.
export const CHOICE_HOTKEYS = 9

// tab: the layout holding the cell. requestId: that layout's grid pane id (`grid-<tab>`).
// columns and rows: the size to draw in. Both are 0 until pane-grid has measured the pane.
// column and row: the top left of that area in the grid pane's body, as `UiScrollPointer` counts. isActive: the cell
// is the active or the zoomed one. pane-grid writes these three from 0.4.0; they are undefined before.
type GridPlacement = { tab: string; requestId: string; cell: string; columns: number; rows: number; column?: number; row?: number; isActive?: boolean }

const isPlacement = (value: unknown): value is GridPlacement => {
  if (typeof value != 'object' || value == null) return false
  const placement = value as Record<string, unknown>
  return typeof placement.tab == 'string' && typeof placement.requestId == 'string'
    && typeof placement.columns == 'number' && typeof placement.rows == 'number'
}

// Finds the cell of one member id in a pane-grid layout value. Also used on a `state.set` hook's `value` and `previous`.
export const placementIn = (layout: unknown, memberId: string): GridPlacement | undefined => {
  if (typeof layout != 'object' || layout == null) return undefined
  const { version, placed } = layout as { version?: unknown; placed?: unknown }
  if (version != GRID_VERSION || typeof placed != 'object' || placed == null) return undefined
  const placement = (placed as Record<string, unknown>)[memberId]
  return isPlacement(placement) ? placement : undefined
}

// The two functions below are function declarations, not arrow functions:
// `claude plugin validate` follows `$` across an import only through function declarations.
// Engine floor: a hooks module that passes `$` to either of them loads in Claude Code 2.1.299 or later. Claude Code
// 2.1.296 and older refuse it ("$ is followed only into a function declared in this same file, never across an import").
// A mod that supports an older engine, or whose repository lets `$` be passed only to functions in the hooks file,
// deletes both, reads pane-grid's state in its own hooks file and imports only placementIn: see "Engine floor" in the
// guide's Step 1.

// The cell of one member id. Called while drawing, the drawing is redrawn when pane-grid changes the layout.
export async function readPlacement($: EngineInterface, memberId: string): Promise<GridPlacement | undefined> {
  const read = await $.state.get(GRID_LAYOUT as never) as { value?: unknown }
  return placementIn(read.value, memberId)
}

// The name of the grid layout on screen; null when no grid pane is shown or pane-grid is not installed.
// Only a mod that runs timers (an animation, polling) needs it. Delete it otherwise.
export async function readShownTab($: EngineInterface): Promise<string | null> {
  const read = await $.state.get(GRID_SHOWN as never) as { value?: unknown }
  return typeof read.value == 'string' ? read.value : null
}

// What offerChoice hands your Button maker: draw `<Button key={choice.key} plain label={choice.label} hotkey={choice.hotkey} onPress={() => {}} />`.
// The press is pane-grid's to answer (its ui.press hook reads the key), so onPress does nothing.
type GridChoice = { key: string; label: string; hotkey?: string }

const keyOf = (node: RenderNode) => {
  if (typeof node == 'string') return undefined
  const props: Record<string, unknown> | undefined = 'props' in node ? node.props : undefined
  const key = props?.key
  return typeof key == 'string' ? key : undefined
}

const childrenOf = (node: RenderElement): readonly RenderNode[] => ('children' in node && Array.isArray(node.children) ? node.children : [])

// Whether `node` or a Box under it has the key `key`. pane-grid reads its members' cells with it too.
export const holdsKey = (node: RenderNode, key: string): boolean =>
  keyOf(node) == key || (typeof node != 'string' && childrenOf(node).some(child => holdsKey(child, key)))

// Copies the tree only along the path to each node `change` replaces; the drawing next(e) handed you is frozen.
const rewrite = (element: RenderElement, change: (element: RenderElement) => RenderElement | undefined): RenderElement => {
  const changed = change(element)
  if (changed) return changed
  const children = childrenOf(element)
  const rewritten = children.map(child => (typeof child == 'string' ? child : rewrite(child, change)))
  return rewritten.every((child, index) => child === children[index]) ? element : ({ ...element, children: rewritten } as RenderElement)
}

// Puts `cell` into the slot pane-grid drew for this member id. undefined when next(e) holds no such slot (your mod loads
// after pane-grid, so pane-grid has not drawn yet): append the cell after next(e) instead, keyed `cell:<member id>`.
// When `cell` holds the hoversKey Box, it also removes the `cover:<member id>` Box: pane-grid drew the cover before your
// cell was in the tree, so it could not see the Box. When your mod loads after pane-grid, pane-grid sees it and leaves the cover out.
export const fillSlot = (below: RenderElement, memberId: string, cell: RenderElement): RenderElement | undefined => {
  let isFilled = false
  const filled = rewrite(below, element => {
    if (keyOf(element) != `${SLOT_KEY}${memberId}`) return undefined
    isFilled = true
    return { ...element, children: [cell] } as RenderElement
  })
  if (!isFilled) return undefined
  if (!holdsKey(cell, hoversKey(memberId))) return filled
  const cover = `${COVER_KEY}${memberId}`
  return rewrite(filled, element => {
    const children = childrenOf(element)
    if (!children.some(child => keyOf(child) == cover)) return undefined
    return { ...element, children: children.filter(child => keyOf(child) != cover) } as RenderElement
  })
}

// Adds this member id's Button to every empty cell's choices pane-grid drew. Unchanged when next(e) holds none (your mod
// loads after pane-grid): draw the `offerKey(memberId)` Box instead. `placement` is this member id's current cell, if any:
// the label then says the press moves it from there.
export const offerChoice = (below: RenderElement, memberId: string, placement: GridPlacement | undefined, makeButton: (choice: GridChoice) => RenderElement): RenderElement =>
  rewrite(below, element => {
    const key = keyOf(element)
    if (!key?.startsWith(CHOICES_KEY)) return undefined
    // A cell id holds no `:`, so the id ends at the first `:`; a cell named `active` is then not read as the suffix.
    const [cell = ''] = key.slice(CHOICES_KEY.length).split(':')
    const isActive = key.slice(CHOICES_KEY.length + cell.length) == ACTIVE_SUFFIX
    const choiceKey = `${PLACE_KEY}${cell}:${memberId}`
    const children = childrenOf(element).filter(child => !keyOf(child)?.startsWith(NONE_KEY))
    if (children.some(child => keyOf(child) == choiceKey)) return undefined
    const count = children.filter(child => keyOf(child)?.startsWith(PLACE_KEY)).length
    const hotkey = isActive && count < CHOICE_HOTKEYS ? String(count + 1) : undefined
    const label = placement ? `${memberId} (move from ${placement.cell})` : memberId
    return { ...element, children: [...children, makeButton({ key: choiceKey, label, hotkey })] } as RenderElement
  })

// The key of the empty Box a mod loaded after pane-grid appends after next(e) for each member id, placed or not, so
// empty cells list it. Draw it next to the `cell:<member id>` Box, not inside it. A mod loaded before pane-grid does
// not need it (offerChoice adds the Button there), and drawing it there does nothing.
export const offerKey = (memberId: string) => `${OFFER_KEY}${memberId}`

// A mod whose cell shows Box hover tooltips draws an empty Box with this key inside its `cell:<member id>` Box.
// While the cell is not the active one pane-grid covers its title row only, not the whole cell (in either load order: see
// fillSlot), so the pointer reaches your Boxes and their tooltips show. The cost: a click on your rows no longer makes the
// cell the active one; a click on the title row or a hotkey (`o`) does. Without the Box pane-grid covers the whole cell.
export const hoversKey = (memberId: string) => `${HOVERS_KEY}${memberId}`
