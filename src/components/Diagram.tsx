import cytoscape from 'cytoscape'
import type { Core, CollectionReturnValue, NodeSingular } from 'cytoscape'
import dagre from 'cytoscape-dagre'
import elk from 'cytoscape-elk'
import svg from 'cytoscape-svg'
import { useEffect, useRef } from 'react'
import type { WbsNode } from '../lib/parseOutline'

cytoscape.use(dagre as any)
cytoscape.use(elk as any)
cytoscape.use(svg as any)

type Pos = { x: number; y: number }
export type LayoutMode = 'horizontal' | 'vertical' | 'mindmap'

type DiagramApi = {
  downloadPNG: (opts?: { scale?: number; bg?: string; margin?: number }) => void
  downloadSVG: (opts?: { bg?: string; margin?: number }) => void
  fitToScreen: () => void
}

type Props = {
  root: WbsNode
  positions?: Record<string, Pos>
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

  return { elements: [...nodes, ...edges], nodeIds: nodes.map(n => n.data.id), layoutRootId: root.id, childrenById }
}

/** Center a parent horizontally over the span of its immediate children */
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

export default function Diagram({
  root,
  positions = {},
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
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const lastTapRef = useRef<{ id: string; at: number } | null>(null)

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

  // NOTE: layoutRootId no longer needed (mindmap uses cy.nodes().roots())
  const makeLayout = (cy: Core, canUsePreset: boolean) => {
    if (layoutMode !== 'mindmap' && canUsePreset) {
      return cy.layout({ name: 'preset', positions: (n: any) => positions[n.id()] })
    }
    if (layoutMode === 'vertical') {
      return cy.layout({
        name: 'elk',
        nodeDimensionsIncludeLabels: true,
        fit: true,
        elk: {
          algorithm: 'layered',
          'elk.direction': 'DOWN',
          // spacing
          'elk.layered.spacing.nodeNodeBetweenLayers': 120,
          'elk.spacing.nodeNode': 60,
          // routing
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.mergeEdges': true,
          // try to center (ELK)
          'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
          'elk.layered.nodePlacement.bk.fixedAlignment': 'CENTER'
        }
      } as any)
    }
    if (layoutMode === 'mindmap') {
      // use actual roots that Cytoscape detects from edges
      const rootsSel =
        cy.nodes().roots().map(n => `#${n.id()}`).join(',') || undefined
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
    // horizontal (LR)
    return cy.layout({ name: 'dagre', rankDir: 'LR', nodeSep: 60, rankSep: 120 } as any)
  }

  const buildDescendantsGetter = (childrenById: Map<string, string[]>) => {
    const cache = new Map<string, string[]>()
    const dfs = (id: string): string[] => {
      if (cache.has(id)) return cache.get(id)!
      const dir = childrenById.get(id) || []
      const acc: string[] = []
      for (const c of dir) { acc.push(c); acc.push(...dfs(c)) }
      cache.set(id, acc)
      return acc
    }
    return dfs
  }

  useEffect(() => {
    if (!ref.current) return

const { elements, nodeIds, childrenById } = toElements(root)

    const hasAllPositions =
      nodeIds.length > 0 &&
      nodeIds.every(id => positions[id] && Number.isFinite(positions[id].x) && Number.isFinite(positions[id].y))

    const usePreset = hasAllPositions && layoutMode !== 'mindmap'

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
            padding: '12px',
            'border-width': 1,
            'background-opacity': 1,
            width: boxWidth,
            height: boxHeight
          }
        },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#2563eb', 'background-opacity': 0.95 } },
        ...(layoutMode === 'mindmap'
          ? [{
              selector: 'node',
              style: {
                'font-size': Math.max(10, fontSize - 2),
                'text-max-width': '140px',
                width: 'mapData(len,   1, 60,  80, 200)',
                height: 'mapData(lines,1,  6,  36, 100)',
                padding: '6px'
              }
            } as any]
          : []),
        { selector: 'node[level = 0]', style: { 'background-color': '#c7d2fe', 'border-color': '#93c5fd' } },
        { selector: 'node[level = 1]', style: { 'background-color': '#dbeafe', 'border-color': '#93c5fd' } },
        { selector: 'node[level = 2]', style: { 'background-color': '#dcfce7', 'border-color': '#86efac' } },
        { selector: 'node[level = 3]', style: { 'background-color': '#fef9c3', 'border-color': '#fde68a' } },
        { selector: 'node[level = 4]', style: { 'background-color': '#fee2e2', 'border-color': '#fca5a5' } },
        { selector: 'node[level >= 5]', style: { 'background-color': '#fef9c3', 'border-color': '#fde68a' } },
        { selector: 'edge', style: { width: 2.5, 'line-opacity': 1, 'line-color': '#94a3b8', 'curve-style': 'bezier' } },
        { selector: 'edge[level = 1]', style: { width: 3.5 } },
        ...(layoutMode === 'mindmap'
          ? [{
              selector: 'edge',
              style: {
                'curve-style': 'unbundled-bezier',
                'edge-distances': 'node-position',
                'control-point-distances': 'data(cpd)',
                'control-point-weights': 0.5
              }
            } as any]
          : []),
        ...(layoutMode === 'vertical'
          ? [{
              selector: 'edge',
              style: {
                'curve-style': 'taxi',
                'taxi-direction': 'downward',
                'taxi-turn': 20,
                'taxi-turn-min-distance': 10
              }
            } as any]
          : [])
      ],
      layout: { name: 'preset' }
    })

    // grid background
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
        cy.fit(undefined, 60)
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

    const run = () => {
      const layout = makeLayout(cy, usePreset)
      if (layoutMode === 'mindmap') { try { cy.reset() } catch {} }

      const after = () => {
        if (layoutMode === 'vertical') {
          try {
            postCenterParentsVertical(cy)
            savePositions()
          } catch {}
        }
        fitAll()
      }

      cy.one('layoutstop', after)
      layout.run()
      setTimeout(after, 50)
      setTimeout(after, 200)
      setTimeout(after, 400)
    }

    cy.ready(run)

    /* ─── drag grouping ─── */
    const startGroupDrag = (evt: any) => {
      const t = evt.target
      if (!t || t.group?.() !== 'nodes') return
      const id = t.id()
      const sel = cy.$('node:selected')
      let group: CollectionReturnValue
      if (sel.nonempty() && sel.filter(`#${id}`).nonempty()) {
        group = sel
      } else {
        const descendantsOf = buildDescendantsGetter(childrenById)
        const descIds = descendantsOf(id)
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

    // border-aligned snap-to-grid
    const snapGroupToGrid = () => {
      if (!dragState.current || !snapToGrid) return
      const z = cy.zoom()
      const pan = cy.pan()
      const step = gridSize

      cy.startBatch()
      for (const nid of dragState.current.group.keys()) {
        const ele = cy.getElementById(nid)

        // center in screen px
        const p = ele.position()
        const sx = p.x * z + pan.x
        const sy = p.y * z + pan.y

        // half extents in screen px
        const halfW = ele.renderedWidth() / 2
        const halfH = ele.renderedHeight() / 2

        // snap top-left border, then compute center
        const left = sx - halfW
        const top = sy - halfH
        const left2 = Math.round(left / step) * step
        const top2 = Math.round(top / step) * step
        const sx2 = left2 + halfW
        const sy2 = top2 + halfH

        // back to model coords
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

    // double-tap rename
    const onTap = (evt: any) => {
      const target = evt.target
      if (!target || target.group?.() !== 'nodes') return
      const id: string = target.id()
      const now = Date.now()
      const last = lastTapRef.current
      if (last && last.id === id && now - last.at < 300) {
        lastTapRef.current = null
        if (!onRename) return
        const current = String(target.data('label') ?? '')
        const next = window.prompt('Rename task:', current)
        if (next && next.trim() && next !== current) onRename(id, next.trim())
      } else {
        lastTapRef.current = { id, at: now }
      }
    }
    cy.on('tap', 'node', onTap)

    // export API
    if (onReady) {
      const api: DiagramApi = {
        downloadPNG: ({ scale = 2, bg = '#ffffff', margin = 80 } = {}) => {
          try {
            fitAll()
            const tight = cy.png({ full: true, scale, bg })
            const img = new Image()
            img.onload = () => {
              const canvas = document.createElement('canvas')
              canvas.width = img.width + margin * 2
              canvas.height = img.height + margin * 2
              const ctx = canvas.getContext('2d')!
              ctx.fillStyle = bg
              ctx.fillRect(0, 0, canvas.width, canvas.height)
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
            fitAll()
            const raw = (cy as any).svg({ full: true }) as string
            const parser = new DOMParser()
            const doc = parser.parseFromString(raw, 'image/svg+xml')
            const svgEl = doc.documentElement
            const widthAttr = svgEl.getAttribute('width')
            const heightAttr = svgEl.getAttribute('height')
            const viewBoxAttr = svgEl.getAttribute('viewBox')
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
            const xml = new XMLSerializer().serializeToString(svgEl)
            const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url; a.download = 'wbs.svg'
            document.body.appendChild(a); a.click(); a.remove()
            URL.revokeObjectURL(url)
          } catch {}
        },
        fitToScreen: () => { try { cy.resize(); hardCenter(cy, 60) } catch {} }
      }
      onReady(api)
    }

    // larger visual root (1.25×)
    const scale = 1.25
    cy.style()
      .selector('node.visual-root').style({
        'text-max-width': `${Math.round(textMaxWidth * scale)}px`,
        'font-size': fontSize * scale,
        width: boxWidth * scale,
        height: boxHeight * scale,
        padding: `${Math.round(12 * scale)}px`,
        'border-width': 3
      })
      .update()

    // draggable
    cy.nodes().forEach(n => { n.grabify() })

    // resize observer
    if ('ResizeObserver' in window && ref.current) {
      const ro = new ResizeObserver(() => { try { cy.resize(); hardCenter(cy, 60) } catch {} })
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
    // NOTE: do not depend on `positions`; prevents spring-back while dragging
  }, [root, layoutMode, showGrid, gridSize, snapToGrid, fontSize, boxWidth, boxHeight, textMaxWidth])

  // live style updates (keep root 1.25×)
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
        padding: '12px'
      })
      .selector('node.visual-root').style({
        'text-max-width': `${px(textMaxWidth * scale)}px`,
        'font-size': fontSize * scale,
        width: boxWidth * scale,
        height: boxHeight * scale,
        padding: `${px(12 * scale)}px`,
        'border-width': 3
      })
      .update()
  }, [fontSize, boxWidth, boxHeight, textMaxWidth])

  // grid background live updates
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
    <div
      ref={ref}
      style={{
        width: '100%',
        height: '100%',
        border: '1px solid #ddd',
        overflow: 'hidden',
        position: 'relative',
        background: '#f7f7f7'
      }}
    />
  )
}
