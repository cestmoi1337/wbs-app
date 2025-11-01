import Papa from 'papaparse'
import * as XLSX from 'xlsx'

function normalizeHeader(h: string) {
  return (h || '').trim().toLowerCase()
}

function sortPath(a: string, b: string) {
  // numeric-aware sort so "1.10" > "1.2"
  return a.localeCompare(b, undefined, { numeric: true })
}

/** Build outline from rows that have WBS + Name */
function rowsWithWbsToOutline(rows: Array<Record<string, unknown>>): string {
  const normalized = rows
    .map((r) => {
      const m: Record<string, any> = {}
      for (const k of Object.keys(r)) m[normalizeHeader(k)] = (r as any)[k]
      return m
    })
    .filter((m) => String(m['wbs'] ?? '').trim() || String(m['name'] ?? '').trim())

  // sort by WBS path to ensure proper order
  normalized.sort((a, b) => sortPath(String(a['wbs'] || ''), String(b['wbs'] || '')))

  const out: string[] = []
  for (const m of normalized) {
    const path = String(m['wbs'] ?? '').trim()
    const name = String(m['name'] ?? '').trim()
    if (!path || !name) continue

    const depth = Math.max(1, path.split('.').filter(Boolean).length) // "1.4.10" -> 3
    const indent = Math.max(0, depth - 1)
    out.push(`${'  '.repeat(indent)}${name}`)
  }
  return out.join('\n')
}

/** Generic: Task + Level / Task + Indent */
function rowsGenericToOutline(rows: Array<Record<string, unknown>>): string {
  const out: string[] = []
  for (const r of rows) {
    const keys = Object.keys(r).reduce((acc, k) => {
      acc[normalizeHeader(k)] = (r as any)[k]
      return acc
    }, {} as Record<string, any>)

    const rawTask = keys['task']
    if (!rawTask || String(rawTask).trim().length === 0) continue
    const task = String(rawTask).trim()

    let level: number | null = null
    if (keys['level'] != null && keys['level'] !== '') {
      const n = Number(keys['level'])
      if (Number.isFinite(n) && n >= 1) level = Math.floor(n)
    }
    if (level == null && keys['indent'] != null && keys['indent'] !== '') {
      const n = Number(keys['indent'])
      if (Number.isFinite(n) && n >= 0) level = Math.floor(n) + 1 // indent 0 -> level 1
    }
    if (level == null) level = 1

    out.push(`${'  '.repeat(Math.max(0, level - 1))}${task}`)
  }
  return out.join('\n')
}

/** Decide which schema we have and convert to outline */
export function rowsToOutline(rows: Array<Record<string, unknown>>): string {
  if (!rows?.length) return ''

  const lowerHeaders = new Set(Object.keys(rows[0] ?? {}).map(normalizeHeader))
  const hasWbs = lowerHeaders.has('wbs')
  const hasName = lowerHeaders.has('name')

  if (hasWbs && hasName) {
    return rowsWithWbsToOutline(rows)
  }
  return rowsGenericToOutline(rows)
}

export async function parseCsvToOutline(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res: Papa.ParseResult<Record<string, unknown>>) => {
        try {
          const rows = (res.data || []).filter(Boolean)
          resolve(rowsToOutline(rows))
        } catch (e) {
          reject(e)
        }
      },
      // Browser File overload => (error: Error, file: File|string)
      error: (error: Error) => reject(error)
    })
  })
}

export async function parseXlsxToOutline(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  return rowsToOutline(rows)
}
