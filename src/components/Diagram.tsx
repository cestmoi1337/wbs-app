import cytoscape from 'cytoscape'
import type { Core, CollectionReturnValue, NodeSingular } from 'cytoscape'
import dagre from 'cytoscape-dagre'
import svg from 'cytoscape-svg'
import { useEffect, useRef } from 'react'
import type { WbsNode } from '../lib/parseOutline'

cytoscape.use(dagre as any)
cytoscape.use(svg as any)

type Pos = { x: number; y: number }
export type LayoutMode = 'horizontal' | 'vertical' | 'mindmap'

export type DiagramApi = {
  downloadPNG: (opts?: { scale?: number; bg?: string; margin?: number }) => void
  downloadSVG: (opts?: { bg?: string; margin?: number }) => void
  print: (opts?: { bg?: string; margin?: number }) => void
  exportJSON: () => string
  importJSON: (json: string) => void
  fitToScreen: () => void
  autoFitAll?: () => void
  undo?: () => void
  redo?: () => void
}

type Props = {
  root: WbsNode
  title?: string
  onRename?: (id: string, newLabel: string) => void
  onReady?: (api: DiagramApi) => void
  onPositionsChange?: (positions: Record<string, Pos>) => void
  initialPositions?: Record<string, Pos>
  fontSize?: number
  boxWidth?: number
  boxHeight?: number
  textMaxWidth?: number
  layoutMode?: LayoutMode
  showGrid?: boolean
  gridSize?: number
  snapToGrid?: boolean
}

/* ---------- helpers ---------- */

function getVisualRoot(node: WbsNode): WbsNode {
  const label = (node.label ?? '').trim().toLowerCase()
  if (label === 'root' && (node.children?.length ?? 0) === 1) return node.children![0]
  return node
}

function toElements(originalRoot: WbsNode) {
  const root = getVisualRoot(originalRoot)
  const nodes: any[] = []
  const edges: any[] = []

  // visual root
  {
    const lbl = root.label ?? ''
    nodes.push({
      data: { id: root.id, label: lbl, level: root.level ?? 0, len: lbl.length, lines: Math.max(1, Math.ceil(lbl.length / 18)) },
      classes: 'visual-root'
    })
  }

  const pushChild = (n: WbsNode) => {
    const lbl = n.label ?? ''
    nodes.push({
      data: { id: n.id, label: lbl, level: n.level ?? 0, len: lbl.length, lines: Math.max(1, Math.ceil(lbl.length / 18)) }
    })
  }

  const visit = (n: WbsNode) => {
    for (const c of n.children || []) {
      pushChild(c)
      const lvl = c.level ?? 0
      const cpd = 60 + lvl * 30
      edges.push({ data: { id: `${n.id}-${c.id}`, source: n.id, target: c.id, level: lvl, cpd } })
      visit(c)
    }
  }
  visit(root)

  return { elements: [...nodes, ...edges] }
}

function centerParentOverChildren(n: NodeSingular) {
  const kids = n.outgoers('node')
  if (kids.empty()) return
  const bb = kids.boundingBox()
  const y = n.position('y')
  const cx = bb.x1 + bb.w / 2
  n.position({ x: cx, y })
}
function postCenterParentsVertical(cy: Core) {
  const roots = cy.nodes().roots()
  roots.forEach(centerParentOverChildren)
  const l1 = roots.outgoers('node')
  l1.forEach(centerParentOverChildren)
}

function measureTextWidth(text: string, fontPx: number, fontFamily = 'Inter, system-ui, Arial, sans-serif') {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return text.length * fontPx * 0.6
  ctx.font = `${Math.max(10, Math.round(fontPx))}px ${fontFamily}`
  return ctx.measureText(text).width
}

function autoFitNodeWidth(node: NodeSingular, maxWidth = 720, minWidth = 140, paddingPx = 14) {
  const label = String(node.data('label') ?? '')
  if (!label) return
  const raw = node.style('font-size') as unknown as string | number
  const fs = typeof raw === 'number' ? raw : (parseFloat(String(raw).replace('px', '')) || 14)
  const w = measureTextWidth(label, fs)
  const desired = Math.min(maxWidth, Math.max(minWidth, Math.ceil(w + paddingPx * 2)))
  node.style({ width: desired, 'text-max-width': Math.max(40, desired - paddingPx * 2) } as any)
}

/* chevrons */
const ICON_SIZE = 18
const CHEVRON_PADDING = 4
const PLUS_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24" fill="#0f172a"><rect x="1" y="1" width="22" height="22" rx="6" ry="6" fill="#ffffff" stroke="#94a3b8"/><path d="M12 6v12M6 12h12" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/></svg>`
)
const MINUS_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24" fill="#0f172a"><rect x="1" y="1" width="22" height="22" rx="6" ry="6" fill="#ffffff" stroke="#94a3b8"/><path d="M6 12h12" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/></svg>`
)
const PLUS_URI = `url("data:image/svg+xml,${PLUS_SVG}")`
const MINUS_URI = `url("data:image/svg+xml,${MINUS_SVG}")`
function setChevronIcon(node: NodeSingular, collapsed: boolean) {
  node.style({
    'background-image': collapsed ? PLUS_URI : MINUS_URI,
    'background-width': ICON_SIZE,
    'background-height': ICON_SIZE,
    'background-repeat': 'no-repeat',
    'background-fit': 'none',
    'background-position-x': '100%',
    'background-position-y': '0%'
  } as any)
}

/* snapshot */
type Snapshot = {
  positions: Record<string, Pos>
  labels: Record<string, string>
  styles: Record<string, { width?: number; textMaxWidth?: number }>
  collapsed: string[]
}
const toNumOrUndef = (v: unknown) => {
  const n = parseFloat(String(v)); return Number.isFinite(n) ? n : undefined
}
function snapshot(cy: Core): Snapshot {
  const positions: Record<string, Pos> = {}
  const labels: Record<string, string> = {}
  const styles: Record<string, { width?: number; textMaxWidth?: number }> = {}
  cy.nodes().forEach(n => {
    const p = n.position()
    positions[n.id()] = { x: p.x, y: p.y }
    labels[n.id()] = String(n.data('label') ?? '')
    const w = toNumOrUndef(n.style('width') as any)
    const tw = toNumOrUndef(n.style('text-max-width') as any)
    if (w !== undefined || tw !== undefined) styles[n.id()] = { width: w, textMaxWidth: tw }
  })
  const collapsed: string[] = []
  cy.nodes('.collapsed-parent').forEach(n => { collapsed.push(n.id()) })
  return { positions, labels, styles, collapsed }
}
function applySnapshot(cy: Core, s: Snapshot) {
  cy.startBatch()
  for (const [id, pos] of Object.entries(s.positions)) {
    const n = cy.getElementById(id); if (n.nonempty()) n.position(pos)
  }
  for (const [id, lbl] of Object.entries(s.labels)) {
    const n = cy.getElementById(id); if (n.nonempty()) n.data('label', lbl)
  }
  cy.nodes().forEach(n => {
    const st = s.styles[n.id()]
    if (st) {
      if (st.width !== undefined) n.style('width', st.width as any); else n.removeStyle('width')
      if (st.textMaxWidth !== undefined) n.style('text-max-width', st.textMaxWidth as any); else n.removeStyle('text-max-width')
    } else {
      n.removeStyle('width'); n.removeStyle('text-max-width')
    }
  })
  cy.nodes().removeClass('collapsed-parent')
  cy.nodes().style('display', 'element')
  if (s.collapsed?.length) {
    s.collapsed.forEach(id => {
      const n = cy.getElementById(id)
      if (n.nonempty()) { n.addClass('collapsed-parent'); setCollapsedInternal(cy, id, true) }
    })
  }
  cy.endBatch()
}

/* collapse helpers used by snapshot restore */
function setCollapsedInternal(cy: Core, parentId: string, collapse: boolean) {
  const node = cy.getElementById(parentId); if (node.empty()) return
  const desc = node.successors('node')
  const edges = node.successors('edge')
  if (collapse) {
    desc.style('display', 'none'); edges.style('display', 'none'); setChevronIcon(node, true)
  } else {
    desc.style('display', 'element'); edges.style('display', 'element'); setChevronIcon(node, false)
  }
}

/* JSON export/import */
function exportJSONFrom(cy: Core, meta: any) {
  const s = snapshot(cy)
  const nodes = cy.nodes().map(n => ({
    id: n.id(),
    label: String(n.data('label') ?? ''),
    level: Number(n.data('level') ?? 0),
    pos: s.positions[n.id()],
    width: parseFloat(String(n.style('width') as any)) || undefined,
    wrap: parseFloat(String(n.style('text-max-width') as any)) || undefined,
    collapsed: n.hasClass('collapsed-parent') || undefined
  }))
  const edges = cy.edges().map(e => ({ source: e.source().id(), target: e.target().id() }))
  return JSON.stringify({ meta, nodes, edges }, null, 2)
}
function importJSONInto(cy: Core, json: string) {
  const data = JSON.parse(json)
  if (Array.isArray(data.nodes)) {
    data.nodes.forEach((n: any) => {
      const ele = cy.getElementById(n.id)
      if (ele.nonempty()) {
        if (n.label != null) ele.data('label', n.label)
        if (n.pos) ele.position(n.pos)
        if (n.width != null) ele.style('width', n.width as any)
        if (n.wrap != null) ele.style('text-max-width', n.wrap as any)
        if (n.collapsed) ele.addClass('collapsed-parent')
      }
    })
  }
  cy.nodes('.collapsed-parent').forEach(n => setCollapsedInternal(cy, n.id(), true))
}

/* ---------- component ---------- */

export default function Diagram({
  root,
  title,
  onRename,
  onReady,
  onPositionsChange,
  initialPositions,
  fontSize = 12,
  boxWidth = 240,
  boxHeight = 72,
  textMaxWidth = 220,
  layoutMode = 'horizontal',
  showGrid = true,
  gridSize = 10,
  snapToGrid = true
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const lastTapRef = useRef<{ id: string; at: number; alt: boolean; shift: boolean; meta: boolean; ctrl: boolean } | null>(null)
  const dragState = useRef<{ anchorId: string; initialAnchor: Pos; group: Map<string, Pos>; prevSnap?: Snapshot } | null>(null)
  const undoRef = useRef<Snapshot[]>([])
  const redoRef = useRef<Snapshot[]>([])
  const historyLimit = 50

  const pushUndo = (before: Snapshot) => { undoRef.current.push(before); if (undoRef.current.length > historyLimit) undoRef.current.shift(); redoRef.current = [] }
  const doUndo = () => { const cy = cyRef.current; if (!cy || undoRef.current.length === 0) return
    const current = snapshot(cy); const prev = undoRef.current.pop()!; redoRef.current.push(current); applySnapshot(cy, prev); onPositionsChange?.(snapshot(cy).positions) }
  const doRedo = () => { const cy = cyRef.current; if (!cy || redoRef.current.length === 0) return
    const current = snapshot(cy); const next = redoRef.current.pop()!; undoRef.current.push(current); applySnapshot(cy, next); onPositionsChange?.(snapshot(cy).positions) }

  const hardCenter = (cy: Core, padding = 60) => {
    try {
      const bb = cy.elements().boundingBox()
      const w = cy.width(), h = cy.height()
      if (!w || !h || !isFinite(bb.w) || !isFinite(bb.h) || bb.w === 0 || bb.h === 0) return
      const z = Math.max(0.02, Math.min(w / (bb.w + padding * 2), h / (bb.h + padding * 2)))
      const cx = bb.x1 + bb.w / 2, cyy = bb.y1 + bb.h / 2
      cy.zoom(z); cy.pan({ x: w / 2 - cx * z, y: h / 2 - cyy * z })
    } catch {}
  }

  const makeLayout = (cy: Core) => {
    if (layoutMode === 'vertical') return cy.layout({ name: 'dagre', rankDir: 'TB', nodeSep: 60, rankSep: 120 } as any)
    if (layoutMode === 'mindmap') {
      const rootsSel = cy.nodes().roots().map(n => `#${n.id()}`).join(',') || undefined
      return cy.layout({ name: 'breadthfirst', directed: true, roots: rootsSel, circle: true, spacingFactor: 1.6, avoidOverlap: true, animate: false } as any)
    }
    return cy.layout({ name: 'dagre', rankDir: 'LR', nodeSep: 60, rankSep: 120 } as any)
  }

  const hitChevron = (node: NodeSingular, evt: any): boolean => {
    const bb = node.renderedBoundingBox({ includeOverlays: false })
    const x = evt.renderedPosition.x, y = evt.renderedPosition.y
    const right = bb.x2, top = bb.y1, pad = CHEVRON_PADDING, size = ICON_SIZE
    const rect = { x1: right - pad - size, y1: top + pad, x2: right - pad, y2: top + pad + size }
    return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2
  }

  useEffect(() => {
    if (!ref.current) return
    const { elements } = toElements(root)
    undoRef.current = []; redoRef.current = []

    const cy = cytoscape({
      container: ref.current,
      elements,
      boxSelectionEnabled: true,
      selectionType: 'additive',
      style: [
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            label: 'data(label)',
            'text-wrap': 'wrap',
            'text-max-width': `${textMaxWidth}px`,
            'font-size': fontSize,
            'text-valign': 'center',
            'text-halign': 'center',
            padding: '14px',
            'border-width': 1,
            'border-color': '#cbd5e1',
            'background-color': '#ffffff',
            'background-opacity': 1,
            width: boxWidth,
            height: boxHeight,
            'shadow-blur': 22,
            'shadow-color': 'rgba(15,23,42,0.22)',
            'shadow-opacity': 1,
            'shadow-offset-x': 0,
            'shadow-offset-y': 5,
            'corner-rounding': 12
          } as any
        },
        { selector: 'node:hover', style: { 'border-color': '#2563eb', 'border-width': 2, 'shadow-blur': 26, 'shadow-color': 'rgba(37,99,235,0.28)' } as any },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#2563eb', 'background-opacity': 0.98, 'shadow-blur': 28, 'shadow-color': 'rgba(37,99,235,0.35)' } as any },
        { selector: 'node.collapsed-parent', style: { 'border-style': 'dashed', 'border-color': '#64748b' } as any },
        ...(layoutMode === 'mindmap'
          ? [{ selector: 'node', style: { 'font-size': Math.max(10, fontSize - 1), 'text-max-width': '160px', width: 'mapData(len,1,60,90,220)', height: 'mapData(lines,1,6,40,110)', padding: '8px' } as any }]
          : []),
        { selector: 'node[level = 0]', style: { 'background-color': '#eef2ff', 'border-color': '#c7d2fe' } as any },
        { selector: 'node[level = 1]', style: { 'background-color': '#dbeafe', 'border-color': '#93c5fd' } as any },
        { selector: 'node[level = 2]', style: { 'background-color': '#dcfce7', 'border-color': '#86efac' } as any },
        { selector: 'node[level = 3]', style: { 'background-color': '#fef9c3', 'border-color': '#fde68a' } as any },
        { selector: 'node[level = 4]', style: { 'background-color': '#fee2e2', 'border-color': '#fca5a5' } as any },
        { selector: 'node[level >= 5]', style: { 'background-color': '#f1f5f9', 'border-color': '#cbd5e1' } as any },
        {
          selector: 'edge',
          style: {
            width: 2.5,
            'line-color': '#94a3b8',
            'line-opacity': 1,
            'curve-style': layoutMode === 'mindmap' ? 'unbundled-bezier' : 'taxi',
            ...(layoutMode !== 'mindmap' ? {
              'taxi-direction': layoutMode === 'vertical' ? 'downward' : 'horizontal',
              'taxi-turn': 20,
              'taxi-turn-min-distance': 12,
              'taxi-source-distance': 0,
              'taxi-target-distance': 0,
              'taxi-endpoint': 'node',
              'edge-distances': 'intersection'
            } : {}),
            'line-cap': 'square',
            'line-join': 'miter'
          } as any
        },
        { selector: 'edge:hover', style: { width: 3.5, 'line-color': '#64748b' } as any },
        { selector: 'edge:selected', style: { width: 4, 'line-color': '#2563eb' } as any },
        { selector: 'node.visual-root', style: { 'border-width': 2, 'border-color': '#94a3b8' } as any }
      ],
      layout: { name: 'preset' }
    })

    // grid bg
    const applyGridBg = () => {
      if (!ref.current) return
      if (!showGrid) { ref.current.style.background = '#f7f7f7'; return }
      const g = gridSize
      ref.current.style.background = `
        linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px),
        #f7f7f7
      `
      ref.current.style.backgroundSize = `${g}px ${g}px, ${g}px ${g}px, auto`
    }
    applyGridBg()

    const fitAll = () => {
      try {
        cy.resize()
        const bb = cy.elements().boundingBox()
        if (isFinite(bb.w) && isFinite(bb.h) && bb.w > 0 && bb.h > 0) {
          const w = cy.width(), h = cy.height()
          const z = Math.max(0.02, Math.min(w / (bb.w + 120), h / (bb.h + 120)))
          const cx = bb.x1 + bb.w / 2, cyy = bb.y1 + bb.h / 2
          cy.zoom(z); cy.pan({ x: w / 2 - cx * z, y: h / 2 - cyy * z })
        }
      } catch {}
    }

    const makeLayoutAndRun = () => {
      const layout = makeLayout(cy)
      if (layoutMode === 'mindmap') { try { cy.reset() } catch {} }
      const after = () => {
        if (layoutMode === 'vertical') { try { postCenterParentsVertical(cy) } catch {} }
        if (initialPositions && Object.keys(initialPositions).length) {
          cy.nodes().forEach(n => { const p = initialPositions[n.id()]; if (p) n.position(p) })
        }
        fitAll()
      }
      cy.one('layoutstop', after); layout.run()
      setTimeout(after, 50); setTimeout(after, 200)
    }

    cy.ready(() => {
      makeLayoutAndRun()
      cy.nodes().forEach(n => {
        const hasChildren = n.outgoers('node').nonempty()
        if (hasChildren) { n.addClass('collapsible'); setChevronIcon(n, n.hasClass('collapsed-parent')) }
        else { n.removeStyle('background-image') }
      })
      undoRef.current = [snapshot(cy)]; redoRef.current = []
    })

    // group drag + snap + history + persist
    const startGroupDrag = (evt: any) => {
      const t = evt.target; if (!t || t.group?.() !== 'nodes') return
      const id = t.id(); const sel = cy.$('node:selected')
      let group: CollectionReturnValue
      if (sel.nonempty() && sel.filter(`#${id}`).nonempty()) group = sel
      else group = cy.collection([t]).union(t.successors('node'))
      const map = new Map<string, Pos>()
      group.forEach(n => { const p = n.position(); map.set(n.id(), { x: p.x, y: p.y }) })
      dragState.current = { anchorId: id, initialAnchor: { ...t.position() }, group: map, prevSnap: snapshot(cy) }
    }
    const onDragMove = (evt: any) => {
      const st = dragState.current; if (!st) return
      const t = evt.target; if (!t || t.group?.() !== 'nodes' || t.id() !== st.anchorId) return
      const now = t.position(); const dx = now.x - st.initialAnchor.x; const dy = now.y - st.initialAnchor.y
      cy.startBatch()
      for (const [nid, pos] of st.group.entries()) {
        if (nid === st.anchorId) continue
        cy.getElementById(nid).position({ x: pos.x + dx, y: pos.y + dy })
      }
      cy.endBatch()
    }
    const snapSelectionToGrid = (eles: CollectionReturnValue) => {
      if (!snapToGrid) return
      const z = cy.zoom(), pan = cy.pan(), step = gridSize
      cy.startBatch()
      eles.forEach(ele => {
        const p = ele.position()
        const sx = p.x * z + pan.x, sy = p.y * z + pan.y
        const halfW = ele.renderedWidth() / 2, halfH = ele.renderedHeight() / 2
        const left = sx - halfW, top = sy - halfH
        const left2 = Math.round(left / step) * step, top2 = Math.round(top / step) * step
        const sx2 = left2 + halfW, sy2 = top2 + halfH
        ele.position({ x: (sx2 - pan.x) / z, y: (sy2 - pan.y) / z })
      })
      cy.endBatch()
    }
    const endGroupDrag = () => {
      const st = dragState.current; if (!st) return
      const ids = Array.from(st.group.keys())
      const eles = ids.length ? cy.$(ids.map(i => `#${i}`).join(',')) : cy.collection()
      snapSelectionToGrid(eles)
      if (st.prevSnap) pushUndo(st.prevSnap)
      dragState.current = null
      onPositionsChange?.(snapshot(cy).positions)
    }
    cy.on('grab', 'node', startGroupDrag)
    cy.on('drag', 'node', onDragMove)
    cy.on('dragfree', 'node', endGroupDrag)
    cy.on('free', 'node', endGroupDrag)

    // tap (collapse/rename/auto-fit)
    const onTap = (evt: any) => {
      const target = evt.target; if (!target || target.group?.() !== 'nodes') return
      const id: string = target.id(); const now = Date.now()
      const oe: any = evt.originalEvent
      const alt = !!(oe && oe.altKey), shift = !!(oe && oe.shiftKey), meta = !!(oe && oe.metaKey), ctrl = !!(oe && oe.ctrlKey)

      const isParent = target.outgoers('node').nonempty()
      if (isParent && hitChevron(target, evt)) {
        const before = snapshot(cy)
        const collapsed = target.hasClass('collapsed-parent')
        if (collapsed) { target.removeClass('collapsed-parent'); setCollapsedInternal(cy, id, false) }
        else { target.addClass('collapsed-parent'); setCollapsedInternal(cy, id, true) }
        pushUndo(before); onPositionsChange?.(snapshot(cy).positions); return
      }

      const last = lastTapRef.current
      if (last && last.id === id && now - last.at < 300) {
        lastTapRef.current = null
        if ((meta || ctrl)) {
          const before = snapshot(cy)
          const collapsed = target.hasClass('collapsed-parent')
          if (collapsed) { target.removeClass('collapsed-parent'); setCollapsedInternal(cy, id, false) }
          else { target.addClass('collapsed-parent'); setCollapsedInternal(cy, id, true) }
          pushUndo(before)
        } else if (alt && onRename) {
          const current = String(target.data('label') ?? '')
          const next = window.prompt('Rename task:', current)
          if (next && next.trim() && next !== current) {
            const before = snapshot(cy)
            onRename(id, next.trim()); target.data('label', next.trim()); pushUndo(before)
          }
        } else if (shift) {
          const before = snapshot(cy); target.removeStyle('width'); target.removeStyle('text-max-width'); pushUndo(before)
        } else {
          const before = snapshot(cy); autoFitNodeWidth(target, 720, 140, 14); pushUndo(before)
        }
        // FIXED: removed extra ')'
        onPositionsChange?.(snapshot(cy).positions)
      } else {
        lastTapRef.current = { id, at: now, alt, shift, meta, ctrl }
      }
    }
    cy.on('tap', 'node', onTap)

    // keyboard: nudge, help, undo/redo
    const keyHandler = (e: KeyboardEvent) => {
      const hasFocus = document.activeElement &&
        (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || (document.activeElement as HTMLElement).isContentEditable)
      if (hasFocus) return
      if ((e.ctrlKey || e.metaKey) && (e.key === '?' || e.key === '/')) {
        window.dispatchEvent(new CustomEvent('wbs-open-help')); return
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return }
      const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']; if (!arrows.includes(e.key)) return
      const sel = cy.$('node:selected'); if (sel.empty()) return
      e.preventDefault()
      const base = gridSize || 10, step = e.shiftKey ? base * 10 : base
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
      const before = snapshot(cy)
      cy.startBatch(); sel.forEach(n => { const p = n.position(); n.position({ x: p.x + dx, y: p.y + dy }) }); cy.endBatch()
      const ids = sel.map(n => `#${n.id()}`).join(','); const eles = ids ? cy.$(ids) : cy.collection()
      const z = cy.zoom(), pan = cy.pan(), stepPx = gridSize
      if (snapToGrid) {
        cy.startBatch()
        eles.forEach(ele => {
          const p = ele.position()
          const sx = p.x * z + pan.x, sy = p.y * z + pan.y
          const halfW = ele.renderedWidth() / 2, halfH = ele.renderedHeight() / 2
          const left = sx - halfW, top = sy - halfH
          const left2 = Math.round(left / stepPx) * stepPx, top2 = Math.round(top / stepPx) * stepPx
          const sx2 = left2 + halfW, sy2 = top2 + halfH
          ele.position({ x: (sx2 - pan.x) / z, y: (sy2 - pan.y) / z })
        })
        cy.endBatch()
      }
      pushUndo(before); onPositionsChange?.(snapshot(cy).positions)
    }
    window.addEventListener('keydown', keyHandler)

    // export API
    if (onReady) {
      const getSvgWithMargin = ({ bg, margin = 80 }: { bg?: string; margin?: number }) => {
        const raw = (cy as any).svg({ full: true }) as string
        const parser = new DOMParser()
        const doc = parser.parseFromString(raw, 'image/svg+xml')
        const svgEl = doc.documentElement
        const viewBoxAttr = svgEl.getAttribute('viewBox')
        const widthAttr = svgEl.getAttribute('width')
        const heightAttr = svgEl.getAttribute('height')
        let w = 0, h = 0, vbX = 0, vbY = 0, vbW = 0, vbH = 0
        if (viewBoxAttr) { const parts = viewBoxAttr.split(/\s+/).map(Number); [vbX, vbY, vbW, vbH] = parts as any; w = vbW; h = vbH }
        else if (widthAttr && heightAttr) { w = parseFloat(widthAttr); h = parseFloat(heightAttr); svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`); vbW = w; vbH = h }
        const newW = w + margin * 2, newH = h + margin * 2
        const newViewBox = `${vbX - margin} ${vbY - margin} ${newW} ${newH}`
        svgEl.setAttribute('viewBox', newViewBox)
        svgEl.setAttribute('width', String(newW))
        svgEl.setAttribute('height', String(newH))
        if (bg) {
          const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
          rect.setAttribute('x', String(vbX - margin)); rect.setAttribute('y', String(vbY - margin))
          rect.setAttribute('width', String(newW)); rect.setAttribute('height', String(newH))
          rect.setAttribute('fill', bg); svgEl.insertBefore(rect, svgEl.firstChild)
        }
        if (title && title.trim()) {
          const t = doc.createElementNS('http://www.w3.org/2000/svg', 'text')
          t.textContent = title.trim()
          t.setAttribute('x', String(vbX - margin + newW / 2))
          t.setAttribute('y', String(vbY - margin + Math.max(20, margin / 3)))
          t.setAttribute('text-anchor', 'middle')
          t.setAttribute('font-size', '20')
          t.setAttribute('font-weight', '600')
          t.setAttribute('fill', '#0f172a')
          const refNode = svgEl.firstChild ? (svgEl.firstChild as ChildNode).nextSibling : null
          svgEl.insertBefore(t, refNode)
        }
        return new XMLSerializer().serializeToString(svgEl)
      }

      const api: DiagramApi = {
        downloadPNG: ({ scale = 2, bg = '#ffffff', margin = 80 } = {}) => {
          try {
            const tight = cy.png({ full: true, scale, bg })
            const img = new Image()
            img.onload = () => {
              const canvas = document.createElement('canvas')
              canvas.width = img.width + margin * 2
              canvas.height = img.height + margin * 2
              const ctx = canvas.getContext('2d')!
              ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height)
              if (title && title.trim()) {
                ctx.fillStyle = '#0f172a'
                ctx.font = '600 20px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
                ctx.textAlign = 'center'; ctx.textBaseline = 'top'
                ctx.fillText(title.trim(), canvas.width / 2, Math.max(16, margin / 3))
              }
              ctx.drawImage(img, margin, margin)
              const out = canvas.toDataURL('image/png')
              const a = document.createElement('a'); a.href = out; a.download = 'wbs.png'
              document.body.appendChild(a); a.click(); a.remove()
            }
            img.src = tight
          } catch {}
        },
        downloadSVG: ({ bg, margin = 80 } = {}) => {
          try {
            const xml = getSvgWithMargin({ bg, margin })
            const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a'); a.href = url; a.download = 'wbs.svg'
            document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
          } catch {}
        },
        print: ({ bg, margin = 80 } = {}) => {
          try {
            const xml = getSvgWithMargin({ bg: bg ?? '#ffffff', margin })
            const win = window.open('', '_blank', 'noopener,noreferrer')
            if (!win) return
            win.document.open()
            win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>WBS</title><style>
              @page { size: auto; margin: 0; }
              body { margin: 0; background: white; display: flex; align-items: center; justify-content: center; }
            </style></head><body>${xml}</body></html>`)
            win.document.close()
            setTimeout(() => { win.focus(); win.print(); }, 250)
          } catch {}
        },
        exportJSON: () => exportJSONFrom(cy, { title, layoutMode, fontSize, boxWidth, boxHeight, textMaxWidth, showGrid, gridSize, snapToGrid }),
        importJSON: (json: string) => { const before = snapshot(cy); importJSONInto(cy, json); pushUndo(before); cy.resize(); onPositionsChange?.(snapshot(cy).positions) },
        fitToScreen: () => { try { cy.resize(); hardCenter(cy, 60) } catch {} },
        autoFitAll: () => { const pad = 14; cy.nodes().forEach(n => autoFitNodeWidth(n, 720, 140, pad)) },
        undo: doUndo,
        redo: doRedo
      }
      onReady(api)
    }

    // bigger root (1.25×)
    const scale = 1.25
    cy.style().selector('node.visual-root').style({
      'text-max-width': `${Math.round(textMaxWidth * scale)}px`,
      'font-size': fontSize * scale,
      width: boxWidth * scale,
      height: boxHeight * scale,
      padding: `${Math.round(14 * scale)}px`,
      'border-width': 3
    } as any).update()

    cy.nodes().forEach(n => { n.grabify() })

    if ('ResizeObserver' in window && ref.current) {
      const ro = new ResizeObserver(() => { try { cy.resize() } catch {} })
      ro.observe(ref.current); roRef.current = ro
    }

    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null; roRef.current?.disconnect(); roRef.current = null; window.getSelection?.()?.removeAllRanges?.() }
  }, [root, layoutMode, showGrid, gridSize, snapToGrid, title, fontSize, boxWidth, boxHeight, textMaxWidth, initialPositions, onPositionsChange])

  // live restyle
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return
    const scale = 1.25, px = (n: number) => Math.round(n)
    cy.style()
      .selector('node').style({ 'text-max-width': `${textMaxWidth}px`, 'font-size': fontSize, width: boxWidth, height: boxHeight, padding: '14px' } as any)
      .selector('node.visual-root').style({
        'text-max-width': `${px(textMaxWidth * scale)}px`, 'font-size': fontSize * scale,
        width: boxWidth * scale, height: boxHeight * scale, padding: `${px(14 * scale)}px`, 'border-width': 3
      } as any)
      .update()
  }, [fontSize, boxWidth, boxHeight, textMaxWidth])

  // live grid bg
  useEffect(() => {
    if (!ref.current) return
    if (!showGrid) { ref.current.style.background = '#f7f7f7' }
    else {
      const g = gridSize
      ref.current.style.background = `
        linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(0,0,0,0.06) 1px, transparent 1px),
        #f7f7f7
      `
      ref.current.style.backgroundSize = `${g}px ${g}px, ${g}px ${g}px, auto`
    }
  }, [showGrid, gridSize])

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {title && title.trim() && (
        <div style={{ position: 'absolute', top: 6, left: 0, right: 0, textAlign: 'center', zIndex: 2, fontWeight: 600, fontSize: 16, color: '#0f172a', pointerEvents: 'none' }}>
          {title.trim()}
        </div>
      )}
      <div ref={ref} style={{ width: '100%', height: '100%', border: '1px solid #e5e7eb', overflow: 'hidden', position: 'absolute', inset: 0, background: '#f7f7f7' }} />
    </div>
  )
}
