// src/lib/parseOutline.ts

export type WbsNode = {
  id: string
  label: string
  level: number
  children: WbsNode[]
}

/** Utilities */
const uid = (() => {
  let n = 0
  return (prefix = 'n') => `${prefix}_${++n}`
})()

function trimRight(str: string) {
  return str.replace(/\s+$/g, '')
}

/* ============================================================
   WBS TABLE PARSER (e.g., "1.2.3<TAB>Task name")
   ============================================================ */

type WbsRow = { code: string; name: string }

function looksLikeWbsLine(line: string): WbsRow | null {
  // Allow tabs or 2+ spaces between code and name
  const m = line.match(/^\s*(\d+(?:\.\d+)*)\s*(?:\t+|\s{2,})\s*(.+?)\s*$/)
  if (!m) return null
  const code = m[1].trim()
  const name = m[2].trim()
  if (!code || !name) return null
  return { code, name }
}

function detectWbsRows(lines: string[]): WbsRow[] {
  const rows: WbsRow[] = []
  for (const raw of lines) {
    const line = trimRight(raw)
    if (!line) continue
    const r = looksLikeWbsLine(line)
    if (r) rows.push(r)
  }
  return rows
}

function buildTreeFromWbsRows(rows: WbsRow[]): WbsNode {
  // Map WBS code -> node
  const nodesByCode = new Map<string, WbsNode>()
  const codes: string[][] = []

  for (const { code, name } of rows) {
    const segs = code.split('.')
    codes.push(segs)
    // Create node for this code
    nodesByCode.set(code, {
      id: code,                 // stable
      label: name,
      level: segs.length - 1,   // absolute depth (we’ll normalize later)
      children: []
    })
  }

  // Determine root: common prefix across all codes.
  // If there is exactly one minimal-depth code and all others extend it, pick that.
  // Else, use synthetic "Project" root.
  let minDepth = Infinity
  for (const segs of codes) minDepth = Math.min(minDepth, segs.length)

  // Compute common prefix of all codes
  let commonPrefix: string[] = codes[0]?.slice(0, minDepth) ?? []
  for (const segs of codes) {
    for (let i = 0; i < commonPrefix.length; i++) {
      if (segs[i] !== commonPrefix[i]) {
        commonPrefix = commonPrefix.slice(0, i)
        break
      }
    }
  }

  // Root candidate is the shortest code that matches the full common prefix
  const rootCodeCandidate =
    commonPrefix.length > 0
      ? commonPrefix.join('.')
      : null

  // If a node exists for the root candidate, use it; otherwise, if multiple minimal roots exist, synthesize one.
  let root: WbsNode
  if (rootCodeCandidate && nodesByCode.has(rootCodeCandidate)) {
    root = nodesByCode.get(rootCodeCandidate)!
  } else {
    // Find all minimal-depth codes
    const minDepthCodes = rows
      .filter(r => r.code.split('.').length === minDepth)
      .map(r => r.code)

    if (minDepthCodes.length === 1 && nodesByCode.has(minDepthCodes[0])) {
      root = nodesByCode.get(minDepthCodes[0])!
    } else {
      // Synthetic root
      root = {
        id: uid('root'),
        label: 'Project',
        level: 0,
        children: []
      }
    }
  }

  // Link parents/children
  for (const { code } of rows) {
    const segs = code.split('.')
    if (nodesByCode.get(code) === root) continue

    const parentCode =
      segs.length > 1 ? segs.slice(0, segs.length - 1).join('.') : null

    let parent: WbsNode | null = null
    if (parentCode && nodesByCode.has(parentCode)) {
      parent = nodesByCode.get(parentCode)!
    } else {
      // attach to synthetic root if codes don't share direct parent in the set
      if (root) parent = root
    }

    const node = nodesByCode.get(code)!
    if (parent) parent.children.push(node)
  }

  // If synthetic root and there exist minimal-depth nodes not attached, attach them
  if (root.label === 'Project') {
    const attached = new Set(root.children.map(c => c.id))
    for (const [code, node] of nodesByCode) {
      if (node === root) continue
      if (attached.has(node.id)) continue
      const segs = code.split('.')
      if (segs.length === minDepth) {
        root.children.push(node)
      }
    }
  }

  // Normalize level so that root == level 0
  const normalize = (n: WbsNode, lvl: number) => {
    n.level = lvl
    for (const c of n.children) normalize(c, lvl + 1)
  }

  // If root is from nodesByCode, ensure it doesn't still appear as a child of another node incorrectly
  const detachIfNeeded = (n: WbsNode) => {
    for (const c of n.children) detachIfNeeded(c)
  }
  detachIfNeeded(root)
  normalize(root, 0)
  return root
}

/* ============================================================
   INDENTED OUTLINE PARSER (spaces indicate levels)
   ============================================================ */

function countIndent(line: string): number {
  // Tabs treated as 2 spaces
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n += 1
    else if (ch === '\t') n += 2
    else break
  }
  return n
}

function buildTreeFromIndent(lines: string[]): WbsNode {
  type StackItem = { node: WbsNode; indent: number }
  const root: WbsNode = { id: uid('root'), label: 'Project', level: 0, children: [] }
  const stack: StackItem[] = [{ node: root, indent: -1 }]

  for (const raw of lines) {
    const line = trimRight(raw)
    if (!line.trim()) continue
    const indent = countIndent(line)
    const label = line.trim()

    const node: WbsNode = { id: uid('n'), label, level: 0, children: [] }

    // find parent by indentation
    while (stack.length && indent <= stack[stack.length - 1].indent) {
      stack.pop()
    }
    const parent = stack[stack.length - 1].node
    node.level = parent.level + 1
    parent.children.push(node)
    stack.push({ node, indent })
  }
  return root.children.length === 1 ? root.children[0] : root
}

/* ============================================================
   PUBLIC: parseOutline — auto-detects WBS-table vs indented
   ============================================================ */

export function parseOutline(text: string): WbsNode {
  const lines = text.split(/\r?\n/)
  // 1) Try WBS table detection
  const wbsRows = detectWbsRows(lines)
  if (wbsRows.length >= 2) {
    return buildTreeFromWbsRows(wbsRows)
  }
  // 2) Fallback to indentation
  return buildTreeFromIndent(lines)
}
