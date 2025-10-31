import cytoscape from 'cytoscape'
import type { Core } from 'cytoscape'
import { useEffect, useRef } from 'react'
import type { WbsNode } from '../lib/parseOutline'

type Pos = { x: number; y: number }

// Build elements with level + path (path is also the element id)
function toElements(root: WbsNode) {
  const nodes: any[] = []
  const edges: any[] = []

  const visit = (n: WbsNode) => {
    for (const c of n.children || []) {
      nodes.push({ data: { id: c.id, label: c.label, level: c.level, path: c.id } })
      if (n.id !== 'root') {
        edges.push({ data: { id: `${n.id}-${c.id}`, source: n.id, target: c.id, level: c.level } })
      }
      visit(c)
    }
  }
  visit(root)
  return [...nodes, ...edges]
}

type DiagramApi = {
  downloadPNG: (opts?: { scale?: number; bg?: string; margin?: number }) => void
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
  textMaxWidth = 220
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const lastTapRef = useRef<{ id: string; at: number } | null>(null)

  useEffect(() => {
    if (!ref.current) return

    const usePreset = Object.keys(positions).length > 0

    const cy = cytoscape({
      container: ref.current,
      elements: toElements(root),
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
        // Level-based node pastels
        { selector: 'node[level = 0], node[level = 1]', style: { 'background-color': '#dbeafe', 'border-color': '#93c5fd' } },
        { selector: 'node[level = 2]', style: { 'background-color': '#dcfce7', 'border-color': '#86efac' } },
        { selector: 'node[level = 3]', style: { 'background-color': '#fef9c3', 'border-color': '#fde68a' } },
        { selector: 'node[level = 4]', style: { 'background-color': '#fee2e2', 'border-color': '#fca5a5' } },
        { selector: 'node[level >= 5]', style: { 'background-color': '#fef9c3', 'border-color': '#fde68a' } },
        // Edges (darker + thicker)
        { selector: 'edge', style: { 'curve-style': 'taxi', 'taxi-direction': 'downward', width: 2.5, 'line-opacity': 1 } },
        { selector: 'edge[level = 0], edge[level = 1]', style: { 'line-color': '#3b82f6' } },
        { selector: 'edge[level = 2]', style: { 'line-color': '#22c55e' } },
        { selector: 'edge[level = 3]', style: { 'line-color': '#eab308' } },
        { selector: 'edge[level = 4]', style: { 'line-color': '#ef4444' } },
        { selector: 'edge[level >= 5]', style: { 'line-color': '#eab308' } }
      ],
      layout: usePreset
        ? { name: 'preset', positions: (node: any) => positions[node.id()] }
        : {
            name: 'breadthfirst',
            directed: true,
            spacingFactor: 1.6,
            // Strict sibling order by numeric path ("1", "1.2", "1.10", …)
            sort: (a, b) => {
              const pa = String(a.data('path') || '')
              const pb = String(b.data('path') || '')
              return pa.localeCompare(pb, undefined, { numeric: true })
            }
          }
    })

    // Expose PNG export with margin
    if (onReady) {
      const api: DiagramApi = {
        downloadPNG: ({ scale = 2, bg = '#ffffff', margin = 80 } = {}) => {
          try {
            cy.resize()
            cy.fit(undefined, 40)

            // Tight PNG first
            const tight = cy.png({ full: true, scale, bg })

            // Then draw onto a larger canvas to add margins
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
              document.body.appendChild(a)
              a.click()
              a.remove()
            }
            img.src = tight
          } catch {}
        }
      }
      onReady(api)
    }

    // Drag → persist positions (void-returning forEach)
    cy.nodes().forEach((n) => { n.grabify() })
    const savePos = () => {
      if (!onPositionsChange) return
      const next: Record<string, Pos> = { ...positions }
      cy.nodes().forEach((n) => {
        const p = n.position()
        next[n.id()] = { x: p.x, y: p.y }
      })
      onPositionsChange(next)
    }
    cy.on('dragfree', 'node', savePos)

    if (!usePreset) {
      requestAnimationFrame(() => { try { cy.resize(); cy.fit(undefined, 40) } catch {} })
    }

    // Double-click to rename
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

    // Keep sized; don’t refit if using manual positions
    if ('ResizeObserver' in window && ref.current) {
      const ro = new ResizeObserver(() => {
        try {
          cy.resize()
          if (!usePreset) cy.fit(undefined, 40)
        } catch {}
      })
      ro.observe(ref.current)
      roRef.current = ro
    }

    cyRef.current = cy
    return () => {
      cy.off('dragfree', 'node', savePos)
      cy.off('tap', 'node', onTap)
      roRef.current?.disconnect()
      roRef.current = null
      cy.destroy()
      cyRef.current = null
    }
  }, [root])

  // Live style/size updates without rebuild
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

  return <div ref={ref} style={{ width: '100%', height: '100%', border: '1px solid #ddd' }} />
}
