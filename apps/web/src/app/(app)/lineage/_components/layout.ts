import type { Agent } from "@/data/types";

export interface TreeLayout {
  width: number;
  height: number;
  maxGeneration: number;
  /** Column x for each generation, index = generation. */
  columns: number[];
  pos: Record<string, { x: number; y: number }>;
}

const ROW_H = 46;
const COL_W = 190;
const PAD_X = 70;
const PAD_Y = 50;
/** Room right of the last column for node labels. */
const LABEL_ROOM = 110;
/** Extra vertical gap between founder families, in rows. */
const FAMILY_GAP = 0.4;

/** Tidy left-to-right tree: leaves take successive rows, a parent sits midway between its first and last child. */
export function layoutTree(agents: Agent[]): TreeLayout {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const pos: TreeLayout["pos"] = {};
  const colX = (g: number) => PAD_X + g * COL_W;
  let row = 0;

  const place = (a: Agent) => {
    const kids = a.childIds.map((id) => byId.get(id)).filter((k): k is Agent => !!k);
    if (kids.length === 0) {
      pos[a.id] = { x: colX(a.generation), y: PAD_Y + row++ * ROW_H };
      return;
    }
    kids.forEach(place);
    pos[a.id] = { x: colX(a.generation), y: (pos[kids[0]!.id]!.y + pos[kids[kids.length - 1]!.id]!.y) / 2 };
  };

  // a parent missing from the list is treated as a root so no agent is dropped
  for (const root of agents.filter((a) => !a.parentId || !byId.has(a.parentId))) {
    place(root);
    row += FAMILY_GAP;
  }

  const maxGeneration = Math.max(0, ...agents.map((a) => a.generation));
  return {
    width: colX(maxGeneration) + LABEL_ROOM,
    height: PAD_Y + row * ROW_H + 10,
    maxGeneration,
    columns: Array.from({ length: maxGeneration + 1 }, (_, g) => colX(g)),
    pos,
  };
}
