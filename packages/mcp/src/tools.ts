import {
  BLOCK_IDS,
  WORLD_SPEC,
  coordToIndex,
  indexToCoord,
  isBlockId,
  type BlockId,
  type Coord,
} from "@fangcun/world-schema";
import type { HostClient, HostHomeCandidate } from "./host-client.ts";

/** Every player edit made through this server is attributed to this loopback client id. */
export const MCP_CLIENT_ID = "mcp-agent";
const MAX_BLOCKS_ABOVE_TERRAIN = 20;
const MAX_SAY_LENGTH = 80;

// Single source of truth for the tool-call guards: the same WorldSpec the Host validates against.
const X_MIN = WORLD_SPEC.origin.x;
const X_MAX = WORLD_SPEC.origin.x + WORLD_SPEC.size.x - 1;
const Z_MIN = WORLD_SPEC.origin.z;
const Z_MAX = WORLD_SPEC.origin.z + WORLD_SPEC.size.z - 1;
const Y_MIN = WORLD_SPEC.origin.y;
const Y_MAX = WORLD_SPEC.origin.y + WORLD_SPEC.size.y - 1;
const BLOCK_ID_LIST = BLOCK_IDS.join(", ");

export type JsonSchema = Readonly<Record<string, unknown>>;

/** MCP tool descriptor; only `name`, `description` and `inputSchema` are advertised. */
export type McpToolDefinition = Readonly<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}>;

/** A rejected tool argument. The message is written for a model to read and act on. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

type ToolContext = Readonly<{
  host: HostClient;
  clientId: string;
  nextIntentSeq: () => number;
}>;

function integerProperty(minimum: number, maximum: number, description: string): JsonSchema {
  return Object.freeze({ type: "integer", minimum, maximum, description });
}

const EMPTY_INPUT_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: Object.freeze({}),
});

const COORD_PROPERTIES = Object.freeze({
  x: integerProperty(X_MIN, X_MAX, "World cell x."),
  y: integerProperty(Y_MIN, Y_MAX, "World cell y; values below terrainTopY are protected terrain."),
  z: integerProperty(Z_MIN, Z_MAX, "World cell z."),
});

const PLACE_BLOCK_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["x", "y", "z", "blockId"]),
  properties: Object.freeze({
    ...COORD_PROPERTIES,
    blockId: Object.freeze({
      type: "string",
      enum: Object.freeze([...BLOCK_IDS]),
      description: "One of the catalog block ids.",
    }),
  }),
});

const BREAK_BLOCK_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["x", "y", "z"]),
  properties: COORD_PROPERTIES,
});

const HOME_CLAIM_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["candidateId"]),
  properties: Object.freeze({
    candidateId: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: 128,
      description: "Candidate id returned by home_candidates.",
    }),
  }),
});

const COMPANION_SAY_SCHEMA: JsonSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: Object.freeze(["text"]),
  properties: Object.freeze({
    text: Object.freeze({
      type: "string",
      minLength: 1,
      maxLength: MAX_SAY_LENGTH,
      description: "One short line shown in the companion speech bubble.",
    }),
  }),
});

export const TOOL_DEFINITIONS: readonly McpToolDefinition[] = Object.freeze([
  Object.freeze({
    name: "world_observe",
    description: "Read a compact snapshot of the Fangcun world: revision, block count, blocks above the terrain layer, whether the companion has an approved home plot, and any pending home candidate id. Read-only; call it before acting. It never returns user audio, chat transcripts or camera data.",
    inputSchema: EMPTY_INPUT_SCHEMA,
  }),
  Object.freeze({
    name: "home_candidates",
    description: "List the home-plot candidates the Host is currently offering the companion, with bounds and score. Run build_tick first when the list is empty. Read-only; use home_claim to accept one.",
    inputSchema: EMPTY_INPUT_SCHEMA,
  }),
  Object.freeze({
    name: "home_claim",
    description: "Approve a home-plot candidate so the companion may build on that plot, and return the Host's decision with the new world revision. Only pass a candidateId that home_candidates returned; stale ids are rejected by the Host.",
    inputSchema: HOME_CLAIM_SCHEMA,
  }),
  Object.freeze({
    name: "build_tick",
    description: "Run one companion build tick. With an approved home plot the companion places a small structure and reports how many operations committed; without one the tick proposes a home candidate for home_candidates and home_claim. Returns the tick status, committed operation count and world revision.",
    inputSchema: EMPTY_INPUT_SCHEMA,
  }),
  Object.freeze({
    name: "place_block",
    description: "Place one block as the player. Coordinates are world cells: x and z in [-8, 8), y in [0, 16), and y below the terrain top is protected. The block id must come from the schema; the Host rejects occupied cells and returns a revision on success.",
    inputSchema: PLACE_BLOCK_SCHEMA,
  }),
  Object.freeze({
    name: "break_block",
    description: "Break one block as the player, sending the current block as expectedBlock so the Host refuses if the cell changed after the read. Terrain below the terrain top cannot be broken. Returns the removed block id and the new revision.",
    inputSchema: BREAK_BLOCK_SCHEMA,
  }),
  Object.freeze({
    name: "companion_say",
    description: "Make the companion speak one short line in its speech bubble. The text is shown to the user, so keep it friendly, at most 80 characters, and never include private user data.",
    inputSchema: COMPANION_SAY_SCHEMA,
  }),
]);

export const TOOL_NAMES: readonly string[] = Object.freeze(TOOL_DEFINITIONS.map((tool) => tool.name));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArguments(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new ToolInputError("Tool arguments must be a JSON object");
  return value;
}

function assertOnlyKeys(args: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) throw new ToolInputError(`Unexpected argument: ${key}`);
  }
}

function readRequired(args: Record<string, unknown>, key: string): unknown {
  if (!Object.hasOwn(args, key)) throw new ToolInputError(`Missing required argument: ${key}`);
  return args[key];
}

function readInteger(args: Record<string, unknown>, key: string, minimum: number, maximum: number): number {
  const value = readRequired(args, key);
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ToolInputError(`${key} must be an integer`);
  }
  if (value < minimum || value > maximum) {
    throw new ToolInputError(`${key} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function readCoordinate(args: Record<string, unknown>): Coord {
  const x = readInteger(args, "x", X_MIN, X_MAX);
  const y = readInteger(args, "y", Y_MIN, Y_MAX);
  const z = readInteger(args, "z", Z_MIN, Z_MAX);
  return Object.freeze({ x, y, z });
}

function readBlockId(args: Record<string, unknown>): BlockId {
  const value = readRequired(args, "blockId");
  if (!isBlockId(value)) throw new ToolInputError(`blockId must be one of: ${BLOCK_ID_LIST}`);
  return value;
}

function readString(args: Record<string, unknown>, key: string, minLength: number, maxLength: number): string {
  const value = readRequired(args, key);
  if (typeof value !== "string") throw new ToolInputError(`${key} must be a string`);
  if (value.length < minLength || value.length > maxLength) {
    throw new ToolInputError(`${key} must be ${minLength}-${maxLength} characters`);
  }
  return value;
}

function requireBuildHeight(coord: Coord): void {
  // The world owns this rule too, but rejecting early keeps the error text actionable
  // and avoids consuming an intent sequence number for a request that cannot commit.
  if (coord.y < WORLD_SPEC.terrainTopY) {
    throw new ToolInputError(`y must be at least ${WORLD_SPEC.terrainTopY}; the terrain layer is protected`);
  }
}

async function observeWorld(context: ToolContext): Promise<unknown> {
  const state = await context.host.getState();
  let blockCount = 0;
  let blocksAboveTerrainCount = 0;
  const blocksAboveTerrain: Array<Readonly<{ x: number; y: number; z: number; blockId: BlockId }>> = [];
  for (let index = 0; index < state.world.blocks.length; index += 1) {
    const block = state.world.blocks[index] ?? null;
    if (block === null) continue;
    blockCount += 1;
    const coord = indexToCoord(index);
    if (coord.y < WORLD_SPEC.terrainTopY) continue;
    blocksAboveTerrainCount += 1;
    if (blocksAboveTerrain.length < MAX_BLOCKS_ABOVE_TERRAIN) {
      blocksAboveTerrain.push(Object.freeze({ x: coord.x, y: coord.y, z: coord.z, blockId: block }));
    }
  }
  // The Host stores only block ids, not authors, so this list cannot honestly claim
  // "player-placed": it reports every cell above the terrain layer, capped for context size.
  return Object.freeze({
    worldId: state.world.worldId,
    rev: state.world.rev,
    blockCount,
    terrainTopY: WORLD_SPEC.terrainTopY,
    blocksAboveTerrain: Object.freeze(blocksAboveTerrain),
    blocksAboveTerrainTruncated: blocksAboveTerrainCount > MAX_BLOCKS_ABOVE_TERRAIN,
    homeGrantActive: state.homeGrantActive,
    ...(state.candidate ? { candidateId: state.candidate.candidateId } : {}),
  });
}

async function listHomeCandidates(context: ToolContext): Promise<unknown> {
  const state = await context.host.getState();
  const candidates: HostHomeCandidate[] = state.candidate ? [state.candidate] : [];
  return Object.freeze({
    candidates: Object.freeze(candidates.map((candidate) => Object.freeze({
      candidateId: candidate.candidateId,
      bounds: candidate.bounds,
      ...(candidate.score !== undefined ? { score: candidate.score } : {}),
    }))),
  });
}

async function claimHome(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  assertOnlyKeys(args, ["candidateId"]);
  const candidateId = readString(args, "candidateId", 1, 128);
  const approval = await context.host.approveHomeCandidate(candidateId);
  if (!approval.approved) {
    throw new ToolInputError(`Home candidate was not approved: ${candidateId} may be stale or already claimed`);
  }
  return Object.freeze({ approved: true, rev: approval.rev });
}

async function runBuildTick(context: ToolContext): Promise<unknown> {
  const tick = await context.host.companionTick();
  return Object.freeze({ status: tick.status, committedOperations: tick.committedOperations, rev: tick.rev });
}

async function placeBlock(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  assertOnlyKeys(args, ["x", "y", "z", "blockId"]);
  const at = readCoordinate(args);
  const blockId = readBlockId(args);
  requireBuildHeight(at);
  const state = await context.host.getState();
  const current = state.world.blocks[coordToIndex(at)] ?? null;
  if (current !== null) throw new ToolInputError(`Cell (${at.x}, ${at.y}, ${at.z}) already contains ${current}`);
  const outcome = await context.host.sendIntent({
    clientId: context.clientId,
    seq: context.nextIntentSeq(),
    baseRev: state.world.rev,
    operation: Object.freeze({ type: "place", at, blockId }),
  });
  if (!outcome.accepted) throw new ToolInputError(`Host rejected place_block: ${outcome.reason ?? "rejected"}`);
  return Object.freeze({ accepted: true, placed: blockId, at, rev: outcome.rev });
}

async function breakBlock(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  assertOnlyKeys(args, ["x", "y", "z"]);
  const at = readCoordinate(args);
  requireBuildHeight(at);
  const state = await context.host.getState();
  const expectedBlock = state.world.blocks[coordToIndex(at)] ?? null;
  if (expectedBlock === null) throw new ToolInputError(`No block at (${at.x}, ${at.y}, ${at.z})`);
  const outcome = await context.host.sendIntent({
    clientId: context.clientId,
    seq: context.nextIntentSeq(),
    baseRev: state.world.rev,
    operation: Object.freeze({ type: "break", at, expectedBlock }),
  });
  if (!outcome.accepted) throw new ToolInputError(`Host rejected break_block: ${outcome.reason ?? "rejected"}`);
  return Object.freeze({ accepted: true, broke: expectedBlock, at, rev: outcome.rev });
}

async function sayCompanionLine(args: Record<string, unknown>, context: ToolContext): Promise<unknown> {
  assertOnlyKeys(args, ["text"]);
  const text = readString(args, "text", 1, MAX_SAY_LENGTH);
  // The Host trims before broadcasting, so whitespace-only input would fail there late.
  if (text.trim().length === 0) throw new ToolInputError("text must not be blank");
  // A speech bubble is one line; control characters would let model output spoof layout.
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new ToolInputError("text must be a single line without control characters");
  }
  await context.host.companionSay(text);
  return Object.freeze({ said: text });
}

/**
 * Dispatches one tool call. Unknown tools and argument failures throw; the JSON-RPC
 * layer converts thrown errors into isError tool results so the process never crashes.
 */
export async function callTool(name: string, rawArguments: unknown, context: ToolContext): Promise<unknown> {
  const args = readArguments(rawArguments);
  switch (name) {
    case "world_observe":
      assertOnlyKeys(args, []);
      return observeWorld(context);
    case "home_candidates":
      assertOnlyKeys(args, []);
      return listHomeCandidates(context);
    case "home_claim":
      return claimHome(args, context);
    case "build_tick":
      assertOnlyKeys(args, []);
      return runBuildTick(context);
    case "place_block":
      return placeBlock(args, context);
    case "break_block":
      return breakBlock(args, context);
    case "companion_say":
      return sayCompanionLine(args, context);
    default:
      throw new ToolInputError(`Unknown tool: ${name}`);
  }
}
