import { useMemo, useState, useEffect } from 'react'
import Diagram, { type LayoutMode, type DiagramApi } from './components/Diagram'
import { parseOutline, type WbsNode } from './lib/parseOutline'
import { importOutlineFromFile } from './lib/importers'

/** Sample */
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
    Closing
`

export default function App() {
  // LEFT INPUT
  const [inputText, setInputText] = useState<string>(SAMPLE)
  const [error, setError] = useState<string | null>(null)

  // TREE
  const [tree, setTree] = useState<WbsNode>(() => parseOutline(SAMPLE))

  // TITLE
  const [title, setTitle] = useState<string>('Work Breakdown Structure')

  // LAYOUT & STYLE CONTROLS
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('horizontal')
  const [fontSize, setFontSize] = useState<number>(14)
  const [boxWidth, setBoxWidth] = useState<number>(240)
  const [boxHeight, setBoxHeight] = useState<number>(72)
  const [textMaxWidth, setTextMaxWidth] = useState<number>(220)

  // GRID
  const [showGrid, setShowGrid] = useState<boolean>(true)
  const [snapToGrid, setSnapToGrid] = useState<boolean>(true)
  const [gridSize, setGridSize] = useState<number>(10)

  // Diagram API
  const [diagramApi, setDiagramApi] = useState<DiagramApi | null>(null)

  const onGenerate = () => {
    try {
      const t = parseOutline(inputText)
      setTree(t)
      // Auto-title from root label
      const auto = (t.label || 'Work Breakdown Structure').trim()
      setTitle(auto)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to parse outline')
    }
  }

  const onImportClick = async () => {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.xlsx,.xls,.csv,.tsv,.txt'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const text = await importOutlineFromFile(file)
        setInputText(text)
        const t = parseOutline(text)
        setTree(t)
        // Auto-title on import too
        const auto = (t.label || 'Work Breakdown Structure').trim()
        setTitle(auto)
        setError(null)
      }
      input.click()
    } catch (e: any) {
      setError(e?.message || 'Failed to import file')
    }
  }

  const handleRename = (id: string, newLabel: string) => {
    setTree(prev => {
      const rename = (n: WbsNode): WbsNode =>
        n.id === id ? { ...n, label: newLabel } : { ...n, children: (n.children || []).map(rename) }
      return rename(prev)
    })
  }

  // Keyboard shortcuts: Undo / Redo, routed to Diagram
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!diagramApi) return
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return
      // Undo: Cmd/Ctrl+Z (no Shift)
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        diagramApi.undo?.()
      }
      // Redo: Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y
      if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
        e.preventDefault()
        diagramApi.redo?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [diagramApi])

  const renderKey = useMemo(() => `${layoutMode}`, [layoutMode])

  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        gap: 12,
        padding: 12,
        background: 'var(--bg)',
        overflow: 'hidden'
      }}
    >
      {/* Left column: input card */}
      <div style={{ width: 420, minWidth: 340, maxWidth: 520, height: '100%' }}>
        <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 12, gap: 12 }}>
          <div style={{ fontWeight: 600 }}>Project Outline</div>

          <div className="label">Paste an indented outline OR a 2-column (WBS, Name) table:</div>
          <textarea
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={`e.g.\nProject\n  Planning\n    Task A\n    Task B\n\nor CSV/TSV/Excel with columns:\nWBS\tName\n1\tRoot\n1.1\tChild\n1.1.1\tLeaf`}
            style={{
              width: '100%',
              flex: 1,
              minHeight: 280,
              resize: 'none',
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border)',
              lineHeight: 1.4
            }}
          />

          {error && (
            <div style={{ color: '#b91c1c', fontSize: 13 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={onGenerate}>Generate</button>
            <button onClick={onImportClick}>Import Excel/CSV/TSV</button>
          </div>

          <div className="label" style={{ marginTop: 4 }}>
            Tips: Double-click = auto-fit width. Alt+Double-click = rename. Shift+Double-click = reset width.
          </div>
          <div className="label">
            Collapse/expand with chevron (+/−) or Cmd/Ctrl+Double-click.  
            Undo/Redo: Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z.  
            Move selected with Arrow keys (Shift for 10×).
          </div>
        </div>
      </div>

      {/* Right side */}
      <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {/* Toolbar */}
        <div className="panel" style={{ padding: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Title */}
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Title:&nbsp;
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ padding: 6, borderRadius: 8, border: '1px solid var(--border)', minWidth: 240 }}
              placeholder="Work Breakdown Structure"
            />
          </label>

          {/* Layout */}
          <label className="label">
            Layout:&nbsp;
            <select
              value={layoutMode}
              onChange={e => setLayoutMode(e.target.value as LayoutMode)}
            >
              <option value="horizontal">Horizontal (Left→Right)</option>
              <option value="vertical">Vertical (Top→Down)</option>
              <option value="mindmap">Mind map (Radial)</option>
            </select>
          </label>

          {/* Font size */}
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Font:&nbsp;{fontSize}px
            <input
              type="range"
              min={10}
              max={48}
              step={1}
              value={fontSize}
              onChange={e => setFontSize(parseInt(e.target.value))}
            />
          </label>

          {/* Box width */}
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Box W:&nbsp;{boxWidth}px
            <input
              type="range"
              min={140}
              max={420}
              step={10}
              value={boxWidth}
              onChange={e => setBoxWidth(parseInt(e.target.value))}
            />
          </label>

          {/* Box height */}
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Box H:&nbsp;{boxHeight}px
            <input
              type="range"
              min={44}
              max={180}
              step={4}
              value={boxHeight}
              onChange={e => setBoxHeight(parseInt(e.target.value))}
            />
          </label>

          {/* Text wrap width */}
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Wrap:&nbsp;{textMaxWidth}px
            <input
              type="range"
              min={120}
              max={400}
              step={10}
              value={textMaxWidth}
              onChange={e => setTextMaxWidth(parseInt(e.target.value))}
            />
          </label>

          {/* Grid */}
          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={showGrid}
              onChange={e => setShowGrid(e.target.checked)}
            />
            Show grid
          </label>

          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={snapToGrid}
              onChange={e => setSnapToGrid(e.target.checked)}
            />
            Snap to grid
          </label>

          <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Grid:&nbsp;{gridSize}px
            <input
              type="range"
              min={5}
              max={40}
              step={1}
              value={gridSize}
              onChange={e => setGridSize(parseInt(e.target.value))}
            />
          </label>

          {/* Actions right side */}
          <div style={{ flex: 1 }} />
          <button onClick={() => diagramApi?.autoFitAll?.()}>Auto-fit all</button>
          <button onClick={() => diagramApi?.fitToScreen()}>Fit</button>
          <button onClick={() => diagramApi?.downloadPNG({ scale: 2, bg: '#ffffff', margin: 120 })}>PNG</button>
          <button onClick={() => diagramApi?.downloadSVG({ margin: 120 /* transparent */ })}>SVG</button>
          <button onClick={() => diagramApi?.undo?.()}>Undo</button>
          <button onClick={() => diagramApi?.redo?.()}>Redo</button>
        </div>

        {/* Diagram card */}
        <div className="panel" style={{ flex: 1, padding: 10, minHeight: 0 }}>
          <div style={{ width: '100%', height: '100%' }}>
            <Diagram
              key={renderKey}
              title={title}
              root={tree}
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
    </div>
  )
}
