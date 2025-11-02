import { useEffect, useMemo, useState } from 'react'
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
import Papa from 'papaparse'
import { rowsToOutline, parseCsvToOutline, parseXlsxToOutline } from './lib/importers'
import { parseOutline, type WbsNode } from './lib/parseOutline'
import { toOutline, renameNode } from './lib/wbs'
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
type DiagramApi = {
  downloadPNG: (opts?: { scale?: number; bg?: string; margin?: number }) => void
  downloadSVG: (opts?: { bg?: string; margin?: number }) => void
}

/* ------------------------- Input Page ------------------------- */
function InputPage() {
  const navigate = useNavigate()
  const [text, setText] = useState<string>(() => localStorage.getItem(STORAGE_KEY) || SAMPLE)

  // Convert HTML lists -> outline
  const htmlListToOutline = (html: string): string | null => {
    if (!html || !/<(ul|ol|li|br)/i.test(html)) return null
    const parser = new DOMParser()
    const doc = parser.parseFromString(html, 'text/html')
    const list = doc.body.querySelector('ul,ol')
    if (!list) return null

    const lines: string[] = []
    const walk = (el: Element, depth: number) => {
      const items = Array.from(el.children).filter((x) => x.tagName.toLowerCase() === 'li') as HTMLElement[]
      for (const li of items) {
        const copy = li.cloneNode(true) as HTMLElement
        copy.querySelectorAll('ul,ol').forEach((n) => n.remove())
        copy.querySelectorAll('br').forEach((br) => (br.outerHTML = '\n'))
        const parts = (copy.textContent || '')
          .replace(/\u00A0/g, ' ')
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
        for (const p of parts) lines.push(`${'  '.repeat(depth)}${p}`)
        Array.from(li.children)
          .filter((x) => /^(ul|ol)$/i.test(x.tagName))
          .forEach((child) => walk(child, depth + 1))
      }
    }
    walk(list, 0)
    return lines.join('\n')
  }

  // Paste: HTML lists, CSV/TSV w/ headers, CSV/TSV 2 cols (WBS path + Name)
  const onPaste: React.ClipboardEventHandler<HTMLTextAreaElement> = (e) => {
    const html = e.clipboardData.getData('text/html')
    const plain = e.clipboardData.getData('text/plain')

    const convertedList = htmlListToOutline(html)

    const convertedTable = (() => {
      if (!plain) return null
      const looksTabular = plain.includes(',') || plain.includes('\t')
      if (!looksTabular) return null

      const delimiter = plain.includes('\t') ? '\t' : undefined
      const firstLine = plain.split(/\r?\n/, 1)[0] || ''
      const lower = firstLine.toLowerCase()

      // With headers we know
      const hasInterestingHeaders = /(wbs|name|task|level|indent)/.test(lower)
      if (hasInterestingHeaders) {
        const res = Papa.parse<Record<string, unknown>>(plain, {
          header: true,
          skipEmptyLines: true,
          delimiter
        })
        try {
          const rows = (res.data || []).filter(Boolean)
          const outline = rowsToOutline(rows)
          return outline.trim().length ? outline : null
        } catch {
          // fall through to heuristic
        }
      }

      // No headers: 2 columns, first looks like WBS path
      const resNoHeader = Papa.parse<string[]>(plain, { header: false, skipEmptyLines: true, delimiter })
      const data = (resNoHeader.data || []).filter((r) => Array.isArray(r) && r.join('').trim().length > 0)

      const wbsRe = /^\d+(?:\.\d+)*$/ // 1, 1.2, 1.4.10
      const rows2 = data
        .map((arr) => {
          const c0 = String(arr[0] ?? '').trim()
          const c1 = String(arr[1] ?? '').trim()
          return { WBS: c0, Name: c1 }
        })
        .filter((r) => r.WBS || r.Name)

      if (rows2.length > 0) {
        const score = rows2.reduce((acc, r) => acc + (wbsRe.test(r.WBS) && r.Name ? 1 : 0), 0)
        const ratio = score / rows2.length
        if (ratio >= 0.7) {
          const outline = rowsToOutline(rows2 as unknown as Array<Record<string, unknown>>)
          return outline.trim().length ? outline : null
        }
      }

      return null
    })()

    const converted = convertedList ?? convertedTable
    if (!converted) {
      return // let the browser paste normally
    }

    e.preventDefault()
    const toInsert = converted
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\t/g, '  ')
      .trimEnd()

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

  // Tab/Shift+Tab
  const onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const INDENT = '  '
    const t = e.currentTarget
    const start = t.selectionStart
    const end = t.selectionEnd
    const val = t.value
    const selected = val.slice(start, end)
    const isMulti = selected.includes('\n')

    const apply = (nv: string, s: number, ed: number) => {
      setText(nv)
      requestAnimationFrame(() => { t.selectionStart = s; t.selectionEnd = ed })
    }

    if (!e.shiftKey) {
      if (isMulti) {
        const lines = val.slice(start, end).split('\n').map((l) => INDENT + l)
        apply(val.slice(0, start) + lines.join('\n') + val.slice(end), start, end + INDENT.length * lines.length)
      } else {
        apply(val.slice(0, start) + INDENT + val.slice(start), start + INDENT.length, start + INDENT.length)
      }
    } else {
      if (isMulti) {
        const chunk = val.slice(start, end); let removed = 0
        const out = chunk.split('\n').map(l => {
          if (l.startsWith(INDENT)) { removed += INDENT.length; return l.slice(INDENT.length) }
          return l
        }).join('\n')
        apply(val.slice(0, start) + out + val.slice(end), start, end - removed)
      } else {
        const lineStart = val.lastIndexOf('\n', start - 1) + 1
        let nv = val, rem = 0
        if (val.slice(lineStart).startsWith(INDENT)) { nv = val.slice(0, lineStart) + val.slice(lineStart + INDENT.length); rem = INDENT.length }
        const caret = Math.max(start - rem, lineStart)
        apply(nv, caret, caret)
      }
    }
  }

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="title">WBS Builder</h1>
          <p className="subtitle">Paste an outline or a WBS/Name table, or import CSV/Excel.</p>
        </div>
      </header>

      <main className="content">
        <section className="card">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            className="textarea"
            placeholder="Paste outline or WBS/Name table here. Use Tab/Shift+Tab to indent/outdent."
          />

          <div className="toolbar">
            <button className="btn" onClick={() => navigate('/import')}>Import Excel/CSV</button>
            <div className="spacer" />
            <button
              className="btn btn-primary"
              onClick={() => {
                const payload = (text || '').trim() || SAMPLE
                localStorage.setItem(STORAGE_KEY, payload)
                navigate('/diagram')
              }}
            >
              Generate →
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}

/* ------------------------- Import Page ------------------------- */
function ImportPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<string>('Choose a .xlsx or .csv file')
  const [error, setError] = useState<string>('')

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError('')
    const f = e.target.files?.[0]
    if (!f) return
    try {
      setStatus('Parsing…')
      const name = f.name.toLowerCase()
      let outline = ''
      if (name.endsWith('.csv')) outline = await parseCsvToOutline(f)
      else if (name.endsWith('.xlsx') || name.endsWith('.xls')) outline = await parseXlsxToOutline(f)
      else throw new Error('Unsupported file type (use .csv or .xlsx)')

      outline = (outline || '').trim()
      if (!outline) throw new Error('No tasks parsed. Ensure headers include WBS+Name or Task+{Level|Indent}.')

      localStorage.setItem(STORAGE_KEY, outline)
      setStatus('Imported OK — redirecting…')
      navigate('/diagram')
    } catch (err: any) {
      console.error(err)
      setError(err?.message || String(err))
      setStatus('Choose a .xlsx or .csv file')
    } finally {
      e.currentTarget.value = ''
    }
  }

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="title">Import Excel / CSV</h1>
          <p className="subtitle">Supported: <code>WBS, Name</code> or <code>Task, Level</code> or <code>Task, Indent</code>.</p>
        </div>
        <button className="btn" onClick={() => navigate('/')}>← Back</button>
      </header>

      <main className="content">
        <section className="card">
          <div className="row">
            <input type="file" accept=".csv,.xlsx,.xls" onChange={onFileChange} />
            <div className={`status ${error ? 'error' : ''}`}>{error || status}</div>
          </div>
          <div className="hint">
            Examples:
            <pre>WBS,Name{'\n'}1,Project{'\n'}1.1,Planning{'\n'}1.1.1,Define scope</pre>
            <pre>Task,Level{'\n'}Project,1{'\n'}Planning,1{'\n'}Define scope,2</pre>
          </div>
        </section>
      </main>
    </div>
  )
}

/* ------------------------- Diagram Page ------------------------- */
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

  useEffect(() => { if (!initial.trim()) navigate('/') }, [initial, navigate])

  const handleRename = (id: string, newLabel: string) => {
    const updated = renameNode(root, id, newLabel)
    setRoot(updated)
    const newText = toOutline(updated)
    localStorage.setItem(STORAGE_KEY, newText)
  }

  return (
    <div className="container">
      <header className="header">
        <div>
          <h1 className="title">WBS Diagram</h1>
          <p className="subtitle">Drag to arrange. Double-click a box to rename.</p>
        </div>
        <button className="btn" onClick={() => navigate('/')}>← Back to Input</button>
      </header>

      <main className="content">
        <section className="card">
          <div className="toolbar wrap">
            <div className="group">
              <label className="label">Font</label>
              <input type="range" min={8} max={48} value={fontSize} onChange={e => setFontSize(parseInt(e.target.value, 10))} />
              <span className="mono">{fontSize}px</span>
            </div>
            <div className="group">
              <label className="label">Box W</label>
              <input type="range" min={140} max={560} value={boxWidth} onChange={e => setBoxWidth(parseInt(e.target.value, 10))} />
              <span className="mono">{boxWidth}px</span>
            </div>
            <div className="group">
              <label className="label">Box H</label>
              <input type="range" min={48} max={260} value={boxHeight} onChange={e => setBoxHeight(parseInt(e.target.value, 10))} />
              <span className="mono">{boxHeight}px</span>
            </div>

            <div className="spacer" />

            <button className="btn" onClick={() => diagramApi?.downloadPNG({ scale: 2, bg: '#ffffff', margin: 600 })}>
              Download PNG
            </button>
            <button className="btn btn-primary" onClick={() => diagramApi?.downloadSVG({ /* transparent */ margin: 120 })}>
              Download SVG
            </button>
          </div>

          <div className="diagram-shell">
            <div style={{ height: '75vh', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
              <Diagram
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
        </section>
      </main>
    </div>
  )
}

/* ------------------------- App (Router) ------------------------- */
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<InputPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/diagram" element={<DiagramPage />} />
      </Routes>
    </HashRouter>
  )
}
