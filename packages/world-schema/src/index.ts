export const WORLD_SPEC = Object.freeze({
  version: 1,
  size: Object.freeze({ x: 16, y: 16, z: 16 }),
  origin: Object.freeze({ x: -8, y: 0, z: -8 }),
  voxelSizeMeters: 0.03,
  maxBlocks: 4096,
  footprint: Object.freeze({ minX: -7, maxX: 7, minZ: -7, maxZ: 7 }),
  terrainTopY: 4,
});

export type Coord = Readonly<{ x: number; y: number; z: number }>;
export type BlockId = (typeof BLOCK_IDS)[number];

export const BLOCK_IDS = [
  "grass",
  "dirt",
  "stone",
  "planks",
  "log",
  "leaves",
  "sand",
  "glass",
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
