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

type DiagramApi = {
  downloadPNG: (opts?: { scale?: number; bg?: string; margin?: number }) => void
  downloadSVG: (opts?: { bg?: string; margin?: number }) => void
  fitToScreen: () => void
  autoFitAll?: () => void
}

type Props = {
  root: WbsNode
  title?: string
  onPositionsChange?: (p: Record<string, Pos>) => void
  onRename?: (id: string, newLabel: string) => void
  onReady?: (api: DiagramApi) => void
  fontSize?: number
  boxWidth?: number
  boxHeight?: number
  textMaxWidth?: number
  layoutMode?: LayoutMode
  showGrid?: boolean
  gridSize?: number
  snapToGrid?: boolean
}

/* ───────── helpers ───────── */

function getVisualRoot(node: WbsNode): WbsNode {
  const label = (node.label ?? '').trim().toLowerCase()
  if (label === 'root' && (node.children?.length ?? 0) === 1) return node.children![0]
  return node
}

function toElements(originalRoot: WbsNode) {
  const root = getVisualRoot(originalRoot)
  const nodes: any[] = []
  const edges: any[] = []
  const childrenById = new Map<string, string[]>()

  // visual root
  {
    const lbl = root.label ?? ''
    nodes.push({
      data: {
        id: root.id,
        label: lbl,
        level: root.level ?? 0,
        len: lbl.length,
        lines: Math.max(1, Math.ceil(lbl.length / 18))
      },
      classes: 'visual-root'
    })
  }

  const pushChild = (n: WbsNode) => {
    const lbl = n.label ?? ''
    nodes.push({
      data: {
        id: n.id,
        label: lbl,
        level: n.level ?? 0,
        len: lbl.length,
        lines: Math.max(1, Math.ceil(lbl.length / 18))
      }
    })
  }

  const visit = (n: WbsNode) => {
    for (const c of n.children || []) {
      pushChild(c)
      const lvl = c.level ?? 0
      const cpd = 60 + lvl * 30 // mindmap curve distance
      edges.push({ data: { id: `${n.id}-${c.id}`, source: n.id, target: c.id, level: lvl, cpd } })
      const arr = childrenById.get(n.id) || []
      arr.push(c.id)
      childrenById.set(n.id, arr)
      visit(c)
    }
  }
  visit(root)

  return { elements: [...nodes, ...edges], childrenById }
}

/** Center a parent horizontally over the span of its immediate children (for vertical layout polish) */
function centerParentOverChildren(n: NodeSingular) {
  const kids = n.outgoers('node')
  if (!kids || kids.empty()) return
  const bb = kids.boundingBox()
  const y = n.position('y')
  const cx = bb.x1 + bb.w / 2
  n.position({ x: cx, y })
}

/** For vertical layout: center root and level-1 parents over their children */
function postCenterParentsVertical(cy: Core) {
  const roots = cy.nodes().roots()
  roots.forEach(centerParentOverChildren)
  const l1 = roots.outgoers('node')
  l1.forEach(centerParentOverChildren)
}

/** Measure text width */
function measureTextWidth(text: string, fontPx: number, fontFamily = 'Inter, system-ui, Arial, sans-serif') {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return text.length * fontPx * 0.6
  ctx.font = `${Math.max(10, Math.round(fontPx))}px ${fontFamily}`
  return ctx.measureText(text).width
}

/** Auto-fit a node’s width to its label on demand */
function autoFitNodeWidth(node: NodeSingular, maxWidth = 720, minWidth = 140, paddingPx = 14) {
  const label = String(node.data('label') ?? '')
  if (!label) return
  const raw = node.style('font-size') as unknown as string | number
  const fs = typeof raw === 'number' ? raw : (parseFloat(String(raw).replace('px', '')) || 14)
  const w = measureTextWidth(label, fs)
  const desired = Math.min(maxWidth, Math.max(minWidth, Math.ceil(w + paddingPx * 2)))
  node.style({
    width: desired,
    'text-max-width': Math.max(40, desired - paddingPx * 2)
  })
}

/* ───────── chevron icons (inline SVG data URIs) ───────── */
const ICON_SIZE = 18
const CHEVRON_PADDING = 4 // px from the top-right corner
const PLUS_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24" fill="#0f172a"><rect x="1" y="1" width="22" height="22" rx="6" ry="6" fill="#ffffff" stroke="#94a3b8"/><path d="M12 6v12M6 12h12" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/></svg>`
)
const MINUS_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24" fill="#0f172a"><rect x="1" y="1" width="22" height="22" rx="6" ry="6" fill="#ffffff" stroke="#94a3b8"/><path d="M6 12h12" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/></svg>`
)
const PLUS_URI = `url("data:image/svg+xml,${PLUS_SVG}")`
const MINUS_URI = `url("data:image/svg+xml,${MINUS_SVG}")`

export default function Diagram({
  root,
  title,
  onPositionsChange,
  onRename,
  onReady,
  fontSize = 12,
  boxWidth = 240,
  boxHeight = 72,
  textMaxWidth = 220,
  layoutMode = 'horizontal',
  showGrid = true,
  gridSize = 10,
  snapToGrid = true
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null) // outer wrapper
  const ref = useRef<HTMLDivElement>(null)          // cy container
  const cyRef = useRef<Core | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const lastTapRef = useRef<{
    id: string; at: number; alt: boolean; shift: boolean; meta: boolean; ctrl: boolean
  } | null>(null)

  // collapse state + map of children
  const collapsedRef = useRef<Set<string>>(new Set())
  const childrenMapRef = useRef<Map<string, string[]>>(new Map())

  const dragState = useRef<{
    anchorId: string
    initialAnchor: Pos
    group: Map<string, Pos>
  } | null>(null)

  const hardCenter = (cy: Core, padding = 60) => {
    try {
      const bb = cy.elements().boundingBox()
      const w = cy.width(), h = cy.height()
      if (!w || !h || !isFinite(bb.w) || !isFinite(bb.h) || bb.w === 0 || bb.h === 0) return
      const zoom = Math.max(0.02, Math.min(w / (bb.w + padding * 2), h / (bb.h + padding * 2)))
      const cx = bb.x1 + bb.w / 2
      const cyy = bb.y1 + bb.h / 2
      cy.zoom(zoom)
      cy.pan({ x: w / 2 - cx * zoom, y: h / 2 - cyy * zoom })
    } catch {}
  }

  const makeLayout = (cy: Core) => {
    if (layoutMode === 'vertical') {
      // OPTION B: Dagre top->bottom tends to keep sibling order
      return cy.layout({
        name: 'dagre',
        rankDir: 'TB',
        nodeSep: 60,
        rankSep: 120
      } as any)
    }
    if (layoutMode === 'mindmap') {
      const rootsSel = cy.nodes().roots().map(n => `#${n.id()}`).join(',') || undefined
      return cy.layout({
        name: 'breadthfirst',
        directed: true,
        roots: rootsSel,
        circle: true,
        spacingFactor: 1.6,
        avoidOverlap: true,
        animate: false
      } as any)
    }
    // horizontal default: Dagre left->right
    return cy.layout({ name: 'dagre', rankDir: 'LR', nodeSep: 60, rankSep: 120 } as any)
  }

  const buildDescendantsGetter = (childrenById: Map<string, string[]>) => {
    const cache = new Map<string, string[]>()
    const dfs = (id: string): string[] => {
      if (cache.has(id)) return cache.get(id)!
      const direct = childrenById.get(id) || []
      const acc: string[] = []
      for (const c of direct) { acc.push(c); acc.push(...dfs(c)) }
      cache.set(id, acc)
      return acc
    }
    return dfs
  }

  /** Hide or show all descendants for a parent id */
  const setCollapsed = (cy: Core, parentId: string, collapse: boolean) => {
    const childrenMap = childrenMapRef.current
    const dfs = buildDescendantsGetter(childrenMap)
    const descIds = dfs(parentId)
    // Select descendants by a single selector string
    const selector = descIds.map(id => `#${id}`).join(',')
    const nodes = selector ? cy.$(selector).filter('node') : cy.collection()
    const edges = nodes.connectedEdges().union(
      cy.getElementById(parentId).connectedEdges().filter(e => descIds.includes(e.target().id()))
    )
    if (collapse) {
      nodes.style('display', 'none')
      edges.style('display', 'none')
      collapsedRef.current.add(parentId)
      cy.getElementById(parentId).addClass('collapsed-parent')
      setChevronIcon(cy.getElementById(parentId), true)
    } else {
      nodes.style('display', 'element')
      edges.style('display', 'element')
      collapsedRef.current.delete(parentId)
      cy.getElementById(parentId).removeClass('collapsed-parent')
      setChevronIcon(cy.getElementById(parentId), false)
    }
  }

  const toggleCollapsed = (cy: Core, parentId: string) => {
    const isCollapsed = collapsedRef.current.has(parentId)
    setCollapsed(cy, parentId, !isCollapsed)
  }

  /** Set chevron icon background for a parent node */
  const setChevronIcon = (node: NodeSingular, collapsed: boolean) => {
    node.style({
      'background-image': collapsed ? PLUS_URI : MINUS_URI,
      'background-width': ICON_SIZE,
      'background-height': ICON_SIZE,
      'background-repeat': 'no-repeat',
      'background-fit': 'none',
      'background-position-x': '100%',
      'background-position-y': '0%'
    })
  }

  /** Initialize chevrons on all parent nodes */
  const initChevrons = (cy: Core) => {
    cy.nodes().forEach(n => {
      const id = n.id()
      const hasChildren = (childrenMapRef.current.get(id) || []).length > 0
      if (hasChildren) {
        n.addClass('collapsible')
        setChevronIcon(n, /*collapsed*/ false)
      } else {
        n.removeStyle('background-image')
      }
    })
  }

  /** Did a click hit the chevron rect (top-right)? */
  const hitChevron = (node: NodeSingular, evt: any): boolean => {
    const bb = node.renderedBoundingBox({ includeOverlays: false })
    const x = evt.renderedPosition.x
    const y = evt.renderedPosition.y
    const right = bb.x2
    const top = bb.y1
    const pad = CHEVRON_PADDING
    const size = ICON_SIZE
    const rect = {
      x1: right - pad - size,
      y1: top + pad,
      x2: right - pad,
      y2: top + pad + size
    }
    return x >= rect.x1 && x <= rect.x2 && y >= rect.y1 && y <= rect.y2
  }

  /* ────────────────────────────────
     INIT / REBUILD: root or mode
     ──────────────────────────────── */
  useEffect(() => {
    if (!ref.current) return

    const { elements, childrenById } = toElements(root)
    childrenMapRef.current = childrenById
    collapsedRef.current.clear()

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
          }
        },
        { selector: 'node:hover', style: { 'border-color': '#2563eb', 'border-width': 2, 'shadow-blur': 26, 'shadow-color': 'rgba(37,99,235,0.28)' } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#2563eb', 'background-opacity': 0.98, 'shadow-blur': 28, 'shadow-color': 'rgba(37,99,235,0.35)' } },
        // Collapsed marker
        { selector: 'node.collapsed-parent', style: { 'border-style': 'dashed', 'border-color': '#64748b' } },
        // Mindmap compact sizing
        ...(layoutMode === 'mindmap'
          ? [{
              selector: 'node',
              style: {
                'font-size': Math.max(10, fontSize - 1),
                'text-max-width': '160px',
                width: 'mapData(len,   1, 60,  90, 220)',
                height: 'mapData(lines,1,  6,  40, 110)',
                padding: '8px'
              }
            } as any]
          : []),
        // Level colors
        { selector: 'node[level = 0]', style: { 'background-color': '#eef2ff', 'border-color': '#c7d2fe' } },
        { selector: 'node[level = 1]', style: { 'background-color': '#dbeafe', 'border-color': '#93c5fd' } },
        { selector: 'node[level = 2]', style: { 'background-color': '#dcfce7', 'border-color': '#86efac' } },
        { selector: 'node[level = 3]', style: { 'background-color': '#fef9c3', 'border-color': '#fde68a' } },
        { selector: 'node[level = 4]', style: { 'background-color': '#fee2e2', 'border-color': '#fca5a5' } },
        { selector: 'node[level >= 5]', style: { 'background-color': '#f1f5f9', 'border-color': '#cbd5e1' } },
        // Edges
        {
          selector: 'edge',
          style: {
            width: 2.5,
            'line-color': '#94a3b8',
            'line-opacity': 1,
            'curve-style':
              layoutMode === 'vertical'
                ? 'taxi'
                : layoutMode === 'mindmap'
                  ? 'unbundled-bezier'
                  : 'bezier',
            ...(layoutMode === 'vertical' ? {
              'taxi-direction': 'downward',
              'taxi-turn': 24,
              'taxi-turn-min-distance': 12
            } : {}),
            ...(layoutMode === 'mindmap' ? {
              'edge-distances': 'node-position',
              'control-point-distances': 'data(cpd)',
              'control-point-weights': 0.5
            } : {})
          }
        },
        { selector: 'edge:hover', style: { width: 3.5, 'line-color': '#64748b' } },
        { selector: 'edge:selected', style: { width: 4, 'line-color': '#2563eb' } },
        { selector: 'node.visual-root', style: { 'border-width': 2, 'border-color': '#94a3b8' } }
      ],
      layout: { name: 'preset' }
    })

    // Background grid
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
          const zoom = Math.max(0.02, Math.min(w / (bb.w + 120), h / (bb.h + 120)))
          const cx = bb.x1 + bb.w / 2
          const cyy = bb.y1 + bb.h / 2
          cy.zoom(zoom)
          cy.pan({ x: w / 2 - cx * zoom, y: h / 2 - cyy * zoom })
        }
      } catch {}
    }

    const savePositions = () => {
      if (!onPositionsChange) return
      const next: Record<string, Pos> = {}
      cy.nodes().forEach(n => { const p = n.position(); next[n.id()] = { x: p.x, y: p.y } })
      onPositionsChange(next)
    }

    const runLayout = () => {
      const layout = makeLayout(cy)
      if (layoutMode === 'mindmap') { try { cy.reset() } catch {} }
      const after = () => {
        if (layoutMode === 'vertical') {
          try { postCenterParentsVertical(cy); savePositions() } catch {}
        }
        fitAll()
      }
      cy.one('layoutstop', after)
      layout.run()
      setTimeout(after, 50)
      setTimeout(after, 200)
    }

    cy.ready(() => {
      runLayout()
      initChevrons(cy) // after layout so sizes are known
    })

    /* parent drags descendants */
    const dfsFactory = buildDescendantsGetter(childrenById)

    const startGroupDrag = (evt: any) => {
      const t = evt.target
      if (!t || t.group?.() !== 'nodes') return
      const id = t.id()
      const sel = cy.$('node:selected')
      let group: CollectionReturnValue
      if (sel.nonempty() && sel.filter(`#${id}`).nonempty()) {
        group = sel
      } else {
        const descIds = dfsFactory(id)
        group = cy.collection([t, ...descIds.map(did => cy.getElementById(did))])
      }
      const map = new Map<string, Pos>()
      group.forEach(n => { const p = n.position(); map.set(n.id(), { x: p.x, y: p.y }) })
      dragState.current = { anchorId: id, initialAnchor: { ...t.position() }, group: map }
    }

    const onDragMove = (evt: any) => {
      const st = dragState.current
      if (!st || evt.target.id() !== st.anchorId) return
      const now = evt.target.position()
      const dx = now.x - st.initialAnchor.x
      const dy = now.y - st.initialAnchor.y
      cy.startBatch()
      for (const [nid, pos] of st.group.entries()) {
        if (nid === st.anchorId) continue
        cy.getElementById(nid).position({ x: pos.x + dx, y: pos.y + dy })
      }
      cy.endBatch()
    }

    const snapGroupToGrid = () => {
      if (!dragState.current || !snapToGrid) return
      const z = cy.zoom()
      const pan = cy.pan()
      const step = gridSize

      cy.startBatch()
      for (const nid of dragState.current.group.keys()) {
        const ele = cy.getElementById(nid)
        const p = ele.position()
        const sx = p.x * z + pan.x
        const sy = p.y * z + pan.y
        const halfW = ele.renderedWidth() / 2
        const halfH = ele.renderedHeight() / 2
        const left = sx - halfW
        const top = sy - halfH
        const left2 = Math.round(left / step) * step
        const top2 = Math.round(top / step) * step
        const sx2 = left2 + halfW
        const sy2 = top2 + halfH
        ele.position({ x: (sx2 - pan.x) / z, y: (sy2 - pan.y) / z })
      }
      cy.endBatch()
    }

    const endGroupDrag = () => {
      snapGroupToGrid()
      dragState.current = null
      savePositions()
    }

    cy.on('grab', 'node', startGroupDrag)
    cy.on('drag', 'node', onDragMove)
    cy.on('dragfree', 'node', endGroupDrag)
    cy.on('free', 'node', endGroupDrag)

    // Tap: chevron click first; then double-click shortcuts
    const onTap = (evt: any) => {
      const target = evt.target
      if (!target || target.group?.() !== 'nodes') return
      const id: string = target.id()
      const now = Date.now()
      const oe: any = evt.originalEvent
      const alt = !!(oe && oe.altKey)
      const shift = !!(oe && oe.shiftKey)
      const meta = !!(oe && oe.metaKey)
      const ctrl = !!(oe && oe.ctrlKey)

      // Chevron?
      const isParent = (childrenMapRef.current.get(id) || []).length > 0
      if (isParent && hitChevron(target, evt)) {
        toggleCollapsed(cy, id)
        return
      }

      // Double-click gestures
      const last = lastTapRef.current
      if (last && last.id === id && now - last.at < 300) {
        lastTapRef.current = null
        if ((meta || ctrl)) {
          if (isParent) toggleCollapsed(cy, id)
        } else if (alt && onRename) {
          const current = String(target.data('label') ?? '')
          const next = window.prompt('Rename task:', current)
          if (next && next.trim() && next !== current) onRename(id, next.trim())
        } else if (shift) {
          target.removeStyle('width')
          target.removeStyle('text-max-width')
        } else {
          autoFitNodeWidth(target, 720, 140, 14)
        }
      } else {
        lastTapRef.current = { id, at: now, alt, shift, meta, ctrl }
      }
    }
    cy.on('tap', 'node', onTap)

    // Export API
    if (onReady) {
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
              ctx.fillStyle = bg
              ctx.fillRect(0, 0, canvas.width, canvas.height)
              if (title && title.trim()) {
                ctx.fillStyle = '#0f172a'
                ctx.font = '600 20px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif'
                ctx.textAlign = 'center'
                ctx.textBaseline = 'top'
                ctx.fillText(title.trim(), canvas.width / 2, Math.max(16, margin / 3))
              }
              ctx.drawImage(img, margin, margin)
              const out = canvas.toDataURL('image/png')
              const a = document.createElement('a')
              a.href = out; a.download = 'wbs.png'
              document.body.appendChild(a); a.click(); a.remove()
            }
            img.src = tight
          } catch {}
        },
        downloadSVG: ({ bg, margin = 80 } = {}) => {
          try {
            const raw = (cy as any).svg({ full: true }) as string
            const parser = new DOMParser()
            const doc = parser.parseFromString(raw, 'image/svg+xml')
            const svgEl = doc.documentElement
            const viewBoxAttr = svgEl.getAttribute('viewBox')
            const widthAttr = svgEl.getAttribute('width')
            const heightAttr = svgEl.getAttribute('height')
            let w = 0, h = 0, vbX = 0, vbY = 0, vbW = 0, vbH = 0
            if (viewBoxAttr) {
              const parts = viewBoxAttr.split(/\s+/).map(Number)
              ;[vbX, vbY, vbW, vbH] = parts; w = vbW; h = vbH
            } else if (widthAttr && heightAttr) {
              w = parseFloat(widthAttr); h = parseFloat(heightAttr)
              svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`); vbW = w; vbH = h
            }
            const newW = w + margin * 2, newH = h + margin * 2
            const newViewBox = `${vbX - margin} ${vbY - margin} ${newW} ${newH}`
            svgEl.setAttribute('viewBox', newViewBox)
            svgEl.setAttribute('width', String(newW))
            svgEl.setAttribute('height', String(newH))
            if (bg) {
              const rect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
              rect.setAttribute('x', String(vbX - margin))
              rect.setAttribute('y', String(vbY - margin))
              rect.setAttribute('width', String(newW))
              rect.setAttribute('height', String(newH))
              rect.setAttribute('fill', bg)
              svgEl.insertBefore(rect, svgEl.firstChild)
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
            const xml = new XMLSerializer().serializeToString(svgEl)
            const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = 'wbs.svg'
            document.body.appendChild(a); a.click(); a.remove()
            URL.revokeObjectURL(url)
          } catch {}
        },
        fitToScreen: () => { try { cy.resize(); hardCenter(cy, 60) } catch {} },
        autoFitAll: () => {
          const pad = 14
          cy.nodes().forEach(n => autoFitNodeWidth(n, 720, 140, pad))
        }
      }
      onReady(api)
    }

    // Larger visual root (1.25×)
    const scale = 1.25
    cy.style()
      .selector('node.visual-root').style({
        'text-max-width': `${Math.round(textMaxWidth * scale)}px`,
        'font-size': fontSize * scale,
        width: boxWidth * scale,
        height: boxHeight * scale,
        padding: `${Math.round(14 * scale)}px`,
        'border-width': 3
      })
      .update()

    cy.nodes().forEach(n => { n.grabify() })

    if ('ResizeObserver' in window && ref.current) {
      const ro = new ResizeObserver(() => { try { cy.resize() } catch {} })
      ro.observe(ref.current); roRef.current = ro
    }

    cyRef.current = cy
    return () => {
      cy.off('grab', 'node', startGroupDrag)
      cy.off('drag', 'node', onDragMove)
      cy.off('dragfree', 'node', endGroupDrag)
      cy.off('free', 'node', endGroupDrag)
      cy.off('tap', 'node', onTap)
      roRef.current?.disconnect(); roRef.current = null
      cy.destroy(); cyRef.current = null
    }
  }, [root, layoutMode, showGrid, gridSize, snapToGrid, title, fontSize, boxWidth, boxHeight, textMaxWidth])

  /* live restyle for sliders (no rebuild) */
  useEffect(() => {
    const cy = cyRef.current; if (!cy) return
    const scale = 1.25
    const px = (n: number) => Math.round(n)
    cy.style()
      .selector('node').style({
        'text-max-width': `${textMaxWidth}px`,
        'font-size': fontSize,
        width: boxWidth,
        height: boxHeight,
        padding: '14px'
      })
      .selector('node.visual-root').style({
        'text-max-width': `${px(textMaxWidth * scale)}px`,
        'font-size': fontSize * scale,
        width: boxWidth * scale,
        height: boxHeight * scale,
        padding: `${px(14 * scale)}px`,
        'border-width': 3
      })
      .update()
  }, [fontSize, boxWidth, boxHeight, textMaxWidth])

  // live grid bg
  useEffect(() => {
    if (!ref.current) return
    if (!showGrid) {
      ref.current.style.background = '#f7f7f7'
    } else {
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
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* title overlay (onscreen) */}
      {title && title.trim() && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: 0,
            right: 0,
            textAlign: 'center',
            zIndex: 2,
            fontWeight: 600,
            fontSize: 16,
            color: '#0f172a',
            pointerEvents: 'none'
          }}
        >
          {title.trim()}
        </div>
      )}
      {/* cytoscape container */}
      <div
        ref={ref}
        style={{
          width: '100%',
          height: '100%',
          border: '1px solid #e5e7eb',
          overflow: 'hidden',
          position: 'absolute',
          inset: 0,
          background: '#f7f7f7'
        }}
      />
    </div>
  )
}
