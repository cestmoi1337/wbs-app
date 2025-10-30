export type WbsNode = {
  id: string          // stable path id: "1", "1.2", "1.2.3"
  label: string
  level: number
  children: WbsNode[]
}

// Convert an indented outline (tabs or 2 spaces per level) into a tree with stable path IDs.
export function parseOutline(text: string): WbsNode {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+$/, ''))
  const items = lines
    .filter(l => l.trim().length > 0)
    .map((line) => {
      const m = line.match(/^(\s*)(.*)$/)!
      const ws = m[1]
      const label = m[2].trim()
      const tabs = (ws.match(/\t/g) || []).length
      const spaces = ws.replace(/\t/g, '').length
      const level = tabs + Math.floor(spaces / 2) // 1 tab = 1 level; 2 spaces = 1 level
      return { label, level }
    })

  // Build a plain tree first (temporary ids)
  type Tmp = { label: string; level: number; children: Tmp[] }
  const rootTmp: Tmp = { label: 'ROOT', level: -1, children: [] }
  const stack: Tmp[] = [rootTmp]
  for (const it of items) {
    while (stack.length && stack[stack.length - 1].level >= it.level) stack.pop()
    const node: Tmp = { label: it.label, level: it.level, children: [] }
    stack[stack.length - 1].children.push(node)
    stack.push(node)
  }

  // Assign stable path IDs (e.g., 1, 1.2, 1.2.3) based on sibling index order
  const toWbs = (n: Tmp, parentPath: string): WbsNode[] => {
    const out: WbsNode[] = []
    n.children.forEach((c, i) => {
      const path = parentPath ? `${parentPath}.${i + 1}` : String(i + 1)
      const node: WbsNode = {
        id: path,
        label: c.label,
        level: c.level,      // 0 for first level under the (implicit) root
        children: toWbs(c, path)
      }
      out.push(node)
    })
    return out
  }

  return {
    id: 'root', label: 'ROOT', level: -1, children: toWbs(rootTmp, '')
  }
}

