import { WORLD_SPEC, coordToIndex, isBlockId, isCoord, type BlockId, type Coord } from "@fangcun/world-schema";
import type { IntentOperation } from "@fangcun/protocol";
import { isCanonicalUtc, isGrantActive, isInsidePlot, type CompanionInstance, type HomePlotGrant } from "@fangcun/companion-schema";
import type { WorldState } from "@fangcun/voxel-core";

/** Injectable so browser/node adapters can use WebCrypto/subtle without Node-only imports. */
export type HashCanonicalDiff = (canonicalJson: string) => Promise<string>;

export async function sha256CanonicalDiff(canonicalJson: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("WebCrypto SHA-256 is required for trusted plan hashes");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export type RuntimeErrorCode =
  | "world_mismatch" | "instance_mismatch" | "grant_missing" | "grant_revoked" | "grant_expired"
  | "plan_expired" | "stale_revision" | "out_of_bounds" | "outside_plot" | "occupied"
  | "break_forbidden" | "duplicate_cell" | "block_not_allowed" | "too_many_operations"
  | "daily_budget" | "rate_limited" | "tracking_unready" | "autonomy_paused" | "hash_mismatch";
export type CheckResult = Readonly<{ ok: true }> | Readonly<{ ok: false; code: RuntimeErrorCode; operationIndex?: number }>;

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
  schemaVersion: 1;
  planId: string;
  companionId: string;
  ownerUserId: string;
  worldId: string;
  plotId: string;
  grantId: string;
  grantRev: number;
  baseRev: number;
  scope: "home_plot";
  ops: readonly Extract<IntentOperation, { type: "place" }> [];
  diffHash: string;
  blockCount: number;
  materials: Readonly<Record<string, number>>;
  createdAt: string;
  expiresAt: string;
}>;

export type CanonicalHomeOperationsResult =
  | Readonly<{ ok: true; operations: readonly Extract<IntentOperation, { type: "place" }> []; canonicalJson: string }>
  | Readonly<{ ok: false; code: RuntimeErrorCode; operationIndex?: number }>;

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
  candidateHeight: number;
  maxCandidateChecks: number;
  minBuildY: number;
  maxHomeBlocks: number;
  planTtlMs: number;
}>;

export const DEFAULT_HOME_RUNTIME_LIMITS: HomeRuntimeLimits = Object.freeze({
  candidateWidth: 4,
  candidateDepth: 4,
  candidateHeight: 4,
  maxCandidateChecks: 256,
  minBuildY: WORLD_SPEC.terrainTopY,
  maxHomeBlocks: 64,
  planTtlMs: 5 * 60 * 1000,
});

function displayId(value: string): string {
  // Display/candidate identity only. Authorization uses exact owner + worldd stored grant + SHA-256.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export type CandidateOptions = Readonly<{
  width?: number;
  depth?: number;
  height?: number;
  maxResults?: number;
  maxCandidateChecks?: number;
  minBuildY?: number;
  blockedCells?: readonly Coord[];
}>;

export function findHomeCandidates(world: WorldState, options: CandidateOptions = {}): readonly HomeCandidate[] {
  const width = options.width ?? DEFAULT_HOME_RUNTIME_LIMITS.candidateWidth;
  const depth = options.depth ?? DEFAULT_HOME_RUNTIME_LIMITS.candidateDepth;
  const height = options.height ?? DEFAULT_HOME_RUNTIME_LIMITS.candidateHeight;
  const maxResults = options.maxResults ?? 8;
  const maxChecks = options.maxCandidateChecks ?? DEFAULT_HOME_RUNTIME_LIMITS.maxCandidateChecks;
  const minBuildY = options.minBuildY ?? DEFAULT_HOME_RUNTIME_LIMITS.minBuildY;
  if (!Number.isSafeInteger(width) || width < 2 || width > 6 || !Number.isSafeInteger(depth) || depth < 2 || depth > 6
    || !Number.isSafeInteger(height) || height < 2 || height > 8 || !Number.isSafeInteger(maxResults) || maxResults < 1 || maxResults > 32
    || !Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 1024 || minBuildY !== WORLD_SPEC.terrainTopY
    || !world.blocks || world.blocks.length !== WORLD_SPEC.maxBlocks) return Object.freeze([]);

  const blocked = new Set<number>();
  for (const coord of options.blockedCells ?? []) {
    try { blocked.add(coordToIndex(coord)); } catch { return Object.freeze([]); }
  }
  const { footprint } = WORLD_SPEC;
  const candidates: HomeCandidate[] = [];
  let checked = 0;
  for (let minZ = footprint.minZ; minZ + depth <= footprint.maxZ && checked < maxChecks; minZ += 1) {
    for (let minX = footprint.minX; minX + width <= footprint.maxX && checked < maxChecks; minX += 1) {
      checked += 1;
      let clear = true;
      for (let z = minZ; z < minZ + depth && clear; z += 1) {
        for (let x = minX; x < minX + width && clear; x += 1) {
          if (world.blocks[coordToIndex({ x, y: minBuildY - 1, z })] === null) { clear = false; break; }
          for (let y = minBuildY; y < minBuildY + height; y += 1) {
            const index = coordToIndex({ x, y, z });
            if (world.blocks[index] !== null || blocked.has(index)) { clear = false; break; }
          }
        }
      }
      if (!clear) continue;
      const centerX = minX + width / 2;
      const centerZ = minZ + depth / 2;
      const score = Math.abs(centerX) + Math.abs(centerZ);
      const min = Object.freeze({ x: minX, y: minBuildY, z: minZ });
      const maxExclusive = Object.freeze({ x: minX + width, y: minBuildY + height, z: minZ + depth });
      const candidateId = `candidate:${displayId(`${world.worldId}:${world.rev}:${minX}:${minBuildY}:${minZ}:${width}:${height}:${depth}`)}`;
      candidates.push(Object.freeze({ candidateId, worldId: world.worldId, observedRev: world.rev, origin: min, bounds: Object.freeze({ min, maxExclusive }), score, reason: "clear-supported-and-near-center" }));
    }
  }
  return Object.freeze(candidates.sort((a, b) => a.score - b.score || a.origin.z - b.origin.z || a.origin.x - b.origin.x).slice(0, maxResults));
}

export function findHomeCandidate(world: WorldState, options: CandidateOptions = {}): HomeCandidate | null {
  return findHomeCandidates(world, { ...options, maxResults: 1 })[0] ?? null;
}

/** A stale candidate is rejected; this helper does NOT authenticate the user or issue a grant. */
export function isHomeCandidateApprovable(world: WorldState, candidate: HomeCandidate, authenticatedOwnerUserId: string, companionId: string, blockedCells: readonly Coord[] = []): boolean {
  if (!authenticatedOwnerUserId || !companionId || candidate.worldId !== world.worldId || candidate.observedRev !== world.rev) return false;
  const expected = findHomeCandidates(world, { width: candidate.bounds.maxExclusive.x - candidate.bounds.min.x, depth: candidate.bounds.maxExclusive.z - candidate.bounds.min.z, height: candidate.bounds.maxExclusive.y - candidate.bounds.min.y, maxResults: 32, blockedCells })
    .find((entry) => entry.candidateId === candidate.candidateId);
  return !!expected && expected.origin.x === candidate.origin.x && expected.origin.y === candidate.origin.y && expected.origin.z === candidate.origin.z
    && expected.bounds.min.x === candidate.bounds.min.x && expected.bounds.min.y === candidate.bounds.min.y && expected.bounds.min.z === candidate.bounds.min.z
    && expected.bounds.maxExclusive.x === candidate.bounds.maxExclusive.x && expected.bounds.maxExclusive.y === candidate.bounds.maxExclusive.y && expected.bounds.maxExclusive.z === candidate.bounds.maxExclusive.z;
}

export type CanonicalHomePlanInput = Readonly<{
  planId: string;
  companionId: string;
  ownerUserId: string;
  worldId: string;
  plotId: string;
  grantId: string;
  grantRev: number;
  baseRev: number;
  createdAt: string;
  expiresAt: string;
  operations: readonly IntentOperation[];
}>;

export function canonicalizeHomeOperations(operations: readonly IntentOperation[], maxOperations = 64): CanonicalHomeOperationsResult {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > maxOperations || maxOperations > 256) return { ok: false, code: "too_many_operations" };
  const indexed: Array<{ op: Extract<IntentOperation, { type: "place" }>; index: number }> = [];
  const seen = new Set<number>();
  for (let i = 0; i < operations.length; i += 1) {
    const op = operations[i];
    if (!op || op.type !== "place") return { ok: false, code: "break_forbidden", operationIndex: i };
    if (!isBlockId(op.blockId)) return { ok: false, code: "block_not_allowed", operationIndex: i };
    let index: number;
    try { index = coordToIndex(op.at); } catch { return { ok: false, code: "out_of_bounds", operationIndex: i }; }
    if (op.at.y < WORLD_SPEC.terrainTopY) return { ok: false, code: "out_of_bounds", operationIndex: i };
    if (seen.has(index)) return { ok: false, code: "duplicate_cell", operationIndex: i };
    seen.add(index);
    indexed.push({ op: Object.freeze({ type: "place", at: Object.freeze({ ...op.at }), blockId: op.blockId }), index });
  }
  indexed.sort((a, b) => a.index - b.index);
  const canonical = indexed.map(({ op }) => Object.freeze({ type: op.type, x: op.at.x, y: op.at.y, z: op.at.z, blockId: op.blockId }));
  return { ok: true, operations: Object.freeze(indexed.map(({ op }) => op)), canonicalJson: JSON.stringify(canonical) };
}

export async function canonicalizeHomePlan(input: CanonicalHomePlanInput, hashCanonicalDiff: HashCanonicalDiff = sha256CanonicalDiff): Promise<HomeBuildPlan | null> {
  if (!isCanonicalUtc(input.createdAt) || !isCanonicalUtc(input.expiresAt) || Date.parse(input.expiresAt) <= Date.parse(input.createdAt)
    || !Number.isSafeInteger(input.baseRev) || input.baseRev < 0 || !Number.isSafeInteger(input.grantRev) || input.grantRev < 1) return null;
  const canonical = canonicalizeHomeOperations(input.operations);
  if (!canonical.ok) return null;
  const diffHash = await hashCanonicalDiff(canonical.canonicalJson);
  if (!/^sha256:[0-9a-f]{64}$/.test(diffHash)) return null;
  const materials: Record<string, number> = {};
  for (const op of canonical.operations) materials[op.blockId] = (materials[op.blockId] ?? 0) + 1;
  return Object.freeze({ schemaVersion: 1, ...input, scope: "home_plot", ops: canonical.operations, diffHash, blockCount: canonical.operations.length, materials: Object.freeze(materials) });
}

function insideGrant(grant: HomePlotGrant, at: Coord): boolean {
  return isInsidePlot(grant, at) && at.y >= WORLD_SPEC.terrainTopY;
}

export async function buildStarterHomePlan(world: WorldState, grant: HomePlotGrant, now = new Date(), hashCanonicalDiff: HashCanonicalDiff = sha256CanonicalDiff): Promise<HomeBuildPlan | null> {
  if (grant.worldId !== world.worldId || !isGrantActive(grant, now.getTime()) || grant.maxBlocksPerPlan < 1) return null;
  const { min } = grant.bounds;
  const x = min.x;
  const z = min.z;
  const y = Math.max(min.y, WORLD_SPEC.terrainTopY);
  const operations: IntentOperation[] = [];
  // Tiny open-front 2x2 shelter with a low roof; deliberately stays below the 32-block plan cap.
  for (let dx = 0; dx < 2; dx += 1) for (let dz = 0; dz < 2; dz += 1) operations.push({ type: "place", at: { x: x + dx, y, z: z + dz }, blockId: "planks" });
  operations.push({ type: "place", at: { x, y: y + 1, z }, blockId: "planks" });
  operations.push({ type: "place", at: { x: x + 1, y: y + 1, z }, blockId: "glass" });
  operations.push({ type: "place", at: { x, y: y + 1, z: z + 1 }, blockId: "planks" });
  operations.push({ type: "place", at: { x: x + 1, y: y + 1, z: z + 1 }, blockId: "planks" });
  for (let dx = 0; dx < 2; dx += 1) for (let dz = 0; dz < 2; dz += 1) operations.push({ type: "place", at: { x: x + dx, y: y + 2, z: z + dz }, blockId: "planks" });
  const planSeed = `${world.worldId}:${grant.companionId}:${grant.plotId}:${grant.grantId}:${grant.grantRev}:${world.rev}`;
  const preview = await canonicalizeHomeOperations(operations, Math.min(grant.maxBlocksPerPlan, DEFAULT_HOME_RUNTIME_LIMITS.maxHomeBlocks));
  if (!preview.ok) return null;
  const diffHash = await hashCanonicalDiff(preview.canonicalJson);
  if (!/^sha256:[0-9a-f]{64}$/.test(diffHash)) return null;
  const planId = `home:${await hashCanonicalDiff(`${planSeed}:${diffHash}`)}`;
  return canonicalizeHomePlan({ planId, companionId: grant.companionId, ownerUserId: grant.ownerUserId, worldId: world.worldId, plotId: grant.plotId, grantId: grant.grantId, grantRev: grant.grantRev, baseRev: world.rev, createdAt: now.toISOString(), expiresAt: new Date(Math.min(now.getTime() + DEFAULT_HOME_RUNTIME_LIMITS.planTtlMs, Date.parse(grant.expiresAt))).toISOString(), operations }, hashCanonicalDiff);
}

export type HomeAutoCommitContext = Readonly<{
  authenticatedOwnerUserId: string;
  trustedGrant: boolean;
  currentGrantRev: number;
  blocksUsedToday: number;
  rateAvailable: boolean;
  trackingReady: boolean;
  nowMs: number;
}>;

/** Footprint of the v0 readable cottage in world cells (floor is footprint²). */
export const HOUSE_FOOTPRINT = 3;
/** Total plan blocks: 9 floor + 7 wall/door/window + 8 roof = 24 (≤ the 24-block demo budget). */
export const HOUSE_PLAN_BLOCK_COUNT = 24;
/** Seat block the companion places after the queue finishes (one extra placement, not part of the 24). */
export const HOUSE_SEAT_BLOCK_ID = "stairs" as const;

export type HouseBuildPlan = Readonly<{
  origin: Coord;
  bounds: Readonly<{ min: Coord; maxExclusive: Coord }>;
  /** Ordered floor → walls (door gap) → roof; one place op per step. */
  operations: readonly Extract<IntentOperation, { type: "place" }>[];
  blockCount: number;
  /** Interior cell above the floor centre: where the seat block goes. */
  seat: Coord;
  /** Ground-floor centre the companion walks to before sitting. */
  centre: Coord;
}>;

/** The scripted "lazy house" demo: four 2-high corner posts + one seat = 9 blocks. */
export const LAZY_HOUSE_BLOCK_COUNT = 9;

export type LazyHousePlan = Readonly<{
  origin: Coord;
  bounds: Readonly<{ min: Coord; maxExclusive: Coord }>;
  /** Corner-by-corner: bottom then top planks ×4 corners, then the centre stairs seat. */
  operations: readonly Extract<IntentOperation, { type: "place" }>[];
  blockCount: number;
  seat: Coord;
}>;

/**
 * Builds the fixed one-click "懒懒小屋" demo script on an already-validated 3x3
 * footprint: 8 planks (four corners, two stacked each) then 1 `stairs` seat at the
 * footprint centre. Pure; runs through the same step-by-step queue as a real plan.
 */
export function buildLazyHousePlan(footprint: HouseBuildPlan): LazyHousePlan {
  const x = footprint.origin.x;
  const y = footprint.origin.y;
  const z = footprint.origin.z;
  const place = (px: number, py: number, pz: number, blockId: BlockId): Extract<IntentOperation, { type: "place" }> =>
    Object.freeze({ type: "place", at: Object.freeze({ x: px, y: py, z: pz }), blockId });
  const operations: Array<Extract<IntentOperation, { type: "place" }>> = [];
  const corners = [[0, 0], [2, 0], [2, 2], [0, 2]] as const;
  for (const [dx, dz] of corners) {
    operations.push(place(x + dx, y, z + dz, "planks"));
    operations.push(place(x + dx, y + 1, z + dz, "planks"));
  }
  const seat = Object.freeze({ x: x + 1, y, z: z + 1 });
  operations.push(place(seat.x, seat.y, seat.z, "stairs"));
  return Object.freeze({
    origin: footprint.origin,
    bounds: footprint.bounds,
    operations: Object.freeze(operations),
    blockCount: operations.length,
    seat,
  });
}

/**
 * Deterministic v0 cottage script on a 3x3 footprint anchored at `origin` (defaults
 * to the grant origin). Pure and side-effect free.
 */
export function buildHousePlan(grant: HomePlotGrant, origin?: Coord): HouseBuildPlan | null {
  if (!grant || !grant.bounds || !grant.bounds.min || !grant.bounds.maxExclusive) return null;
  const { min, maxExclusive } = grant.bounds;
  if (maxExclusive.x - min.x < HOUSE_FOOTPRINT || maxExclusive.z - min.z < HOUSE_FOOTPRINT
    || maxExclusive.y - min.y < HOUSE_FOOTPRINT) return null;
  const x = origin?.x ?? min.x;
  const y = origin?.y ?? min.y;
  const z = origin?.z ?? min.z;
  // The footprint must fit inside the grant AABB and start on/above the build layer.
  if (x < min.x || z < min.z || y < min.y || y < WORLD_SPEC.terrainTopY
    || x + HOUSE_FOOTPRINT > maxExclusive.x || z + HOUSE_FOOTPRINT > maxExclusive.z
    || y + HOUSE_FOOTPRINT > maxExclusive.y) return null;
  const allowed = new Set(grant.allowedBlockIds);
  const place = (px: number, py: number, pz: number, blockId: BlockId): Extract<IntentOperation, { type: "place" }> =>
    Object.freeze({ type: "place", at: Object.freeze({ x: px, y: py, z: pz }), blockId });
  const operations: Array<Extract<IntentOperation, { type: "place" }>> = [];
  // 1) Floor 3x3 at the plot's first buildable layer.
  for (let dz = 0; dz < HOUSE_FOOTPRINT; dz += 1) {
    for (let dx = 0; dx < HOUSE_FOOTPRINT; dx += 1) operations.push(place(x + dx, y, z + dz, "planks"));
  }
  // 2) Walls at floor+1: a clockwise ring with a front-centre door gap and one glass window.
  const ring = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]] as const;
  for (const [dx, dz] of ring) {
    if (dx === 1 && dz === 0) continue; // door gap
    const isWindow = dx === 2 && dz === 1;
    operations.push(place(x + dx, y + 1, z + dz, isWindow ? "glass" : "planks"));
  }
  // 3) Roof at floor+2: 3x3 minus one skylight corner.
  for (let dz = 0; dz < HOUSE_FOOTPRINT; dz += 1) {
    for (let dx = 0; dx < HOUSE_FOOTPRINT; dx += 1) {
      if (dx === 0 && dz === HOUSE_FOOTPRINT - 1) continue; // skylight
      operations.push(place(x + dx, y + 2, z + dz, "planks"));
    }
  }
  if (operations.length !== HOUSE_PLAN_BLOCK_COUNT) return null;
  // Every planned block must be inside the plot and inside the grant allowlist.
  for (const op of operations) {
    if (!isInsidePlot(grant, op.at) || op.at.y < WORLD_SPEC.terrainTopY || !allowed.has(op.blockId)) return null;
  }
  const frozenOperations = Object.freeze(operations);
  return Object.freeze({
    origin: Object.freeze({ x, y, z }),
    bounds: Object.freeze({
      min: Object.freeze({ x, y, z }),
      maxExclusive: Object.freeze({
        x: x + HOUSE_FOOTPRINT,
        y: y + HOUSE_FOOTPRINT,
        z: z + HOUSE_FOOTPRINT,
      }),
    }),
    operations: frozenOperations,
    blockCount: frozenOperations.length,
    seat: Object.freeze({ x: x + 1, y: y + 1, z: z + 1 }),
    centre: Object.freeze({ x: x + 1, y, z: z + 1 }),
  });
}

/** True when the grant could host a cottage at all (size + allowlist), ignoring occupancy. */
export function canBuildHousePlan(grant: HomePlotGrant): boolean {
  return buildHousePlan(grant) !== null;
}

/** Half-open world cell AABB of every cell the plan will write (walls/roof/floor + seat). */
function planCells(plan: HouseBuildPlan): readonly Coord[] {
  return [...plan.operations.map((operation) => operation.at), plan.seat];
}

/**
 * Scans the grant for a cottage footprint instead of assuming the plot origin: the
 * live demo world already has a house/player blocks near the origin. Candidate
 * origins step by 1 in x/z (≤ (width-2)×(depth-2) ≤ 36 for a v1 grant), ordered by
 * distance to the plot centre with a deterministic z-then-x tie-break; the first
 * candidate whose planned cells and seat cell are all empty wins.
 */
export function findHouseBuildPlan(world: WorldState, grant: HomePlotGrant): HouseBuildPlan | null {
  if (!world || !world.blocks || world.blocks.length !== WORLD_SPEC.maxBlocks || !grant) return null;
  if (!canBuildHousePlan(grant)) return null;
  const { min, maxExclusive } = grant.bounds;
  const maxDx = maxExclusive.x - min.x - HOUSE_FOOTPRINT;
  const maxDz = maxExclusive.z - min.z - HOUSE_FOOTPRINT;
  if (maxDx < 0 || maxDz < 0) return null;
  const centre2X = min.x + maxExclusive.x;
  const centre2Z = min.z + maxExclusive.z;
  const candidates: Array<{ origin: Coord; distance: number }> = [];
  for (let dz = 0; dz <= maxDz; dz += 1) {
    for (let dx = 0; dx <= maxDx; dx += 1) {
      const origin = Object.freeze({ x: min.x + dx, y: min.y, z: min.z + dz });
      const centre2CandidateX = 2 * origin.x + HOUSE_FOOTPRINT;
      const centre2CandidateZ = 2 * origin.z + HOUSE_FOOTPRINT;
      const distance = (centre2CandidateX - centre2X) ** 2 + (centre2CandidateZ - centre2Z) ** 2;
      candidates.push({ origin, distance });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.origin.z - b.origin.z || a.origin.x - b.origin.x);
  for (const candidate of candidates) {
    const plan = buildHousePlan(grant, candidate.origin);
    if (!plan) continue;
    const clear = planCells(plan).every((cell) => world.blocks[coordToIndex(cell)] === null);
    if (clear) return plan;
  }
  return null;
}

/** Preflight only. This never authorizes/persists a commit; worldd must recheck and spend quota atomically. */
export async function checkHomeAutoCommitEligibility(world: WorldState, companion: CompanionInstance, grant: HomePlotGrant, plan: HomeBuildPlan, context: HomeAutoCommitContext, hashCanonicalDiff: HashCanonicalDiff = sha256CanonicalDiff): Promise<CheckResult> {
  if (!context.trustedGrant || context.authenticatedOwnerUserId !== grant.ownerUserId) return { ok: false, code: "grant_missing" };
  if (!isGrantActive(grant, context.nowMs)) return { ok: false, code: grant.revokedAt ? "grant_revoked" : "grant_expired" };
  if (!context.trackingReady) return { ok: false, code: "tracking_unready" };
  if (!companion.autonomyEnabled || companion.state === "paused") return { ok: false, code: "autonomy_paused" };
  if (!context.rateAvailable) return { ok: false, code: "rate_limited" };
  if (grant.grantRev !== context.currentGrantRev || plan.grantRev !== context.currentGrantRev || plan.grantId !== grant.grantId) return { ok: false, code: "grant_revoked" };
  if (companion.companionId !== grant.companionId || companion.ownerUserId !== grant.ownerUserId || companion.worldId !== world.worldId || plan.companionId !== companion.companionId || plan.ownerUserId !== companion.ownerUserId) return { ok: false, code: "instance_mismatch" };
  if (plan.worldId !== world.worldId || plan.plotId !== grant.plotId || plan.scope !== "home_plot") return { ok: false, code: "world_mismatch" };
  if (!Number.isFinite(context.nowMs) || !isCanonicalUtc(plan.createdAt) || !isCanonicalUtc(plan.expiresAt) || context.nowMs < Date.parse(plan.createdAt) || context.nowMs >= Date.parse(plan.expiresAt)) return { ok: false, code: "plan_expired" };
  if (plan.baseRev !== world.rev) return { ok: false, code: "stale_revision" };
  const canonical = canonicalizeHomeOperations(plan.ops);
  if (!canonical.ok) return canonical;
  const hash = await hashCanonicalDiff(canonical.canonicalJson);
  if (!/^sha256:[0-9a-f]{64}$/.test(hash) || hash !== plan.diffHash) return { ok: false, code: "hash_mismatch" };
  if (canonical.operations.length !== plan.blockCount || plan.blockCount > grant.maxBlocksPerPlan || plan.blockCount > DEFAULT_HOME_RUNTIME_LIMITS.maxHomeBlocks) return { ok: false, code: "too_many_operations" };
  if (!Number.isSafeInteger(context.blocksUsedToday) || context.blocksUsedToday < 0 || context.blocksUsedToday + plan.blockCount > grant.maxBlocksPerDay) return { ok: false, code: "daily_budget" };
  for (let i = 0; i < canonical.operations.length; i += 1) {
    const op = canonical.operations[i]!;
    if (!grant.allowedBlockIds.includes(op.blockId)) return { ok: false, code: "block_not_allowed", operationIndex: i };
    if (!insideGrant(grant, op.at)) return { ok: false, code: "outside_plot", operationIndex: i };
    if (world.blocks[coordToIndex(op.at)] !== null) return { ok: false, code: "occupied", operationIndex: i };
  }
  return { ok: true };
}

/** Backward-compatible name; still only a preflight predicate, never an authorization capability. */
export async function isEligibleForHomeAutoCommit(world: WorldState, companion: CompanionInstance, grant: HomePlotGrant, plan: HomeBuildPlan, dailyBlockCount = 0, nowMs = Date.now(), hashCanonicalDiff: HashCanonicalDiff = sha256CanonicalDiff): Promise<boolean> {
  const result = await checkHomeAutoCommitEligibility(world, companion, grant, plan, { authenticatedOwnerUserId: grant.ownerUserId, trustedGrant: true, currentGrantRev: grant.grantRev, blocksUsedToday: dailyBlockCount, rateAvailable: true, trackingReady: true, nowMs }, hashCanonicalDiff);
  return result.ok;
}

export function nextCompanionTick(companion: CompanionInstance, world: WorldState, activePlot?: HomePlotGrant, hasActivePlan = false): TickDecision {
  if (!companion.autonomyEnabled || companion.state === "paused") return Object.freeze({ intents: Object.freeze([] as CompanionIntent[]), waitingForUser: false, reason: "paused" });
  if (!activePlot) {
    const intent: CompanionIntent = Object.freeze({ kind: "choose_home", companionId: companion.companionId, reason: "first_home" });
    return Object.freeze({ intents: Object.freeze([intent]), waitingForUser: true, reason: "plot-not-granted" });
  }
  if (hasActivePlan) return Object.freeze({ intents: Object.freeze([] as CompanionIntent[]), waitingForUser: false, reason: "already-active" });
  return Object.freeze({ intents: Object.freeze([{ kind: "build_home", companionId: companion.companionId, plotId: activePlot.plotId, goal: "starter_home", reason: "I want to make this corner cozy." } as const]), waitingForUser: false, reason: "home-empty" });
}
