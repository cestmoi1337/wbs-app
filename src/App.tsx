import { useEffect, useMemo, useRef, useState } from 'react'
import Diagram, { type LayoutMode } from './components/Diagram'
import { parseOutline, type WbsNode } from './lib/parseOutline'
import { importOutlineFromFile } from './lib/importers' // ← named import

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

export default function App() {
  const [text, setText] = useState<string>(SAMPLE)

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('horizontal')
  const [fontSize, setFontSize] = useState<number>(14)
  const [boxWidth, setBoxWidth] = useState<number>(240)
  const [boxHeight, setBoxHeight] = useState<number>(80)
  const [textMaxWidth, setTextMaxWidth] = useState<number>(220)

  // Grid defaults ON, 10px
  const [showGrid, setShowGrid] = useState<boolean>(true)
  const [gridSize, setGridSize] = useState<number>(10)
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true)

  // Persisted positions
  const [positions, setPositions] = useState<Record<string, Pos>>(() => {
    try { return JSON.parse(localStorage.getItem('wbs-positions') || '{}') } catch { return {} }
  })
  useEffect(() => { localStorage.setItem('wbs-positions', JSON.stringify(positions)) }, [positions])

  // Force-remount when we want a fresh layout
  const [diagramKey, setDiagramKey] = useState<number>(0)
  const remountDiagram = () => setDiagramKey(k => k + 1)

  const tree: WbsNode = useMemo(() => parseOutline(text), [text])

  const [diagramApi, setDiagramApi] = useState<{
    downloadPNG: (o?: { scale?: number; bg?: string; margin?: number }) => void
    downloadSVG: (o?: { bg?: string; margin?: number }) => void
    fitToScreen: () => void
  } | null>(null)

  // Rename handler
  const handleRename = (id: string, newLabel: string) => {
    const lines: string[] = []
    const walk = (n: WbsNode, depth = 0) => {
      const label = n.id === id ? newLabel : (n.label ?? '')
      lines.push(`${'  '.repeat(depth)}${label}`)
      for (const c of n.children || []) walk(c, depth + 1)
    }
    walk(tree, 0)
    setText(lines.join('\n'))
  }

  // Reset positions (clear drags)
  const resetPositions = () => {
    setPositions({})
    localStorage.removeItem('wbs-positions')
    remountDiagram()
    setTimeout(() => diagramApi?.fitToScreen(), 80)
  }

  // Import Excel/CSV
  const fileRef = useRef<HTMLInputElement>(null)
  const onChooseFile = () => fileRef.current?.click()
  const onFilePicked: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const outline = await importOutlineFromFile(f)
      if (outline && outline.trim()) {
        setText(outline)
        setPositions({})
        localStorage.removeItem('wbs-positions')
        remountDiagram()
        setTimeout(() => diagramApi?.fitToScreen(), 80)
      } else {
        alert('Could not parse that file into an outline.')
      }
    } catch (err) {
      console.error(err)
      alert('Import failed. Please ensure the file has the expected columns or outline.')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', overflow: 'hidden', fontFamily: 'Inter, system-ui, Arial, sans-serif' }}>
      {/* Left: input */}
      <div style={{ width: 380, borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #f1f5f9' }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Project Outline</h2>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6b7280' }}>
            Paste an indented outline (spaces denote levels) or import a CSV/Excel file.
          </p>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          style={{
            flex: 1,
            resize: 'none',
            border: 'none',
            outline: 'none',
            padding: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 13,
            lineHeight: 1.4
          }}
        />
        <div style={{ padding: 12, borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onChooseFile}>Import Excel/CSV</button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={onFilePicked}
            style={{ display: 'none' }}
          />
          <button onClick={resetPositions}>Reset positions</button>
        </div>
      </div>

      {/* Right: diagram + toolbar */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Toolbar */}
        <div
          style={{
            padding: 10,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
            borderBottom: '1px solid #e5e7eb',
            flexWrap: 'wrap'
          }}
        >
          <label style={{ fontSize: 12 }}>
            Layout:&nbsp;
            <select value={layoutMode} onChange={e => setLayoutMode(e.target.value as LayoutMode)}>
              <option value="horizontal">Horizontal (LR)</option>
              <option value="vertical">Vertical (Top→Down)</option>
              <option value="mindmap">Mindmap — Radial</option>
            </select>
          </label>

          <label style={{ fontSize: 12 }}>
            Font:&nbsp;
            <input type="range" min={10} max={48} value={fontSize} onChange={e => setFontSize(parseInt(e.target.value, 10))} />
            &nbsp;{fontSize}px
          </label>

          <label style={{ fontSize: 12 }}>
            Box W:&nbsp;
            <input type="range" min={120} max={420} value={boxWidth} onChange={e => setBoxWidth(parseInt(e.target.value, 10))} />
            &nbsp;{boxWidth}px
          </label>

          <label style={{ fontSize: 12 }}>
            Box H:&nbsp;
            <input type="range" min={48} max={220} value={boxHeight} onChange={e => setBoxHeight(parseInt(e.target.value, 10))} />
            &nbsp;{boxHeight}px
          </label>

          <label style={{ fontSize: 12 }}>
            Text wrap:&nbsp;
            <input type="range" min={120} max={360} value={textMaxWidth} onChange={e => setTextMaxWidth(parseInt(e.target.value, 10))} />
            &nbsp;{textMaxWidth}px
          </label>

          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} />
            Show grid
          </label>

          <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={snapToGrid} onChange={e => setSnapToGrid(e.target.checked)} />
            Snap to grid
          </label>

          <label style={{ fontSize: 12 }}>
            Grid:&nbsp;
            <input type="range" min={8} max={64} value={gridSize} onChange={e => setGridSize(parseInt(e.target.value, 10))} />
            &nbsp;{gridSize}px
          </label>

          <button onClick={() => diagramApi?.downloadPNG({ scale: 2, bg: '#ffffff', margin: 80 })}>
            Download PNG
          </button>
          <button onClick={() => diagramApi?.downloadSVG({ margin: 80 })}>
            Download SVG
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <Diagram
            key={diagramKey}
            root={tree}
            positions={positions}
            onPositionsChange={setPositions}
            onRename={handleRename}
            onReady={setDiagramApi}
            fontSize={fontSize}
            boxWidth={boxWidth}
            boxHeight={boxHeight}
            textMaxWidth={textMaxWidth}
            layoutMode={layoutMode}
            showGrid={showGrid}
            gridSize={gridSize}
            snapToGrid={snapToGrid}
          />
        </div>
      </div>
    </div>
  )
}
