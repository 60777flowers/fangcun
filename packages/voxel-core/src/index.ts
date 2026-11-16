import {
  BLOCK_DEFS,
  WORLD_CELL_COUNT,
  WORLD_SPEC,
  coordToIndex,
  indexToCoord,
  isBlockId,
  isCoord,
  type BlockId,
  type Coord,
} from "@fangcun/world-schema";
import type { IntentOperation } from "@fangcun/protocol";

export type WorldState = Readonly<{
  worldId: string;
  rev: number;
  /** Dense, x-fastest block array; null means empty. */
  blocks: readonly (BlockId | null)[];
}>;

export type TransactionErrorCode = "invalid_world" | "revision_exhausted" | "stale_revision" | "invalid_operation" | "out_of_bounds" | "protected_terrain" | "occupied" | "empty" | "block_mismatch" | "duplicate_cell" | "too_many_operations";
export type TransactionOptions = Readonly<{ baseRev?: number; actor?: "player" | "ai" | "system" }>;
export type TransactionResult =
  | Readonly<{ ok: true; world: WorldState; rev: number; operations: readonly IntentOperation[] }>
  | Readonly<{ ok: false; code: TransactionErrorCode; operationIndex?: number }>;

const MAX_TRANSACTION_OPERATIONS = 256;

export function createEmptyWorld(worldId = "local-world"): WorldState {
  if (typeof worldId !== "string" || worldId.length < 1 || worldId.length > 128) {
    throw new TypeError("worldId must be a non-empty string of at most 128 characters");
  }
  return Object.freeze({ worldId, rev: 0, blocks: Object.freeze(Array<BlockId | null>(WORLD_CELL_COUNT).fill(null)) });
}

/** Deterministic 14x14 island; each terrain column is continuous down to y=0. */
export function createSeedWorld(worldId = "local-world"): WorldState {
  const world = createEmptyWorld(worldId);
  const blocks = [...world.blocks];
  const { footprint } = WORLD_SPEC;
  for (let z = footprint.minZ; z < footprint.maxZ; z += 1) {
    for (let x = footprint.minX; x < footprint.maxX; x += 1) {
      for (let y = 0; y < WORLD_SPEC.terrainTopY; y += 1) {
        const block: BlockId = y === WORLD_SPEC.terrainTopY - 1 ? "grass" : y === 0 ? "stone" : "dirt";
        blocks[coordToIndex({ x, y, z })] = block;
      }
    }
  }
  return Object.freeze({ ...world, blocks: Object.freeze(blocks) });
}

export function getBlock(world: WorldState, coord: Coord): BlockId | null {
  if (!isCoord(coord)) throw new TypeError("coord must contain safe integer x, y and z");
  return world.blocks[coordToIndex(coord)] ?? null;
}

export function applyTransaction(world: WorldState, operations: readonly IntentOperation[], options: TransactionOptions = {}): TransactionResult {
  if (!assertWorldState(world)) return { ok: false, code: "invalid_world" };
  if (world.rev === Number.MAX_SAFE_INTEGER) return { ok: false, code: "revision_exhausted" };
  if (options.baseRev !== undefined && options.baseRev !== world.rev) return { ok: false, code: "stale_revision" };
  const actor = options.actor ?? "player";
  if (actor !== "player" && actor !== "ai" && actor !== "system") return { ok: false, code: "invalid_operation" };
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_TRANSACTION_OPERATIONS) {
    return { ok: false, code: "too_many_operations" };
  }

  const seen = new Set<number>();
  const indexedOperations: Array<{ operation: IntentOperation; index: number }> = [];
  for (let operationIndex = 0; operationIndex < operations.length; operationIndex += 1) {
    const operation = operations[operationIndex];
    if (!operation || (operation.type !== "place" && operation.type !== "break") || !isCoord(operation.at)) {
      return { ok: false, code: "invalid_operation", operationIndex };
    }
    const requestedBlock = operation.type === "place" ? operation.blockId : operation.expectedBlock;
    if (!isBlockId(requestedBlock)) return { ok: false, code: "invalid_operation", operationIndex };
    let index: number;
    try {
      index = coordToIndex(operation.at);
    } catch {
      return { ok: false, code: "out_of_bounds", operationIndex };
    }
    if (seen.has(index)) return { ok: false, code: "duplicate_cell", operationIndex };
    seen.add(index);
    const current = world.blocks[index] ?? null;
    if (operation.at.y < WORLD_SPEC.terrainTopY) return { ok: false, code: "protected_terrain", operationIndex };
    if (operation.type === "place") {
      if (!BLOCK_DEFS[requestedBlock].placeable) return { ok: false, code: "invalid_operation", operationIndex };
      if (current !== null) return { ok: false, code: "occupied", operationIndex };
    } else {
      if (actor === "ai") return { ok: false, code: "invalid_operation", operationIndex };
      if (current === null) return { ok: false, code: "empty", operationIndex };
      if (current !== operation.expectedBlock) return { ok: false, code: "block_mismatch", operationIndex };
    }
    indexedOperations.push({ operation, index });
  }

  const ordered = indexedOperations.sort((left, right) => left.index - right.index);
  const nextBlocks = [...world.blocks];
  for (const { operation, index } of ordered) nextBlocks[index] = operation.type === "place" ? operation.blockId : null;
  const rev = world.rev + 1;
  const nextWorld: WorldState = Object.freeze({ worldId: world.worldId, rev, blocks: Object.freeze(nextBlocks) });
  const canonicalOperations = ordered.map(({ operation }) => Object.freeze({ ...operation, at: Object.freeze({ ...operation.at }) }));
  return { ok: true, world: nextWorld, rev, operations: Object.freeze(canonicalOperations) };
}

/** Maps an integer grid corner to anchor-local meters; y=0 is the tabletop plane. */
export function coordToMeters(coord: Coord): Readonly<{ x: number; y: number; z: number }> {
  if (!isCoord(coord)) throw new TypeError("coord must contain safe integer x, y and z");
  return Object.freeze({
    x: coord.x * WORLD_SPEC.voxelSizeMeters,
    y: coord.y * WORLD_SPEC.voxelSizeMeters,
    z: coord.z * WORLD_SPEC.voxelSizeMeters,
  });
}

export function coordToCenterMeters(coord: Coord): Readonly<{ x: number; y: number; z: number }> {
  const corner = coordToMeters(coord);
  const halfVoxel = WORLD_SPEC.voxelSizeMeters / 2;
  return Object.freeze({ x: corner.x + halfVoxel, y: corner.y + halfVoxel, z: corner.z + halfVoxel });
}

/** Maps an anchor-local point to its containing half-open voxel cell. */
export function metersToCoord(position: Readonly<{ x: number; y: number; z: number }>): Coord {
  if (![position.x, position.y, position.z].every(Number.isFinite)) throw new TypeError("position must be finite");
  const scale = WORLD_SPEC.voxelSizeMeters;
  return Object.freeze({ x: Math.floor(position.x / scale), y: Math.floor(position.y / scale), z: Math.floor(position.z / scale) });
}

export function countBlocks(world: WorldState): number {
  let count = 0;
  for (const block of world.blocks) if (block !== null) count += 1;
  return count;
}

export function assertWorldState(value: unknown): value is WorldState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const world = value as Record<string, unknown>;
  if (typeof world.worldId !== "string" || world.worldId.length < 1 || world.worldId.length > 128) return false;
  if (!Number.isSafeInteger(world.rev) || (world.rev as number) < 0) return false;
  if (!Array.isArray(world.blocks) || world.blocks.length !== WORLD_CELL_COUNT) return false;
  for (let index = 0; index < WORLD_CELL_COUNT; index += 1) {
    if (!Object.hasOwn(world.blocks, index)) return false;
    const block = world.blocks[index];
    if (block !== null && !isBlockId(block)) return false;
  }
  return true;
}

export function worldStateToObject(world: WorldState): Readonly<{ schemaVersion: 1; worldId: string; rev: number; blocks: readonly (BlockId | null)[] }> {
  if (!assertWorldState(world)) throw new TypeError("invalid world state");
  return Object.freeze({ schemaVersion: WORLD_SPEC.version as 1, worldId: world.worldId, rev: world.rev, blocks: Object.freeze([...world.blocks]) });
}

export function worldStateFromObject(value: unknown): WorldState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("invalid world snapshot");
  const snapshot = value as Record<string, unknown>;
  const keys = Object.keys(snapshot).sort();
  if (keys.length !== 4 || keys[0] !== "blocks" || keys[1] !== "rev" || keys[2] !== "schemaVersion" || keys[3] !== "worldId") {
    throw new TypeError("unsupported or invalid world snapshot");
  }
  if (snapshot.schemaVersion !== WORLD_SPEC.version || !assertWorldState({ worldId: snapshot.worldId, rev: snapshot.rev, blocks: snapshot.blocks })) {
    throw new TypeError("unsupported or invalid world snapshot");
  }
  return Object.freeze({ worldId: snapshot.worldId as string, rev: snapshot.rev as number, blocks: Object.freeze([...(snapshot.blocks as (BlockId | null)[])]) });
}

export function indexForCoord(coord: Coord): number {
  return coordToIndex(coord);
}

export function coordForIndex(index: number): Coord {
  return indexToCoord(index);
}
