import type { WbsNode } from './parseOutline'

/** Convert a WBS tree back to a 2-space indented outline */
export function toOutline(root: WbsNode): string {
  const lines: string[] = []
  const visit = (n: WbsNode) => {
    for (const c of n.children || []) {
      const indent = '  '.repeat(Math.max(0, c.level - 1))
      lines.push(`${indent}${c.label}`)
      visit(c)
    }
  }
  visit(root)
  return lines.join('\n')
}

/** Deep clone + rename a node by id (path-like id) */
export function renameNode(root: WbsNode, id: string, newLabel: string): WbsNode {
  const clone = (n: WbsNode): WbsNode => ({
    id: n.id,
    label: n.label,
    level: n.level,
    children: n.children?.map(clone) ?? []
  })
  const copy = clone(root)
  const map = new Map<string, WbsNode>()
  const index = (n: WbsNode) => { map.set(n.id, n); n.children.forEach(index) }
  index(copy)
  const target = map.get(id)
  if (target) target.label = newLabel
  return copy
}

/**
 * If the first non-empty line is intended to be the single top node,
 * ensure every other line is at least one level deeper.
 */
export function makeFirstLineRoot(text: string): string {
  const lines = (text || '').replace(/\r\n/g, '\n').split('\n')
  const idx = lines.findIndex(l => l.trim().length > 0)
  if (idx < 0) return text

  // Determine if there exists any sibling at level 1 besides the first line
  // If so, we leave as-is. If not, indent all subsequent non-empty lines by 2 spaces.
  let needIndent = true
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim()) continue
    const indentCount = (l.match(/^( +)/)?.[1].length ?? 0)
    if (indentCount >= 2) { needIndent = false; break }
  }
  if (!needIndent) return text

  const out = [...lines]
  for (let i = idx + 1; i < out.length; i++) {
    if (out[i].trim().length > 0) out[i] = '  ' + out[i]
  }
  return out.join('\n')
}
