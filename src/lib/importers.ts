// src/lib/importers.ts
import Papa from 'papaparse'
import * as XLSX from 'xlsx'

/**
 * Import an outline from a CSV or Excel file.
 * Expected columns (case-insensitive):  WBS, Name
 * WBS examples: 1, 1.1, 1.2.3  -> indent = number of dots
 */
export async function importOutlineFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase()

  if (name.endsWith('.csv')) {
    const text = await file.text()
    return outlineFromCsv(text)
  }

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer()
    return outlineFromXlsx(buf)
  }

  throw new Error('Unsupported file type. Please use .csv, .xlsx, or .xls')
}

// ---------- Helpers ----------

function normalizeKey(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, '')
}

function findKey(obj: Record<string, any>, target: string): string | null {
  const want = normalizeKey(target)
  for (const k of Object.keys(obj)) {
    if (normalizeKey(k) === want) return k
  }
  return null
}

function toIndentedLine(wbs: string, name: string): string {
  const trimmedName = String(name ?? '').trim()
  if (!trimmedName) return ''
  const dots = (String(wbs ?? '').match(/\./g) || []).length
  const indent = '  '.repeat(dots) // 2 spaces per level
  return indent + trimmedName
}

function outlineFromCsv(csvText: string): string {
  const parsed = Papa.parse<Record<string, any>>(csvText, {
    header: true,
    skipEmptyLines: true,
  })

  if (parsed.errors?.length) {
    // Not fatal for all rows; still proceed unless totally broken
    // console.warn(parsed.errors)
  }

  const rows = (parsed.data || []).filter(Boolean)
  if (!rows.length) throw new Error('CSV has no data rows.')

  // Use the first row to detect header keys
  const sample = rows[0]
  let wbsKey = findKey(sample, 'wbs')
  let nameKey = findKey(sample, 'name')

  // fallbacks for header variants
  if (!nameKey) nameKey = findKey(sample, 'taskname') || findKey(sample, 'title')

  if (!wbsKey || !nameKey) {
    throw new Error('CSV must contain columns "WBS" and "Name".')
  }

  const lines: string[] = []
  for (const r of rows) {
    const line = toIndentedLine(String(r[wbsKey] ?? ''), String(r[nameKey] ?? ''))
    if (line) lines.push(line)
  }

  if (!lines.length) throw new Error('No tasks found in CSV.')
  return lines.join('\n')
}

function outlineFromXlsx(buf: ArrayBuffer): string {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('Excel file has no sheets.')

  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' })
  if (!rows.length) throw new Error('Excel sheet has no data rows.')

  const sample = rows[0]
  let wbsKey = findKey(sample, 'wbs')
  let nameKey = findKey(sample, 'name')

  if (!nameKey) nameKey = findKey(sample, 'taskname') || findKey(sample, 'title')

  if (!wbsKey || !nameKey) {
    throw new Error('Excel must contain columns "WBS" and "Name".')
  }

  const lines: string[] = []
  for (const r of rows) {
    const line = toIndentedLine(String(r[wbsKey] ?? ''), String(r[nameKey] ?? ''))
    if (line) lines.push(line)
  }

  if (!lines.length) throw new Error('No tasks found in Excel.')
  return lines.join('\n')
}

// Also provide default export for convenience
export default importOutlineFromFile
