export const WORLD_SPEC = Object.freeze({
  version: 1,
  size: Object.freeze({ x: 16, y: 16, z: 16 }),
  origin: Object.freeze({ x: -8, y: 0, z: -8 }),
  voxelSizeMeters: 0.03,
  maxBlocks: 4096,
  footprint: Object.freeze({ minX: -7, maxX: 7, minZ: -7, maxZ: 7 }),
  // One block thick: the island reads as a thin lawn slab and keeps the buildable
  // volume large relative to its footprint.
  terrainTopY: 1,
});

export type Coord = Readonly<{ x: number; y: number; z: number }>;
export type BlockId = (typeof BLOCK_IDS)[number];

// The first eight ids are the v1 terrain/build set and MUST keep their positions:
// durable stores encode a block as `index + 1`, so appending is the only compatible
// way to grow the catalog. The next eight are decorative; `stairs` is appended after
// them as the v0 "seat" block (an ordinary placeable block — being a seat is a
// companion-behaviour concept, not new world physics). None of these add gravity,
// collision or light rules.
export const BLOCK_IDS = [
  "grass",
  "dirt",
  "stone",
  "planks",
  "log",
  "leaves",
  "sand",
  "glass",
  "brick",
  "tile",
  "wool_white",
  "wool_red",
  "bookshelf",
  "lantern",
  "pumpkin",
  "flower",
  "stairs",
] as const;

export type BlockDef = Readonly<{
  id: BlockId;
  label: string;
  solid: boolean;
  placeable: boolean;
}>;

export const BLOCK_DEFS: Readonly<Record<BlockId, BlockDef>> = Object.freeze({
  grass: Object.freeze({ id: "grass", label: "草方块", solid: true, placeable: true }),
  dirt: Object.freeze({ id: "dirt", label: "泥土", solid: true, placeable: true }),
  stone: Object.freeze({ id: "stone", label: "石头", solid: true, placeable: true }),
  planks: Object.freeze({ id: "planks", label: "木板", solid: true, placeable: true }),
  log: Object.freeze({ id: "log", label: "原木", solid: true, placeable: true }),
  leaves: Object.freeze({ id: "leaves", label: "树叶", solid: true, placeable: true }),
  sand: Object.freeze({ id: "sand", label: "沙子", solid: true, placeable: true }),
  glass: Object.freeze({ id: "glass", label: "玻璃", solid: false, placeable: true }),
  // Decorative set: labels read naturally in the Chinese product UI.
  brick: Object.freeze({ id: "brick", label: "红砖", solid: true, placeable: true }),
  tile: Object.freeze({ id: "tile", label: "瓦片", solid: true, placeable: true }),
  wool_white: Object.freeze({ id: "wool_white", label: "白色羊毛", solid: true, placeable: true }),
  wool_red: Object.freeze({ id: "wool_red", label: "红色羊毛", solid: true, placeable: true }),
  bookshelf: Object.freeze({ id: "bookshelf", label: "书架", solid: true, placeable: true }),
  lantern: Object.freeze({ id: "lantern", label: "灯笼", solid: true, placeable: true }),
  pumpkin: Object.freeze({ id: "pumpkin", label: "南瓜", solid: true, placeable: true }),
  flower: Object.freeze({ id: "flower", label: "小花", solid: true, placeable: true }),
  // v0 seat block: the companion sits on it after finishing a house build. It is a
  // normal placeable block; the "seat" meaning lives only in companion behaviour.
  stairs: Object.freeze({ id: "stairs", label: "台阶（座位）", solid: true, placeable: true }),
});

export const WORLD_CELL_COUNT = WORLD_SPEC.size.x * WORLD_SPEC.size.y * WORLD_SPEC.size.z;

export function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && Object.hasOwn(BLOCK_DEFS, value);
}

export function isCoord(value: unknown): value is Coord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const coord = value as Record<string, unknown>;
  const keys = Object.keys(coord).sort();
  return keys.length === 3 && keys[0] === "x" && keys[1] === "y" && keys[2] === "z"
    && Number.isSafeInteger(coord.x) && Number.isSafeInteger(coord.y) && Number.isSafeInteger(coord.z);
}

export function isInBounds(coord: Coord): boolean {
  const { origin, size } = WORLD_SPEC;
  return coord.x >= origin.x && coord.x < origin.x + size.x
    && coord.y >= origin.y && coord.y < origin.y + size.y
    && coord.z >= origin.z && coord.z < origin.z + size.z;
}

/** Linear layout is x-fastest, z-next, y-slowest. */
export function coordToIndex(coord: Coord): number {
  if (!isCoord(coord) || !isInBounds(coord)) {
    throw new RangeError("Coordinate is invalid or outside world bounds");
  }
  const { origin, size } = WORLD_SPEC;
  return ((coord.y - origin.y) * size.z + (coord.z - origin.z)) * size.x + (coord.x - origin.x);
}

export function indexToCoord(index: number): Coord {
  if (!Number.isSafeInteger(index) || index < 0 || index >= WORLD_CELL_COUNT) {
    throw new RangeError(`World cell index out of bounds: ${index}`);
  }
  const { origin, size } = WORLD_SPEC;
  const x = index % size.x;
  const z = Math.floor(index / size.x) % size.z;
  const y = Math.floor(index / (size.x * size.z));
  return Object.freeze({ x: x + origin.x, y: y + origin.y, z: z + origin.z });
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}
