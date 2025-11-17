// src/App.tsx
import { useMemo, useRef, useState } from 'react'
import Diagram, { type LayoutMode, type DiagramApi } from './components/Diagram'
import { parseOutline, type WbsNode } from './lib/parseOutline'
import { importOutlineFromFile } from './lib/importers' // (file: File) => Promise<string>

const SAMPLE = `Project
  Initiation
    Develop charter
    Kickoff
  Planning
    Define scope
    Identify stakeholders
  Monitoring
    Status meetings
      Meeting 1
    Weekly reports
      Report 1
  Execution
    Build feature A
    Build feature B
    Build Feature C
  Closeout
    Lessons learned 
    Closing`

type Pos = { x: number; y: number }

// Card helper
const cardBox: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 16,
  background: '#fff',
  boxShadow: '0 10px 30px rgba(0,0,0,0.06)'
}

const btn: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 10,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  cursor: 'pointer',
  fontSize: 12
}

export default function App() {
  const [text, setText] = useState<string>(SAMPLE)
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('horizontal')
  const [fontSize, setFontSize] = useState(14)
  const [boxWidth, setBoxWidth] = useState(300)
  const [boxHeight, setBoxHeight] = useState(90)
  const [textMaxWidth, setTextMaxWidth] = useState(280)
  const [showGrid, setShowGrid] = useState(true)
  const [gridSize, setGridSize] = useState(10)
  const [snapToGrid, setSnapToGrid] = useState(true)
  const [title, setTitle] = useState('')

  const [positions, setPositions] = useState<Record<string, Pos>>({})
  const apiRef = useRef<DiagramApi | null>(null)

  const root: WbsNode = useMemo(() => parseOutline(text), [text])

  const handleReady = (api: DiagramApi) => {
    apiRef.current = api
  }

  // Actions
  const doFit = () => apiRef.current?.fitToScreen()
  const doAutoFitAll = () => apiRef.current?.autoFitAll?.()
  const doUndo = () => apiRef.current?.undo?.()
  const doRedo = () => apiRef.current?.redo?.()

  const savePNG = () => apiRef.current?.downloadPNG({ scale: 2, bg: '#ffffff', margin: 80 })
  const saveSVG = () => apiRef.current?.downloadSVG({ margin: 80 })
  const saveJSON = () => {
    const json = apiRef.current?.exportJSON()
    if (!json) return
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'wbs.json'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }
  const printPDF = () => apiRef.current?.print({ bg: '#ffffff', margin: 80 })

  // local file picker
  const pickFile = () =>
    new Promise<File | null>((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.csv,.tsv,.xlsx,.json,.txt'
      input.onchange = () => resolve(input.files?.[0] ?? null)
      input.click()
    })

  const importOutline = async () => {
    const file = await pickFile()
    if (!file) return
    const ext = (file.name.split('.').pop() || '').toLowerCase()

    if (ext === 'json') {
      const json = await file.text()
      apiRef.current?.importJSON(json)
      return
    }

    const outlineText = await importOutlineFromFile(file)
    if (outlineText && outlineText.trim()) setText(outlineText)
  }

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'grid',
        gridTemplateColumns: 'minmax(320px, 520px) 1fr',
        gridTemplateRows: 'auto 1fr',
        gap: 0,
        background: '#f3f6fb'
      }}
    >
      {/* Toolbar CARD (wraps if narrow) */}
      <div
        style={{
          gridColumn: '1 / -1',
          position: 'sticky',
          top: 0,
          zIndex: 100,
          padding: 12,
          background: 'transparent'
        }}
      >
        <div
          style={{
            ...cardBox,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            rowGap: 10
          }}
        >
          {/* Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              Title:&nbsp;
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Diagram title"
                style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 10, width: 220 }}
              />
            </label>
          </div>

          {/* Layout */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 12 }}>
              Layout:&nbsp;
              <select
                value={layoutMode}
                onChange={(e) => setLayoutMode(e.target.value as LayoutMode)}
                style={{ padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 10 }}
              >
                <option value="horizontal">Horizontal</option>
                <option value="vertical">Vertical</option>
                <option value="mindmap">Mind map</option>
              </select>
            </label>
          </div>

          {/* Sliders */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              Font:&nbsp;
              <input
                type="range"
                min={10}
                max={48}
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
              />
              &nbsp;{fontSize}px
            </label>
            <label style={{ fontSize: 12 }}>
              Width:&nbsp;
              <input
                type="range"
                min={140}
                max={720}
                value={boxWidth}
                onChange={(e) => setBoxWidth(parseInt(e.target.value))}
              />
              &nbsp;{boxWidth}px
            </label>
            <label style={{ fontSize: 12 }}>
              Height:&nbsp;
              <input
                type="range"
                min={40}
                max={180}
                value={boxHeight}
                onChange={(e) => setBoxHeight(parseInt(e.target.value))}
              />
              &nbsp;{boxHeight}px
            </label>
            <label style={{ fontSize: 12 }}>
              Wrap:&nbsp;
              <input
                type="range"
                min={120}
                max={720}
                value={textMaxWidth}
                onChange={(e) => setTextMaxWidth(parseInt(e.target.value))}
              />
              &nbsp;{textMaxWidth}px
            </label>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={doFit} style={btn}>Fit</button>
            <button onClick={doAutoFitAll} style={btn}>Auto-fit text</button>
            <button onClick={doUndo} style={btn}>Undo</button>
            <button onClick={doRedo} style={btn}>Redo</button>
          </div>

          {/* Export */}
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <details style={{ position: 'relative' }}>
              <summary style={{ ...btn, listStyle: 'none', cursor: 'pointer' }}>▼ Export</summary>
              <div
                style={{
                  position: 'absolute',
                  top: '110%',
                  right: 0,
                  left: 'auto',
                  display: 'flex',
                  gap: 6,
                  padding: 8,
                  border: '1px solid #e5e7eb',
                  borderRadius: 10,
                  background: '#fff',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
                  zIndex: 120,
                  whiteSpace: 'nowrap',
                  maxWidth: 'calc(100vw - 24px)',  // <-- never exceed viewport
                  flexWrap: 'wrap'
                }}
              >
                <button onClick={savePNG} style={btn}>PNG</button>
                <button onClick={saveSVG} style={btn}>SVG</button>
                <button onClick={saveJSON} style={btn}>JSON</button>
                <button onClick={printPDF} style={btn}>Print / PDF</button>
              </div>
            </details>
          </div>

          {/* Grid/Snap + Import */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />{' '}
              Grid
            </label>
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={snapToGrid}
                onChange={(e) => setSnapToGrid(e.target.checked)}
              />{' '}
              Snap
            </label>
            <label style={{ fontSize: 12 }}>
              Grid:&nbsp;
              <input
                type="number"
                min={4}
                max={40}
                value={gridSize}
                onChange={(e) => setGridSize(parseInt(e.target.value || '10', 10))}
                style={{ width: 60, padding: '6px 8px', border: '1px solid #e5e7eb', borderRadius: 10 }}
              />
              &nbsp;px
            </label>

            <button
              onClick={importOutline}
              style={{ ...btn, background: '#f1f5f9', border: '1px solid #e5e7eb' }}
              title="Import CSV / TSV / XLSX / JSON"
            >
              Import CSV/TSV/XLSX/JSON
            </button>
          </div>
        </div>
      </div>

      {/* Left pane (card) */}
      <div style={{ borderRight: '1px solid #e5e7eb', overflow: 'auto', background: '#f3f6fb' }}>
        <div style={{ padding: 16 }}>
          <div style={{ ...cardBox, padding: 12 }}>
            <p style={{ fontSize: 12, color: '#475569', margin: '6px 0 8px' }}>
              Paste a WBS outline here (indented or two-column WBS).
              <span style={{ color: '#64748b' }}> Double-click a box in the diagram to auto-fit text.</span>
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                height: 'calc(100vh - 190px)',
                resize: 'none',
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                fontSize: 13,
                lineHeight: 1.5,
                border: '1px solid #e5e7eb',
                borderRadius: 10,
                padding: 12
              }}
            />
          </div>
        </div>
      </div>

      {/* Right pane: DIAGRAM CARD */}
      <div style={{ padding: 16, background: '#f3f6fb' }}>
        <div
          style={{
            ...cardBox,
            position: 'relative',
            height: '100%',
            width: '100%',
            overflow: 'hidden' // keep canvas clipped to rounded corners
          }}
        >
          <Diagram
            key={layoutMode}
            root={root}
            title={title}
            initialPositions={positions}
            onPositionsChange={setPositions}
            onReady={handleReady}
            fontSize={fontSize}
            boxWidth={boxWidth}
            boxHeight={boxHeight}
            textMaxWidth={textMaxWidth}
            layoutMode={layoutMode}
            showGrid={showGrid}
            gridSize={gridSize}
            snapToGrid={snapToGrid}
            onRename={() => {}}
          />
        </div>
      </div>
    </div>
  )
}
