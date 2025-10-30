import { useState } from 'react'
import { parseOutline, type WbsNode } from './lib/parseOutline'
import { toOutline, renameNode, makeFirstLineRoot } from './lib/wbs'
import Diagram from './components/Diagram'

const SAMPLE = `Project
  Planning
    Define scope
    Identify stakeholders
  Monitoring
    Meeting
    Meeting
  Execution
    Build feature A
    Build feature B
    Build feature C
  Closeout
    Handover
    Retrospective
    Test`

type Pos = { x: number; y: number }
type DiagramApi = { downloadPNG: (opts?: { scale?: number; bg?: string }) => void }

export default function App() {
  const [text, setText] = useState<string>(SAMPLE)
  const [root, setRoot] = useState<WbsNode>(() => parseOutline(SAMPLE))

  // diagram controls
  const [fontSize, setFontSize] = useState(12)
  const [boxWidth, setBoxWidth] = useState(240)
  const [boxHeight, setBoxHeight] = useState(72)

  // manual node positions
  const [positions, setPositions] = useState<Record<string, Pos>>({})

  // Diagram API handle for export
  const [diagramApi, setDiagramApi] = useState<DiagramApi | null>(null)

  // ---- paste normalizer (HTML lists -> indented text) ----
  function htmlListToOutline(html: string): string | null {
    if (!html || !/<(ul|ol|li|br)/i.test(html)) return null
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const listRoots: HTMLElement[] = Array.from(doc.body.querySelectorAll('ul,ol'))
    if (listRoots.length === 0) {
      const temp = doc.body.cloneNode(true) as HTMLElement
      temp.querySelectorAll('br').forEach((br) => (br.outerHTML = '\n'))
      const raw = temp.textContent || ''
      return raw.replace(/\u00A0/g, ' ').replace(/\r\n/g, '\n').trim()
    }
    const rootList = listRoots[0]
    const lines: string[] = []
    const walk = (list: Element, depth: number) => {
      const items = Array.from(list.children).filter((el) => el.tagName.toLowerCase() === 'li') as HTMLElement[]
      items.forEach((li) => {
        const liCopy = li.cloneNode(true) as HTMLElement
        liCopy.querySelectorAll('ul,ol').forEach((n) => n.remove())
        liCopy.querySelectorAll('br').forEach((br) => (br.outerHTML = '\n'))
        const lineText = (liCopy.textContent || '').replace(/\u00A0/g, ' ').trim()
        const split = lineText.split(/\n+/).map((s) => s.trim()).filter(Boolean)
        for (const s of split) lines.push(`${'  '.repeat(depth)}${s}`)
        Array.from(li.children)
          .filter((el) => /^(ul|ol)$/i.test(el.tagName))
          .forEach((childList) => walk(childList, depth + 1))
      })
    }
    walk(rootList, 0)
    return lines.join('\n')
  }

  const onTextChange = (val: string) => {
    setText(val)
    setRoot(parseOutline(val))
  }

  const onTextPaste: React.ClipboardEventHandler<HTMLTextAreaElement> = (e) => {
    const html = e.clipboardData.getData('text/html')
    const plain = e.clipboardData.getData('text/plain')
    const converted = htmlListToOutline(html)
    const toInsert = (converted ?? plain)
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, '  ')
      .trimEnd()
    if (!converted && plain) return
    e.preventDefault()
    const target = e.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    const newText = text.slice(0, start) + toInsert + text.slice(end)
    setText(newText)
    setRoot(parseOutline(newText))
    requestAnimationFrame(() => {
      const caret = start + toInsert.length
      target.selectionStart = caret
      target.selectionEnd = caret
    })
  }

  // Tab / Shift+Tab indent/outdent
  const onTextKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const target = e.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    const value = target.value
    const selected = value.slice(start, end)
    const isMulti = selected.includes('\n')
    const INDENT = '  '
    const apply = (t: string, s: number, ed: number) => {
      setText(t); setRoot(parseOutline(t))
      requestAnimationFrame(() => { target.selectionStart = s; target.selectionEnd = ed })
    }
    if (!e.shiftKey) {
      if (isMulti) {
        const lines = value.slice(start, end).split('\n').map(l => INDENT + l)
        const nv = value.slice(0, start) + lines.join('\n') + value.slice(end)
        apply(nv, start, end + INDENT.length * lines.length)
      } else {
        const nv = value.slice(0, start) + INDENT + value.slice(start)
        apply(nv, start + INDENT.length, start + INDENT.length)
      }
    } else {
      if (isMulti) {
        const chunk = value.slice(start, end)
        let removed = 0
        const out = chunk.split('\n').map(l => {
          if (l.startsWith(INDENT)) { removed += INDENT.length; return l.slice(INDENT.length) }
          return l
        }).join('\n')
        const nv = value.slice(0, start) + out + value.slice(end)
        apply(nv, start, end - removed)
      } else {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1
        let nv = value, rem = 0
        if (value.slice(lineStart).startsWith(INDENT)) {
          nv = value.slice(0, lineStart) + value.slice(lineStart + INDENT.length)
          rem = INDENT.length
        }
        const caret = Math.max(start - rem, lineStart)
        apply(nv, caret, caret)
      }
    }
  }

  const handleRename = (id: string, newLabel: string) => {
    const updated = renameNode(root, id, newLabel)
    setRoot(updated)
    setText(toOutline(updated))
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>WBS Builder (MVP)</h1>
      <p>Left: edit/paste your outline (Tab/Shift+Tab). Right: diagram. Drag boxes to arrange.</p>

      {/* Controls */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          border: '1px solid #eee',
          padding: 12,
          borderRadius: 8,
          marginBottom: 12,
          flexWrap: 'wrap'
        }}
      >
        <label>
          Font size:&nbsp;
          <input type="range" min={8} max={48} value={fontSize}
                 onChange={(e) => setFontSize(parseInt(e.target.value, 10))} /> <span>{fontSize}px</span>
        </label>

        <label>
          Box width:&nbsp;
          <input type="range" min={140} max={560} value={boxWidth}
                 onChange={(e) => setBoxWidth(parseInt(e.target.value, 10))} /> <span>{boxWidth}px</span>
        </label>

        <label>
          Box height:&nbsp;
          <input type="range" min={48} max={260} value={boxHeight}
                 onChange={(e) => setBoxHeight(parseInt(e.target.value, 10))} /> <span>{boxHeight}px</span>
        </label>

        <button onClick={() => {
          const fixed = makeFirstLineRoot(text)
          setText(fixed); setRoot(parseOutline(fixed))
        }}>
          Make first line the root
        </button>

        <button onClick={() => setPositions({})}>
          Reset layout
        </button>

        {/* Download PNG */}
        <button onClick={() => diagramApi?.downloadPNG({ scale: 2, bg: '#ffffff', margin: 600 })}>
          Download PNG
        </button>
      </div>

      {/* Fixed-height grid. Left is fixed 360px; right fills remaining space */}
      <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 12, height: '75vh' }}>
        {/* Left pane */}
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            onKeyDown={onTextKeyDown}
            onPaste={onTextPaste}
            style={{ width: '100%', height: '100%', resize: 'none', boxSizing: 'border-box', overflow: 'auto', fontFamily: 'monospace' }}
            placeholder={`Paste from Word/OneNote/Docs — lists convert to outline automatically.\nUse Tab / Shift+Tab to indent/outdent.`}
          />
        </div>

        {/* Right pane */}
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <Diagram
            root={root}
            positions={positions}
            onPositionsChange={setPositions}
            onRename={handleRename}
            onReady={setDiagramApi}   // << hooks up the export API
            fontSize={fontSize}
            boxWidth={boxWidth}
            boxHeight={boxHeight}
            textMaxWidth={boxWidth - 20}
          />
        </div>
      </div>
    </div>
  )
}

