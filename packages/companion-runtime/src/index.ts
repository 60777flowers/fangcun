import { WORLD_SPEC, coordToIndex, type BlockId, type Coord } from "@fangcun/world-schema";
import type { IntentOperation } from "@fangcun/protocol";
import { isGrantActive, isInsidePlot, type CompanionInstance, type HomePlotGrant } from "@fangcun/companion-schema";
import type { WorldState } from "@fangcun/voxel-core";

export type RuntimeErrorCode =
  | "world_mismatch" | "instance_mismatch" | "grant_missing" | "grant_revoked" | "grant_expired"
  | "plan_expired" | "stale_revision" | "out_of_bounds" | "outside_plot" | "occupied"
  | "break_forbidden" | "duplicate_cell" | "block_not_allowed" | "too_many_operations"
  | "daily_budget" | "rate_limited" | "tracking_unready" | "autonomy_paused" | "hash_mismatch";

export type HomeCandidate = Readonly<{
  candidateId: string;
  worldId: string;
  observedRev: number;
  origin: Coord;
  bounds: Readonly<{ min: Coord; maxExclusive: Coord }>;
  score: number;
  reason: "clear-supported-and-near-center";
}>;

export type HomeBuildPlan = Readonly<{
  planId: string;
  companionId: string;
  ownerUserId: string;
  worldId: string;
  plotId: string;
  baseRev: number;
  scope: "home_plot";
  ops: readonly IntentOperation[];
  diffHash: string;
  blockCount: number;
  materials: Readonly<Record<string, number>>;
  generatedAt: string;
}>;

export type CompanionIntent =
  | Readonly<{ kind: "choose_home"; companionId: string; reason: "first_home" | "improve_home" }>
  | Readonly<{ kind: "build_home"; companionId: string; plotId: string; goal: "starter_home" | "decorate"; reason: string }>
  | Readonly<{ kind: "say"; companionId: string; text: string }>;

export type TickDecision = Readonly<{
  intents: readonly CompanionIntent[];
  waitingForUser: boolean;
  reason: "paused" | "plot-not-granted" | "already-active" | "home-empty" | "idle";
}>;

export type HomeRuntimeLimits = Readonly<{
  candidateWidth: number;
  candidateDepth: number;
  maxCandidateChecks: number;
  minBuildY: number;
  maxHomeBlocks: number;
}>;

export const DEFAULT_HOME_RUNTIME_LIMITS: HomeRuntimeLimits = Object.freeze({
  candidateWidth: 4,
  candidateDepth: 4,
  maxCandidateChecks: 256,
  minBuildY: WORLD_SPEC.terrainTopY,
  maxHomeBlocks: 64,
});

export function findHomeCandidates(world: WorldState, width = 4, depth = 4, maxResults = 8): readonly HomeCandidate[] {
  if (!Number.isSafeInteger(width) || width < 2 || width > 6 || !Number.isSafeInteger(depth) || depth < 2 || depth > 6
    || !Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 32) return Object.freeze([]);
  const { footprint } = WORLD_SPEC;
  const candidates: HomeCandidate[] = [];
  for (let minZ = footprint.minZ; minZ + depth <= footprint.maxZ; minZ += 1) {
    for (let minX = footprint.minX; minX + width <= footprint.maxX; minX += 1) {
      let clear = true;
      for (let z = minZ; z < minZ + depth && clear; z += 1) {
        for (let x = minX; x < minX + width && clear; x += 1) {
          if (world.blocks[coordToIndex({ x, y: WORLD_SPEC.terrainTopY - 1, z })] === null) { clear = false; break; }
          for (let y = WORLD_SPEC.terrainTopY; y < Math.min(WORLD_SPEC.size.y, WORLD_SPEC.terrainTopY + 4); y += 1) {
            if (world.blocks[coordToIndex({ x, y, z })] !== null) { clear = false; break; }
          }
        }
      }
      if (!clear) continue;
      const centerX = minX + width / 2;
      const centerZ = minZ + depth / 2;
      const score = Math.abs(centerX) + Math.abs(centerZ);
      candidates.push(Object.freeze({
        candidateId: stableHash(`${world.worldId}:${world.rev}:${minX}:${WORLD_SPEC.terrainTopY}:${minZ}:${width}:${depth}`),
        worldId: world.worldId,
        observedRev: world.rev,
        origin: Object.freeze({ x: minX, y: WORLD_SPEC.terrainTopY, z: minZ }),
        bounds: Object.freeze({ min: Object.freeze({ x: minX, y: WORLD_SPEC.terrainTopY, z: minZ }), maxExclusive: Object.freeze({ x: minX + width, y: WORLD_SPEC.size.y, z: minZ + depth }) }),
        score,
        reason: "clear-supported-and-near-center",
      }));
    }
  }
  return Object.freeze(candidates.sort((a, b) => a.score - b.score || a.origin.z - b.origin.z || a.origin.x - b.origin.x).slice(0, maxResults));
}

export function findHomeCandidate(world: WorldState, limits: HomeRuntimeLimits = DEFAULT_HOME_RUNTIME_LIMITS): HomeCandidate | null {
  return findHomeCandidates(world, limits.candidateWidth, limits.candidateDepth, 1)[0] ?? null;
}

/** Pure proposal-to-grant check. The authenticated owner must approve in the trusted UI/server path. */
export function isHomeCandidateApprovable(world: WorldState, candidate: HomeCandidate, ownerUserId: string, companionId: string): boolean {
  if (!ownerUserId || !companionId || candidate.worldId !== world.worldId || candidate.observedRev !== world.rev) return false;
  const expected = findHomeCandidates(world, candidate.bounds.maxExclusive.x - candidate.bounds.min.x, candidate.bounds.maxExclusive.z - candidate.bounds.min.z, 32)
    .find((entry) => entry.candidateId === candidate.candidateId);
  return !!expected && expected.origin.x === candidate.origin.x && expected.origin.z === candidate.origin.z;
}

function insideGrant(grant: HomePlotGrant, at: Coord): boolean {
  return isInsidePlot(grant, at) && at.y >= limitsForGrant.minBuildY;
}

const limitsForGrant = Object.freeze({ minBuildY: WORLD_SPEC.terrainTopY });

export function buildStarterHomePlan(world: WorldState, grant: HomePlotGrant, now = new Date()): HomeBuildPlan | null {
  if (grant.worldId !== world.worldId || grant.revokedAt || grant.maxBlocksPerPlan < 1) return null;
  const { min } = grant.bounds;
  const x = min.x;
  const z = min.z;
  const y = Math.max(min.y, WORLD_SPEC.terrainTopY);
  const cells: Array<{ at: Coord; blockId: BlockId }> = [];
  // Tiny open-front 2x2 shelter with a low roof; deliberately stays below the 32-block plan cap.
  for (let dx = 0; dx < 2; dx += 1) for (let dz = 0; dz < 2; dz += 1) cells.push({ at: { x: x + dx, y, z: z + dz }, blockId: "planks" });
  cells.push({ at: { x, y: y + 1, z }, blockId: "planks" });
  cells.push({ at: { x: x + 1, y: y + 1, z }, blockId: "glass" });
  cells.push({ at: { x, y: y + 1, z: z + 1 }, blockId: "planks" });
  cells.push({ at: { x: x + 1, y: y + 1, z: z + 1 }, blockId: "planks" });
  for (let dx = 0; dx < 2; dx += 1) for (let dz = 0; dz < 2; dz += 1) cells.push({ at: { x: x + dx, y: y + 2, z: z + dz }, blockId: "planks" });
  if (cells.length > Math.min(grant.maxBlocksPerPlan, DEFAULT_HOME_RUNTIME_LIMITS.maxHomeBlocks)) return null;

  const unique = new Set<number>();
  for (const cell of cells) {
    const index = coordToIndex(cell.at);
    if (!insideGrant(grant, cell.at) || unique.has(index) || world.blocks[index] !== null || !grant.allowedBlockIds.includes(cell.blockId)) return null;
    unique.add(index);
  }
  const ops: IntentOperation[] = cells.map(({ at, blockId }) => Object.freeze({ type: "place" as const, at: Object.freeze({ ...at }), blockId }));
  const materials: Record<string, number> = {};
  for (const op of ops) if (op.type === "place") materials[op.blockId] = (materials[op.blockId] ?? 0) + 1;
  const canonical = JSON.stringify(ops.map((op) => op.type === "place" ? { type: op.type, x: op.at.x, y: op.at.y, z: op.at.z, blockId: op.blockId } : null));
  const diffHash = stableHash(canonical);
  const planId = stableHash(`${world.worldId}:${grant.companionId}:${grant.plotId}:${world.rev}:${diffHash}`);
  return Object.freeze({ planId, companionId: grant.companionId, ownerUserId: grant.ownerUserId, worldId: world.worldId, plotId: grant.plotId, baseRev: world.rev, scope: "home_plot", ops: Object.freeze(ops), diffHash, blockCount: ops.length, materials: Object.freeze(materials), generatedAt: now.toISOString() });
}

function stableHash(value: string): string {
  // Deterministic 32-bit FNV-1a for idempotency/display only, NOT cryptographic authorization.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function isEligibleForHomeAutoCommit(world: WorldState, companion: CompanionInstance, grant: HomePlotGrant, plan: HomeBuildPlan, dailyBlockCount = 0, nowMs = Date.now()): boolean {
  if (!companion.autonomyEnabled || companion.state === "paused" || companion.companionId !== grant.companionId || companion.ownerUserId !== grant.ownerUserId
    || companion.worldId !== world.worldId || plan.companionId !== companion.companionId || plan.ownerUserId !== companion.ownerUserId
    || plan.worldId !== world.worldId || plan.plotId !== grant.plotId || plan.scope !== "home_plot" || plan.baseRev !== world.rev
    || grant.worldId !== world.worldId || !isGrantActive(grant, nowMs) || !Number.isSafeInteger(dailyBlockCount) || dailyBlockCount < 0
    || dailyBlockCount + plan.blockCount > grant.maxBlocksPerDay || plan.blockCount > grant.maxBlocksPerPlan || plan.blockCount > DEFAULT_HOME_RUNTIME_LIMITS.maxHomeBlocks) return false;
  for (const op of plan.ops) {
    if (op.type !== "place" || !grant.allowedBlockIds.includes(op.blockId) || !insideGrant(grant, op.at)) return false;
    const index = coordToIndex(op.at);
    if (world.blocks[index] !== null) return false;
  }
  const regenerated = buildStarterHomePlan(world, grant, new Date(plan.generatedAt));
  return regenerated?.planId === plan.planId && regenerated.diffHash === plan.diffHash;
}

export function nextCompanionTick(companion: CompanionInstance, world: WorldState, activePlot?: HomePlotGrant, hasActivePlan = false): TickDecision {
  if (!companion.autonomyEnabled || companion.state === "paused") return Object.freeze({ intents: Object.freeze([] as CompanionIntent[]), waitingForUser: false, reason: "paused" });
  if (!activePlot) {
    const intent: CompanionIntent = Object.freeze({ kind: "choose_home", companionId: companion.companionId, reason: "first_home" });
    return Object.freeze({ intents: Object.freeze([intent]), waitingForUser: true, reason: "plot-not-granted" });
  }
  if (hasActivePlan) return Object.freeze({ intents: Object.freeze([] as CompanionIntent[]), waitingForUser: false, reason: "already-active" });
  const plan = buildStarterHomePlan(world, activePlot);
  if (plan) {
    const intent: CompanionIntent = Object.freeze({ kind: "build_home", companionId: companion.companionId, plotId: activePlot.plotId, goal: "starter_home", reason: "I want to make this corner cozy." });
    return Object.freeze({ intents: Object.freeze([intent]), waitingForUser: false, reason: "home-empty" });
  }
  const intent: CompanionIntent = Object.freeze({ kind: "say", companionId: companion.companionId, text: "我的小家已经很温馨啦，我来添点小装饰！" });
  return Object.freeze({ intents: Object.freeze([intent]), waitingForUser: false, reason: "idle" });
}
