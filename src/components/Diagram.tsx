import cytoscape from 'cytoscape'
import type { Core } from 'cytoscape'
import dagre from 'cytoscape-dagre'
import elk from 'cytoscape-elk'
import svg from 'cytoscape-svg'
import { useEffect, useRef } from 'react'
import type { WbsNode } from '../lib/parseOutline'

cytoscape.use(dagre as any)
cytoscape.use(elk as any)
cytoscape.use(svg as any)

type Pos = { x: number; y: number }

/** If parser wrapped the tree with a synthetic "root" that has exactly one child,
 *  return that child as the visual root. Otherwise return the original node. */
function getVisualRoot(node: WbsNode): WbsNode {
  const label = (node.label ?? '').trim().toLowerCase()
  if (label === 'root' && (node.children?.length ?? 0) === 1) {
    return node.children![0]
  }
  return node
}

function toElements(originalRoot: WbsNode) {
  const root = getVisualRoot(originalRoot)

  const nodes: any[] = []
  const edges: any[] = []

  const pushNode = (n: WbsNode) => {
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

  pushNode(root)

  const visit = (n: WbsNode) => {
    for (const c of n.children || []) {
      pushNode(c)
      const lvl = c.level ?? 0
      // control point distance: gentle curve that increases with depth
      const cpd = 60 + lvl * 30
      edges.push({
        data: {
          id: `${n.id}-${c.id}`,
          source: n.id,
          target: c.id,
          level: lvl,
          cpd
        }
      })
      visit(c)
    }
  }
  visit(root)

  return {
    elements: [...nodes, ...edges],
    nodeIds: nodes.map(n => n.data.id),
    layoutRootId: root.id
  }
}

type DiagramApi = {
  downloadPNG: (opts?: { scale?: number; bg?: string; margin?: number }) => void
  downloadSVG: (opts?: { bg?: string; margin?: number }) => void
}

export type LayoutMode = 'horizontal' | 'vertical' | 'mindmap'

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
  layoutMode = 'horizontal'
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const lastTapRef = useRef<{ id: string; at: number } | null>(null)

  const hardCenter = (cy: Core, padding = 60) => {
    try {
      const bb = cy.elements().boundingBox()
      const w = cy.width()
      const h = cy.height()
      if (!w || !h || !isFinite(bb.w) || !isFinite(bb.h) || bb.w === 0 || bb.h === 0) return
      const zoom = Math.max(0.02, Math.min(w / (bb.w + padding * 2), h / (bb.h + padding * 2)))
      const cx = bb.x1 + bb.w / 2
      const cyy = bb.y1 + bb.h / 2
      cy.zoom(zoom)
      cy.pan({ x: w / 2 - cx * zoom, y: h / 2 - cyy * zoom })
    } catch {}
  }

  const makeLayout = (cy: Core, canUsePreset: boolean, layoutRootId: string) => {
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
          'elk.layered.spacing.nodeNodeBetweenLayers': 120,
          'elk.spacing.nodeNode': 60,
          'elk.edgeRouting': 'ORTHOGONAL',
          'elk.layered.wrapping.strategy': 'SINGLE_EDGE',
          'elk.layered.mergeEdges': true
        }
      } as any)
    }

    if (layoutMode === 'mindmap') {
      // Stable radial layout (root-centered)
      return cy.layout({
        name: 'breadthfirst',
        directed: true,
        roots: `#${layoutRootId}`,
        circle: true,
        spacingFactor: 1.6,
        avoidOverlap: true,
        animate: false
      } as any)
    }

    // Horizontal (org-chart like)
    return cy.layout({
      name: 'dagre',
      rankDir: 'LR',
      nodeSep: 60,
      rankSep: 120
    } as any)
  }

  useEffect(() => {
    if (!ref.current) return

    const { elements, nodeIds, layoutRootId } = toElements(root)
    const hasAllPositions =
      nodeIds.length > 0 &&
      nodeIds.every(id => positions[id] && Number.isFinite(positions[id].x) && Number.isFinite(positions[id].y))

    const usePreset = hasAllPositions && layoutMode !== 'mindmap'

    const cy = cytoscape({
      container: ref.current,
      elements,
      style: [
        // Base nodes
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

        // Mindmap pills (compact & proportional)
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

        // Node colors by level
        { selector: 'node[level = 0]', style: { 'background-color': '#c7d2fe', 'border-color': '#93c5fd' } },
        { selector: 'node[level = 1]', style: { 'background-color': '#dbeafe', 'border-color': '#93c5fd' } },
        { selector: 'node[level = 2]', style: { 'background-color': '#dcfce7', 'border-color': '#86efac' } },
        { selector: 'node[level = 3]', style: { 'background-color': '#fef9c3', 'border-color': '#fde68a' } },
        { selector: 'node[level = 4]', style: { 'background-color': '#fee2e2', 'border-color': '#fca5a5' } },
        { selector: 'node[level >= 5]', style: { 'background-color': '#fef9c3', 'border-color': '#fde68a' } },

        // Base edge styling
        { selector: 'edge', style: { width: 2.5, 'line-opacity': 1, 'line-color': '#94a3b8', 'curve-style': 'bezier' } },

        // Mindmap: smooth organic curves using per-edge control points
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

        // Vertical: orthogonal connectors
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

    const run = () => {
      const layout = makeLayout(cy, usePreset, layoutRootId)
      if (layoutMode === 'mindmap') { try { cy.reset() } catch {} }
      cy.one('layoutstop', fitAll)
      layout.run()
      setTimeout(fitAll, 50)
      setTimeout(fitAll, 200)
      setTimeout(fitAll, 400)
    }

    cy.ready(run)

    // Double-click rename
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

    // Export API
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
              a.href = out
              a.download = 'wbs.png'
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
              ;[vbX, vbY, vbW, vbH] = parts
              w = vbW; h = vbH
            } else if (widthAttr && heightAttr) {
              w = parseFloat(widthAttr); h = parseFloat(heightAttr)
              svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`)
              vbW = w; vbH = h
            }

            const newW = w + margin * 2
            const newH = h + margin * 2
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
            a.href = url
            a.download = 'wbs.svg'
            document.body.appendChild(a); a.click(); a.remove()
            URL.revokeObjectURL(url)
          } catch {}
        }
      }
      onReady(api)
    }

    // Drag → persist positions
    cy.nodes().forEach(n => { n.grabify() })
    const savePos = () => {
      if (!onPositionsChange) return
      const next: Record<string, Pos> = {}
      cy.nodes().forEach(n => { const p = n.position(); next[n.id()] = { x: p.x, y: p.y } })
      onPositionsChange(next)
    }
    cy.on('dragfree', 'node', savePos)

    // Fit/center on container resize
    if ('ResizeObserver' in window && ref.current) {
      const ro = new ResizeObserver(() => {
        try { cy.resize(); hardCenter(cy, 60) } catch {}
      })
      ro.observe(ref.current)
      roRef.current = ro
    }

    cyRef.current = cy
    return () => {
      cy.off('dragfree', 'node', savePos)
      cy.off('tap', 'node', onTap)
      roRef.current?.disconnect(); roRef.current = null
      cy.destroy(); cyRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, layoutMode])

  // Re-run layout when the mode changes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    const vis = getVisualRoot(root)
    const layout = makeLayout(cy, layoutMode !== 'mindmap' && false, vis.id)
    if (layoutMode === 'mindmap') { try { cy.reset() } catch {} }
    cy.one('layoutstop', () => { try { cy.resize(); hardCenter(cy, 60) } catch {} })
    layout.run()
    setTimeout(() => { try { cy.resize(); hardCenter(cy, 60) } catch {} }, 50)
    setTimeout(() => { try { cy.resize(); hardCenter(cy, 60) } catch {} }, 200)
    setTimeout(() => { try { cy.resize(); hardCenter(cy, 60) } catch {} }, 400)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutMode])

  // Live style updates
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.style()
      .selector('node').style({
        'text-max-width': `${textMaxWidth}px`,
        'font-size': fontSize,
        width: boxWidth,
        height: boxHeight
      })
      .update()
  }, [fontSize, boxWidth, boxHeight, textMaxWidth])

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
