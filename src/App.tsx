import { useMemo, useState } from 'react'
import Diagram, { type LayoutMode } from './components/Diagram'
import { parseOutline, type WbsNode } from './lib/parseOutline'
import { importOutlineFromFile } from './lib/importers'

/** Latest sample requested */
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

type Pos = { x: number; y: number }

function renameNode(root: WbsNode, id: string, newLabel: string): WbsNode {
  if (root.id === id) return { ...root, label: newLabel }
  const children = root.children?.map(c => renameNode(c, id, newLabel)) ?? []
  return { ...root, children }
}

export default function App() {
  // LEFT INPUT
  const [inputText, setInputText] = useState<string>(SAMPLE)
  const [error, setError] = useState<string | null>(null)

  // TREE
  const [tree, setTree] = useState<WbsNode>(() => parseOutline(SAMPLE))
  // we only need the setter right now (kept for future “Manual” layout mode)
  const [, setPositions] = useState<Record<string, Pos>>({})

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

  // Diagram API for export
  const [diagramApi, setDiagramApi] = useState<{
    downloadPNG: (o?: { scale?: number; bg?: string; margin?: number }) => void
    downloadSVG: (o?: { bg?: string; margin?: number }) => void
    fitToScreen: () => void
  } | null>(null)

  // Re-parse when input changes via Generate
  const onGenerate = () => {
    try {
      const t = parseOutline(inputText)
      setTree(t)
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to parse outline')
    }
  }

  // Import CSV/TSV/TXT via file picker
  const onImportClick = async () => {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.csv,.tsv,.txt'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file) return
        const text = await importOutlineFromFile(file)
        setInputText(text)
        // auto-generate right after import
        const t = parseOutline(text)
        setTree(t)
        setError(null)
      }
      input.click()
    } catch (e: any) {
      setError(e?.message || 'Failed to import file')
    }
  }

  // Rename handler from Diagram
  const handleRename = (id: string, newLabel: string) => {
    setTree(prev => renameNode(prev, id, newLabel))
  }

  // Remount Diagram on mode switch to run a fresh layout
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
            placeholder={`e.g.\nProject\n  Planning\n    Task A\n    Task B\n\nor CSV/TSV with columns:\nWBS\tName\n1\tRoot\n1.1\tChild\n1.1.1\tLeaf`}
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
            <button onClick={onImportClick}>Import CSV/TSV</button>
          </div>

          <div className="label" style={{ marginTop: 4 }}>
            Tip: Double-click a node to rename. Drag a parent to move its entire subtree.
          </div>
        </div>
      </div>

      {/* Right: toolbar card + diagram card */}
      <div style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        {/* Toolbar */}
        <div className="panel" style={{ padding: 10, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
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
          <button onClick={() => diagramApi?.fitToScreen()}>Fit</button>
          <button onClick={() => diagramApi?.downloadPNG({ scale: 2, bg: '#ffffff', margin: 120 })}>PNG</button>
          <button onClick={() => diagramApi?.downloadSVG({ margin: 120 /* bg omitted = transparent */ })}>SVG</button>
        </div>

        {/* Diagram card */}
        <div className="panel" style={{ flex: 1, padding: 10, minHeight: 0 }}>
          <div style={{ width: '100%', height: '100%' }}>
            <Diagram
              key={renderKey}
              root={tree}
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
    </div>
  )
}
