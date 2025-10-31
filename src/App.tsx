import { useEffect, useMemo, useState } from 'react'
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
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

const STORAGE_KEY = 'wbs-outline'

type Pos = { x: number; y: number }
type DiagramApi = { downloadPNG: (opts?: { scale?: number; bg?: string; margin?: number }) => void }

/** Convert HTML lists on paste -> indented text */
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

/** ---------- Page 1: Input ---------- */
function InputPage() {
  const navigate = useNavigate()
  const [text, setText] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || SAMPLE)

  const onPaste: React.ClipboardEventHandler<HTMLTextAreaElement> = (e) => {
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
    requestAnimationFrame(() => {
      const caret = start + toInsert.length
      target.selectionStart = caret
      target.selectionEnd = caret
    })
  }

  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const INDENT = '  '
    const target = e.currentTarget
    const start = target.selectionStart
    const end = target.selectionEnd
    const value = target.value
    const selected = value.slice(start, end)
    const isMulti = selected.includes('\n')

    const apply = (t: string, s: number, ed: number) => {
      setText(t)
      requestAnimationFrame(() => {
        target.selectionStart = s
        target.selectionEnd = ed
      })
    }

    if (!e.shiftKey) {
      if (isMulti) {
        const lines = value.slice(start, end).split('\n').map((l) => INDENT + l)
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
        const out = chunk
          .split('\n')
          .map((l) => {
            if (l.startsWith(INDENT)) {
              removed += INDENT.length
              return l.slice(INDENT.length)
            }
            return l
          })
          .join('\n')
        const nv = value.slice(0, start) + out + value.slice(end)
        apply(nv, start, end - removed)
      } else {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1
        let nv = value,
          rem = 0
        if (value.slice(lineStart).startsWith(INDENT)) {
          nv = value.slice(0, lineStart) + value.slice(lineStart + INDENT.length)
          rem = INDENT.length
        }
        const caret = Math.max(start - rem, lineStart)
        apply(nv, caret, caret)
      }
    }
  }

  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100vh' }}>
      <h1>WBS Builder — Input</h1>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        style={{ width: '100%', height: '100%', resize: 'none', boxSizing: 'border-box', fontFamily: 'monospace' }}
        placeholder="Paste your outline here. Use Tab/Shift+Tab to indent/outdent."
      />
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button onClick={() => setText(makeFirstLineRoot(text))}>Make first line the root</button>
        <button
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            const payload = (text || '').trim() || SAMPLE
            localStorage.setItem(STORAGE_KEY, payload)
            navigate('/diagram') // navigate via router (prevents weird hash glitches)
          }}
        >
          Generate →
        </button>
      </div>
    </div>
  )
}

/** ---------- Page 2: Diagram ---------- */
function DiagramPage() {
  const navigate = useNavigate()
  const initial = useMemo(() => {
    const fromLS = (localStorage.getItem(STORAGE_KEY) || '').trim()
    return fromLS || SAMPLE
  }, [])

  const [root, setRoot] = useState<WbsNode>(() => parseOutline(initial))
  const [fontSize, setFontSize] = useState(12)
  const [boxWidth, setBoxWidth] = useState(240)
  const [boxHeight, setBoxHeight] = useState(72)
  const [positions, setPositions] = useState<Record<string, Pos>>({})
  const [diagramApi, setDiagramApi] = useState<DiagramApi | null>(null)

  // Force remount the Diagram to fully reset layout/viewport
  const [layoutKey, setLayoutKey] = useState(0)

  useEffect(() => {
    if (!initial.trim()) navigate('/')
  }, [initial, navigate])

  const handleRename = (id: string, newLabel: string) => {
    const updated = renameNode(root, id, newLabel)
    setRoot(updated)
    const newText = toOutline(updated)
    localStorage.setItem(STORAGE_KEY, newText)
  }

  return (
    <div style={{ padding: 16 }}>
      <h1>WBS Builder — Diagram</h1>

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
        <button onClick={() => navigate('/')}>← Back to Input</button>

        <label>
          Font size:&nbsp;
          <input type="range" min={8} max={48} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value, 10))} />{' '}
          <span>{fontSize}px</span>
        </label>

        <label>
          Box width:&nbsp;
          <input type="range" min={140} max={560} value={boxWidth} onChange={(e) => setBoxWidth(parseInt(e.target.value, 10))} />{' '}
          <span>{boxWidth}px</span>
        </label>

        <label>
          Box height:&nbsp;
          <input type="range" min={48} max={260} value={boxHeight} onChange={(e) => setBoxHeight(parseInt(e.target.value, 10))} />{' '}
          <span>{boxHeight}px</span>
        </label>

        <button
          onClick={() => {
            setPositions({})
            setLayoutKey(k => k + 1) // hard reset diagram + auto-fit
          }}
        >
          Force auto-layout
        </button>

        <button onClick={() => diagramApi?.downloadPNG({ scale: 2, bg: '#ffffff', margin: 600 })}>
          Download PNG
        </button>
      </div>

      {!root.children?.length && (
        <div style={{ padding: 24, color: '#555' }}>
          No tasks found. Go back to <button onClick={() => navigate('/')}>Input</button> and paste your outline.
        </div>
      )}

      <div style={{ height: '75vh', border: '1px solid #eee', overflow: 'hidden' }}>
        <Diagram
          key={layoutKey}
          root={root}
          positions={positions}
          onPositionsChange={setPositions}
          onRename={handleRename}
          onReady={setDiagramApi}
          fontSize={fontSize}
          boxWidth={boxWidth}
          boxHeight={boxHeight}
          textMaxWidth={boxWidth - 20}
        />
      </div>
    </div>
  )
}

/** ---------- App ---------- */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<InputPage />} />
        <Route path="/diagram" element={<DiagramPage />} />
      </Routes>
    </HashRouter>
  )
}
