export type WbsNode = {
  id: string;        // path-like id: "1", "1.2", "1.2.1"
  label: string;
  level: number;     // 1 = top-level task under virtual root
  children: WbsNode[];
};

function normalizeLines(input: string): string[] {
  return (input || '')
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '  ')         // tabs -> 2 spaces
    .split('\n')
    .map(l => l.replace(/\u00A0/g, ' ').replace(/\s+$/,''))
    .filter(l => l.trim().length > 0);
}

/**
 * Parses an indented outline (2 spaces per level) into a tree.
 * The returned tree has a virtual root { id: 'root', level: 0 }.
 * The first real line becomes level=1.
 */
export function parseOutline(text: string): WbsNode {
  const lines = normalizeLines(text);
  const root: WbsNode = { id: 'root', label: 'root', level: 0, children: [] };
  if (lines.length === 0) return root;

  type Frame = { node: WbsNode; level: number; childSeq: number };
  const stack: Frame[] = [{ node: root, level: 0, childSeq: 0 }];

  // keep child index per parent to build stable path ids
  const childIndex: Map<WbsNode, number> = new Map([[root, 0]]);

  for (const raw of lines) {
    const m = raw.match(/^(\s*)(.*)$/);
    if (!m) continue;
    const indent = m[1] || '';
    const label = (m[2] || '').trim();
    if (!label) continue;

    // 2 spaces per level; clamp at least level 1
    const ilvl = Math.floor(indent.length / 2);
    const level = Math.max(1, ilvl + 1);

    // Pop to correct parent frame
    while (stack.length && stack[stack.length - 1].level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;

    // child index for path
    const idx = (childIndex.get(parent) || 0) + 1;
    childIndex.set(parent, idx);

    const path = parent.id === 'root' ? `${idx}` : `${parent.id}.${idx}`;
    const node: WbsNode = { id: path, label, level, children: [] };
    parent.children.push(node);

    // push new frame for nested children
    stack.push({ node, level, childSeq: 0 });
    childIndex.set(node, 0);
  }

  return root;
}
