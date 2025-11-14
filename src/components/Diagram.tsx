// src/components/Diagram.tsx
import { useEffect, useMemo, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { Core, ElementDefinition, Position } from 'cytoscape'
import dagre from 'cytoscape-dagre'

cytoscape.use(dagre)

// Enable Manhattan edges safely (no endpoints)
const ADVANCED_EDGES = true

// ===== Public types =====
export type LayoutMode = 'horizontal' | 'vertical' | 'mindmap'

export type DiagramApi = {
  cy: Core
  downloadPNG: (opts?: { scale?: number; bg?: string; margin?: number }) => void
  downloadSVG: (opts?: { bg?: string; margin?: number }) => void
  autoFitAll: (padding?: number) => void
  fitToScreen: (padding?: number) => void
  undo: () => void
  redo: () => void
}

export type WbsNode = {
  id: string
  label: string
  children?: WbsNode[]
}

// ===== Props =====
type Props = {
  root: WbsNode
  layoutMode: LayoutMode
  fontSize: number
  boxWidth: number
  boxHeight: number
  textMaxWidth: number
  showGrid?: boolean
  snapToGrid?: boolean
  gridSize?: number
  title?: string
  onReady?: (api: DiagramApi) => void
  onRename?: (id: string, label: string) => void // accepted but not used here
}

// ===== helpers =====
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
const safeNum = (v: unknown, fallback: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const toPx = (v: unknown, fallback: number) => `${Math.max(0, safeNum(v, fallback))}px`
const roundTo = (v: number, step: number) => Math.round(v / step) * step

type Snapshot = Record<string, Position>

const takeSnapshot = (cy: Core): Snapshot => {
  const map: Snapshot = {}
  cy.nodes().forEach((n) => { map[n.id()] = { ...n.position() } })
  return map
}
const applySnapshot = (cy: Core, snap: Snapshot) => {
  cy.startBatch()
  Object.entries(snap).forEach(([id, p]) => {
    const n = cy.getElementById(id)
    if (n.nonempty()) n.position(p)
  })
  cy.endBatch()
}

function toElements(
  root: WbsNode,
  layout: LayoutMode,
  boxW: number,
  boxH: number
): { elements: ElementDefinition[] } {
  const els: ElementDefinition[] = []
  const walk = (node: WbsNode, level: number, parent?: WbsNode) => {
    els.push({
      data: { id: node.id, label: node.label, level },
      style: { width: boxW, height: boxH }
    })
    if (parent) {
      // No endpoints here (they caused the crash)
      els.push({ data: { id: `${parent.id}-${node.id}`, source: parent.id, target: node.id } })
    }
    node.children?.forEach((c) => walk(c, level + 1, node))
  }
  walk(root, 0)
  return { elements: els }
}

function makeLayout(layout: LayoutMode) {
  if (layout === 'vertical') {
    return { name: 'dagre', rankDir: 'TB', nodeSep: 40, rankSep: 90, edgeSep: 18, fit: true } as any
  }
  if (layout === 'mindmap') {
    return { name: 'dagre', rankDir: 'LR', nodeSep: 40, rankSep: 120, edgeSep: 16, spacingFactor: 1, fit: true } as any
  }
  return { name: 'dagre', rankDir: 'LR', nodeSep: 60, rankSep: 110, edgeSep: 24, fit: true } as any
}

export default function Diagram({
  root,
  layoutMode,
  fontSize,
  boxWidth,
  boxHeight,
  textMaxWidth,
  showGrid = true,
  snapToGrid = true,
  gridSize = 10,
  title,
  onReady
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cyRef = useRef<Core | null>(null)

  const undoStack = useRef<Snapshot[]>([])
  const redoStack = useRef<Snapshot[]>([])
  const dragStartSnap = useRef<Snapshot | null>(null)

  const safeBoxW = safeNum(boxWidth, 240)
  const safeBoxH = safeNum(boxHeight, 72)
  const safeFont = clamp(safeNum(fontSize, 14), 8, 64)
  const safeTmwPx = toPx(textMaxWidth, 220)
  const safeGrid = safeNum(gridSize, 10)

  const { elements } = useMemo(
    () => toElements(root, layoutMode, safeBoxW, safeBoxH),
    [root, layoutMode, safeBoxW, safeBoxH]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    cyRef.current?.destroy()

    // grid background
    el.style.background = showGrid
      ? `linear-gradient(to right, #eef2f6 1px, transparent 1px),
         linear-gradient(to bottom, #eef2f6 1px, transparent 1px)`
      : 'transparent'
    el.style.backgroundSize = `${safeGrid}px ${safeGrid}px`

    const cy = cytoscape({
      container: el,
      elements,
      wheelSensitivity: 0.35,
      pixelRatio: 1,
      layout: makeLayout(layoutMode),
      style: [
        // Nodes
        {
          selector: 'node',
          style: {
            shape: 'round-rectangle',
            label: 'data(label)',
            'text-wrap': 'wrap',
            'text-max-width': safeTmwPx,
            'font-size': safeFont,
            'text-valign': 'center',
            'text-halign': 'center',
            padding: 12,
            width: safeBoxW,
            height: safeBoxH,
            'background-color': '#ffffff',
            'border-width': 1,
            'border-color': '#cbd5e1'
          } as any
        },
        { selector: 'node[level = 0]', style: { 'background-color': '#e6eefc', 'border-color': '#93c5fd', 'border-width': 2 } as any },
        { selector: 'node[level = 1]', style: { 'background-color': '#e0f2fe' } as any },
        { selector: 'node[level = 2]', style: { 'background-color': '#dcfce7' } as any },
        { selector: 'node[level = 3]', style: { 'background-color': '#fef9c3' } as any },
        { selector: 'node[level >= 4]', style: { 'background-color': '#f1f5f9' } as any },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#2563eb' } as any },

        // Edges (Manhattan without endpoints)
        {
          selector: 'edge',
          style: {
            width: 2.5,
            'line-color': '#94a3b8',
            'line-opacity': 1,
            'curve-style': ADVANCED_EDGES ? 'taxi' : 'bezier',
            ...(ADVANCED_EDGES
              ? {
                  'taxi-direction': layoutMode === 'vertical' ? 'downward' : 'horizontal',
                  'taxi-turn': 14,
                  'taxi-turn-min-distance': 0,
                  'edge-distances': 'intersection',
                  'line-cap': 'round'
                }
              : {})
          } as any
        }
      ]
    })

    // Run initial layout explicitly
    const lay = cy.layout(makeLayout(layoutMode))
    lay.run()

    // Mindmap: mirror every other immediate child subtree to the LEFT of the root
    if (layoutMode === 'mindmap') {
      const rootNode = cy.nodes('[level = 0]').first()
      if (rootNode.nonempty()) {
        const rootId = rootNode.id()
        const rootX = rootNode.position('x')
        const children = cy.edges(`[source = "${rootId}"]`).targets()
        children.forEach((child, idx) => {
          const placeLeft = idx % 2 === 1
          if (!placeLeft) return
          const subtree = child.union(child.successors())
          const GAP = 40
          cy.startBatch()
          subtree.nodes().positions((n) => {
            const p = n.position()
            const dx = p.x - rootX
            return { x: rootX - dx - GAP, y: p.y }
          })
          cy.endBatch()
        })
        cy.center(rootNode)
      }
    }

    // history + snap-to-grid
    cy.on('grab', 'node', () => { dragStartSnap.current = takeSnapshot(cy) })
    cy.on('dragfree', 'node', (evt) => {
      if (snapToGrid) {
        const n = evt.target
        const p = n.position()
        n.position({ x: roundTo(p.x, safeGrid), y: roundTo(p.y, safeGrid) })
      }
      const before = dragStartSnap.current
      const after = takeSnapshot(cy)
      dragStartSnap.current = null
      if (before) {
        undoStack.current.push(before)
        redoStack.current = []
      }
      undoStack.current.push(after)
    })

    cy.minZoom(0.3)
    cy.maxZoom(2.5)

    cyRef.current = cy

    const api: DiagramApi = {
      cy,
      downloadPNG: (userOpts) => {
        const options: any = {
          output: 'blob',
          scale: userOpts?.scale ?? 2,
          bg: userOpts?.bg ?? '#ffffff',
          full: true
        }
        if (typeof userOpts?.margin === 'number') options.padding = userOpts.margin
        const blob = (cy as any).png(options) as Blob
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'wbs.png'
        a.click()
        URL.revokeObjectURL(url)
      },
      downloadSVG: (userOpts) => {
        const hasSvg = typeof (cy as any).svg === 'function'
        if (!hasSvg) return
        const options: any = { full: true, bg: userOpts?.bg }
        if (typeof userOpts?.margin === 'number') options.padding = userOpts.margin
        const svgStr: string = (cy as any).svg(options)
        const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(svgStr ? blob : new Blob())
        const a = document.createElement('a')
        a.href = url
        a.download = 'wbs.svg'
        a.click()
        URL.revokeObjectURL(url)
      },
      autoFitAll: (padding = 40) => { cy.fit(undefined, padding) },
      fitToScreen: (padding = 40) => { cy.fit(undefined, padding) },
      undo: () => {
        if (undoStack.current.length < 2) return
        const current = undoStack.current.pop()!
        const target = undoStack.current.pop()!
        redoStack.current.push(current)
        redoStack.current.push(takeSnapshot(cy))
        applySnapshot(cy, target)
      },
      redo: () => {
        if (redoStack.current.length < 1) return
        const target = redoStack.current.pop()!
        undoStack.current.push(takeSnapshot(cy))
        applySnapshot(cy, target)
      }
    }

    onReady?.(api)

    return () => {
      cy.destroy()
      cyRef.current = null
      undoStack.current = []
      redoStack.current = []
      dragStartSnap.current = null
    }
  }, [
    elements,
    layoutMode,
    safeFont,
    safeBoxW,
    safeBoxH,
    safeTmwPx,
    showGrid,
    snapToGrid,
    safeGrid,
    onReady
  ])

  // live style updates
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().style({
      width: safeNum(boxWidth, 240),
      height: safeNum(boxHeight, 72),
      'font-size': clamp(safeNum(fontSize, 14), 8, 64),
      'text-max-width': toPx(textMaxWidth, 220)
    } as any)
    if (ADVANCED_EDGES) {
      cy.edges().style({
        'taxi-direction': layoutMode === 'vertical' ? 'downward' : 'horizontal'
      } as any)
    }
  }, [boxWidth, boxHeight, fontSize, textMaxWidth, layoutMode])

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      {title ? (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 16,
            zIndex: 2,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'rgba(255,255,255,0.85)',
            border: '1px solid #e5e7eb',
            fontWeight: 600
          }}
        >
          {title}
        </div>
      ) : null}
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  )
}
