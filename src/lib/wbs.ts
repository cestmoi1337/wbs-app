import type { WbsNode } from './parseOutline'

// Convert a WbsNode tree back into outline text (two spaces per level)
export function toOutline(root: WbsNode): string {
  const out: string[] = []
  const walk = (n: WbsNode, depth: number) => {
    if (n.id !== 'root') out.push(`${'  '.repeat(depth)}${n.label}`)
    for (const c of n.children) walk(c, depth + 1)
  }
  walk(root, 0)
  return out.join('\n')
}

// Immutable update by path id (e.g., "1.3.2")
export function renameNode(root: WbsNode, id: string, newLabel: string): WbsNode {
  const clone = (n: WbsNode): WbsNode => ({
    id: n.id, label: n.label, level: n.level, children: n.children.map(clone)
  })
  const r = clone(root)
  const visit = (n: WbsNode) => {
    if (n.id === id) n.label = newLabel
    n.children.forEach(visit)
  }
  visit(r)
  return r
}

// Optional helper: indent everything under first line
export function makeFirstLineRoot(text: string): string {
  const lines = text.split(/\r?\n/)
  if (lines.length === 0) return text
  return lines.map((l, i) => (i === 0 || l.trim() === '' ? l : '  ' + l)).join('\n')
}

