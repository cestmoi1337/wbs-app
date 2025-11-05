// src/lib/importers.ts
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

/**
 * Normalizes a 2-column table (WBS, Name) into outline text.
 */
function rowsToOutline(rows: Array<Record<string, unknown>> | string[][]): string {
  const out: string[] = []

  const asRecords = rows as Array<Record<string, unknown>>
  const looksLikeRecords =
    Array.isArray(asRecords) &&
    asRecords.length > 0 &&
    typeof asRecords[0] === 'object' &&
    !Array.isArray(asRecords[0])

  if (looksLikeRecords) {
    const first = asRecords[0]
    const keys = Object.keys(first)
    const findKey = (name: string) => keys.find(k => k.toLowerCase().includes(name))
    const wbsKey = findKey('wbs') ?? keys[0]
    const nameKey = findKey('name') ?? keys[1] ?? keys[0]

    for (const r of asRecords) {
      const wbs = String((r as any)[wbsKey] ?? '').trim()
      const name = String((r as any)[nameKey] ?? '').trim()
      if (!wbs && !name) continue
      const level = wbs ? wbs.split('.').length : 1
      const indent = '  '.repeat(Math.max(0, level - 1))
      out.push(`${indent}${name || wbs}`)
    }
    return out.join('\n')
  }

  // Fallback for raw 2D arrays (no headers)
  const rows2d = rows as string[][]
  for (const r of rows2d) {
    const wbs = String(r[0] ?? '').trim()
    const name = String(r[1] ?? '').trim()
    if (!wbs && !name) continue
    const level = wbs ? wbs.split('.').length : 1
    const indent = '  '.repeat(Math.max(0, level - 1))
    out.push(`${indent}${name || wbs}`)
  }
  return out.join('\n')
}

/** Parse CSV/TSV text → outline */
function parseDelimitedToOutline(text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      complete: (res: Papa.ParseResult<Record<string, unknown>>) => {
        const data = res.data
        const hasObjects = Array.isArray(data) && data.some(x => x && typeof x === 'object' && !Array.isArray(x))
        if (hasObjects && data.length > 0) {
          resolve(rowsToOutline(data))
        } else {
          // reparse without header
          Papa.parse<string[]>(text, {
            header: false,
            skipEmptyLines: true,
            complete: (res2: Papa.ParseResult<string[]>) => {
              resolve(rowsToOutline(res2.data as string[][]))
            },
            error: (error: Error /* , file: string */) => reject(error)
          })
        }
      },
      error: (error: Error /* , file: string */) => reject(error)
    })
  })
}

/** Read Excel (xlsx/xls) → outline (first sheet) */
async function parseExcelToOutline(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Workbook has no sheets')
  const ws = wb.Sheets[sheetName]

  // Try as objects (header row)
  const asObjects = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
  if (asObjects && asObjects.length > 0) {
    return rowsToOutline(asObjects)
  }

  // Fallback: raw rows (no header)
  const asRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
  return rowsToOutline(asRows)
}

/** Public API: File (Excel/CSV/TSV/TXT) → outline string */
export async function importOutlineFromFile(file: File): Promise<string> {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    return parseExcelToOutline(file)
  }
  const text = await file.text()
  return parseDelimitedToOutline(text)
}
