import {
  applyTransaction,
  createSeedWorld,
  type TransactionResult,
  type WorldState,
} from "@fangcun/voxel-core";
import type { ClientIntent, CommitMessage, ServerAck } from "@fangcun/protocol";
import { isCanonicalUtc, isGrantActive, validateCompanionInstance, validateHomePlotGrant, type CompanionInstance, type HomePlotGrant } from "@fangcun/companion-schema";
import { buildStarterHomePlan, checkHomeAutoCommitEligibility, findHomeCandidates, isHomeCandidateApprovable, nextCompanionTick, type HashCanonicalDiff, type HomeBuildPlan, type HomeCandidate } from "@fangcun/companion-runtime";

export type HomeCommitDecision = Readonly<{
  accepted: boolean;
  reason?: string;
  world: WorldState;
  commit?: CommitMessage;
  blocksUsedToday: number;
}>;

export type HomeGrantActor = Readonly<{ authenticatedOwnerUserId: string }>;

export type CompanionTickDecision = Readonly<{
  status: "paused" | "home_approval_required" | "no_candidate" | "plan_unavailable" | "committed" | "rejected";
  intents: readonly import("@fangcun/companion-runtime").CompanionIntent[];
  candidate?: HomeCandidate;
  commit?: CommitMessage;
  reason?: string;
}>;

export type IntentDecision = Readonly<{
  ack: ServerAck;
  commit?: CommitMessage;
  world: WorldState;
}>;

type CachedDecision = Readonly<{ requestFingerprint: string; decision: IntentDecision }>;

type WorlddOptions = Readonly<{ worldId?: string; initialWorld?: WorldState; idFactory?: () => string; clock?: () => number; hashCanonicalDiff?: HashCanonicalDiff; ownerUserId?: string; homeGrantIssuerUserIds?: readonly string[] }>;

/** In-memory serialized authority prototype. Durable WAL and session auth are future M3 work. */
export class WorldAuthority {
  #world: WorldState;
  #idFactory: () => string;
  #lastSeq = new Map<string, number>();
  #decisions = new Map<string, Map<number, CachedDecision>>();
  #homeGrants = new Map<string, HomePlotGrant>();
  #homeCompanions = new Map<string, CompanionInstance>();
  #homePlans = new Map<string, string>();
  #homeBlocksUsed = new Map<string, number>();
  #homeBusy = false;
  #lastHomeCommitAt = new Map<string, number>();
  #clock: () => number;
  #hashCanonicalDiff: HashCanonicalDiff;
  #homeGrantIssuerUserIds: ReadonlySet<string>;
  #owners = new Map<string, string>();
  #committedTransactions = new Map<string, IntentDecision>();

  constructor(options: WorlddOptions = {}) {
    this.#world = options.initialWorld ?? createSeedWorld(options.worldId);
    this.#idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
    this.#clock = options.clock ?? Date.now;
    this.#hashCanonicalDiff = options.hashCanonicalDiff ?? (async (canonical) => {
      const subtle = globalThis.crypto?.subtle;
      if (!subtle) throw new Error("WebCrypto SHA-256 required");
      const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonical));
      return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    });
    this.#homeGrantIssuerUserIds = new Set(options.homeGrantIssuerUserIds ?? []);
    if (options.ownerUserId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(options.ownerUserId)) this.#owners.set(this.#world.worldId, options.ownerUserId);
  }

  get snapshot(): WorldState { return this.#world; }


  registerCompanion(instance: CompanionInstance): boolean {
    const parsed = validateCompanionInstance(instance);
    if (!parsed.ok || parsed.value.worldId !== this.#world.worldId || this.#owners.get(parsed.value.worldId) !== parsed.value.ownerUserId
      || this.#homeCompanions.has(parsed.value.companionId)) return false;
    this.#homeCompanions.set(parsed.value.companionId, parsed.value);
    return true;
  }

  approveHomePlot(grant: HomePlotGrant, candidate: HomeCandidate, actor: HomeGrantActor): boolean {
    if (!actor || typeof actor.authenticatedOwnerUserId !== "string" || !grant || typeof grant !== "object"
      || !candidate || typeof candidate !== "object" || !candidate.bounds || !grant.bounds
      || !candidate.bounds.min || !candidate.bounds.maxExclusive || !grant.bounds.min || !grant.bounds.maxExclusive
      || !Number.isSafeInteger(candidate.observedRev) || typeof candidate.candidateId !== "string") return false;
    const authenticatedOwnerUserId = actor.authenticatedOwnerUserId;
    if (!authenticatedOwnerUserId || !this.#homeGrantIssuerUserIds.has(authenticatedOwnerUserId)
      || authenticatedOwnerUserId !== grant.ownerUserId || this.#owners.get(grant.worldId) !== authenticatedOwnerUserId || grant.worldId !== this.#world.worldId
      || !isGrantActive(grant, this.#clock())
      || candidate.bounds.min.x !== grant.bounds.min.x || candidate.bounds.min.y !== grant.bounds.min.y || candidate.bounds.min.z !== grant.bounds.min.z
      || candidate.bounds.maxExclusive.x !== grant.bounds.maxExclusive.x || candidate.bounds.maxExclusive.y !== grant.bounds.maxExclusive.y || candidate.bounds.maxExclusive.z !== grant.bounds.maxExclusive.z
      || !isHomeCandidateApprovable(this.#world, candidate, authenticatedOwnerUserId, grant.companionId)) return false;
    const parsed = validateHomePlotGrant(grant);
    const companion = this.#homeCompanions.get(grant.companionId);
    if (!parsed.ok || parsed.value.approvedByUserId !== authenticatedOwnerUserId || !companion
      || companion.ownerUserId !== parsed.value.ownerUserId || companion.worldId !== parsed.value.worldId) return false;
    const existing = this.#homeGrants.get(grant.plotId);
    if (existing && (existing.grantRev >= grant.grantRev || existing.grantId !== grant.grantId
      || existing.ownerUserId !== grant.ownerUserId || existing.worldId !== grant.worldId || existing.companionId !== grant.companionId)) return false;
    for (const other of this.#homeGrants.values()) {
      if (other.grantId === grant.grantId && other.grantRev < grant.grantRev) continue;
      if (other.revokedAt || Date.parse(other.expiresAt) <= this.#clock()) continue;
      if (other.ownerUserId !== grant.ownerUserId || other.worldId !== grant.worldId || other.plotId === grant.plotId) return false;
      if (other.bounds.min.x < grant.bounds.maxExclusive.x && grant.bounds.min.x < other.bounds.maxExclusive.x
        && other.bounds.min.y < grant.bounds.maxExclusive.y && grant.bounds.min.y < other.bounds.maxExclusive.y
        && other.bounds.min.z < grant.bounds.maxExclusive.z && grant.bounds.min.z < other.bounds.maxExclusive.z) return false;
    }
    this.#homeGrants.set(grant.plotId, parsed.value);
    return true;
  }

  /**
   * Trusted restore path for a grant already persisted by the authoritative Host store.
   * Skips candidate re-derivation (the plot was approved earlier) but still validates
   * shape, owner/companion binding and overlap, so a corrupted store cannot widen access.
   */
  restoreHomeGrant(grant: HomePlotGrant): boolean {
    const parsed = validateHomePlotGrant(grant);
    if (!parsed.ok) return false;
    const value = parsed.value;
    const companion = this.#homeCompanions.get(value.companionId);
    if (!companion || companion.ownerUserId !== value.ownerUserId || companion.worldId !== value.worldId
      || value.worldId !== this.#world.worldId || this.#owners.get(value.worldId) !== value.ownerUserId) return false;
    if (this.#homeGrants.has(value.plotId)) return false;
    for (const other of this.#homeGrants.values()) {
      if (other.revokedAt || Date.parse(other.expiresAt) <= this.#clock()) continue;
      if (other.plotId === value.plotId) return false;
      if (other.bounds.min.x < value.bounds.maxExclusive.x && value.bounds.min.x < other.bounds.maxExclusive.x
        && other.bounds.min.y < value.bounds.maxExclusive.y && value.bounds.min.y < other.bounds.maxExclusive.y
        && other.bounds.min.z < value.bounds.maxExclusive.z && value.bounds.min.z < other.bounds.maxExclusive.z) return false;
    }
    this.#homeGrants.set(value.plotId, value);
    return true;
  }

  revokeHomeGrant(plotId: string, actor: HomeGrantActor, revokedAt?: string): boolean {
    if (!actor || typeof actor.authenticatedOwnerUserId !== "string") return false;
    const ownerUserId = actor.authenticatedOwnerUserId;
    const grant = this.#homeGrants.get(plotId);
    if (!grant || grant.ownerUserId !== ownerUserId || this.#owners.get(grant.worldId) !== ownerUserId || !this.#homeGrantIssuerUserIds.has(ownerUserId) || grant.revokedAt
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(ownerUserId)) return false;
    const clockNow = this.#clock();
    if (!Number.isFinite(clockNow) || clockNow < 0) return false;
    const revokedAtValue = revokedAt ?? new Date(clockNow).toISOString();
    if (!isCanonicalUtc(revokedAtValue) || Date.parse(revokedAtValue) < Date.parse(grant.createdAt) || Date.parse(revokedAtValue) > Date.parse(grant.expiresAt) || Date.parse(revokedAtValue) > clockNow) return false;
    this.#homeGrants.set(plotId, Object.freeze({ ...grant, revokedAt: revokedAtValue }));
    return true;
  }

  async runCompanionTick(actor: HomeGrantActor, options: Readonly<{ trackingReady: boolean }>): Promise<CompanionTickDecision> {
    if (!actor || typeof actor.authenticatedOwnerUserId !== "string" || !options || typeof options.trackingReady !== "boolean"
      || this.#owners.get(this.#world.worldId) !== actor.authenticatedOwnerUserId) return { status: "rejected", intents: [], reason: "owner_mismatch" };
    const companion = [...this.#homeCompanions.values()].find((instance) => instance.ownerUserId === actor.authenticatedOwnerUserId && instance.worldId === this.#world.worldId);
    if (!companion) return { status: "rejected", intents: [], reason: "companion_missing" };
    if (!companion.autonomyEnabled || companion.state === "paused" || !options.trackingReady) return { status: "paused", intents: [], reason: "autonomy_or_tracking_paused" };
    const activeGrant = [...this.#homeGrants.values()].find((grant) => grant.ownerUserId === companion.ownerUserId && grant.companionId === companion.companionId && isGrantActive(grant, this.#clock()));
    if (!activeGrant) {
      const candidate = findHomeCandidates(this.#world)[0];
      const tick = nextCompanionTick(companion, this.#world);
      return candidate
        ? { status: "home_approval_required", intents: tick.intents, candidate }
        : { status: "no_candidate", intents: tick.intents, reason: "no_clear_supported_plot" };
    }
    const tick = nextCompanionTick(companion, this.#world, activeGrant);
    if (tick.reason === "paused" || tick.reason === "already-active") return { status: "paused", intents: tick.intents, reason: tick.reason };
    const nowMs = this.#clock();
    const plan = await buildStarterHomePlan(this.#world, activeGrant, new Date(nowMs), this.#hashCanonicalDiff);
    if (!plan) return { status: "plan_unavailable", intents: tick.intents, reason: "no_safe_home_plan" };
    const result = await this.commitHomePlan(plan, actor, { trackingReady: options.trackingReady });
    if (!result.accepted || !result.commit) return { status: "rejected", intents: tick.intents, reason: result.reason ?? "commit_rejected" };
    return { status: "committed", intents: tick.intents, commit: result.commit };
  }

  async commitHomePlan(plan: HomeBuildPlan, actor: HomeGrantActor, options: Readonly<{ trackingReady: boolean }>): Promise<HomeCommitDecision> {
    if (!actor || typeof actor.authenticatedOwnerUserId !== "string" || !options || typeof options.trackingReady !== "boolean") return { accepted: false, reason: "grant_missing", world: this.#world, blocksUsedToday: 0 };
    if (this.#homeBusy) return { accepted: false, reason: "rate_limited", world: this.#world, blocksUsedToday: 0 };
    this.#homeBusy = true;
    try {
      // Keep a deep, immutable snapshot across async hashing; never commit caller-owned arrays.
      if (!plan || typeof plan !== "object" || !Array.isArray(plan.ops) || plan.ops.length < 1 || plan.ops.length > 64
        || typeof plan.planId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(plan.planId)
        || !Number.isSafeInteger(plan.blockCount) || plan.blockCount < 1 || !plan.materials || typeof plan.materials !== "object" || Array.isArray(plan.materials)
        || !Number.isSafeInteger(plan.baseRev) || !Number.isSafeInteger(plan.grantRev)) {
        return { accepted: false, reason: "invalid_plan", world: this.#world, blocksUsedToday: 0 };
      }
      const nowMs = this.#clock();
      if (typeof options.trackingReady !== "boolean") return { accepted: false, reason: "tracking_unready", world: this.#world, blocksUsedToday: 0 };
      if (!Number.isFinite(nowMs) || nowMs < 0 || !Number.isFinite(new Date(nowMs).getTime())) return { accepted: false, reason: "plan_expired", world: this.#world, blocksUsedToday: 0 };
      const budgetDay = new Date(nowMs).toISOString().slice(0, 10);
      if (!plan.ops.every((op) => !!op && op.type === "place" && !!op.at && typeof op.at === "object"
        && Number.isSafeInteger(op.at.x) && Number.isSafeInteger(op.at.y) && Number.isSafeInteger(op.at.z)
        && typeof op.blockId === "string")) return { accepted: false, reason: "invalid_plan", world: this.#world, blocksUsedToday: 0 };
      const planSnapshot = Object.freeze({
        ...plan,
        ops: Object.freeze(plan.ops.map((op) => Object.freeze({ ...op, at: Object.freeze({ ...op.at }) }))),
        materials: Object.freeze({ ...plan.materials }),
      }) as HomeBuildPlan;
      const budgetKey = `${planSnapshot.plotId}:${budgetDay}`;
      const rateKey = budgetKey;
      const alreadyCommitted = this.#homePlans.get(planSnapshot.planId);
      if (alreadyCommitted) return { accepted: false, reason: "duplicate_plan", world: this.#world, blocksUsedToday: this.#homeBlocksUsed.get(budgetKey) ?? 0 };
      const grant = this.#homeGrants.get(planSnapshot.plotId);
      const companion = this.#homeCompanions.get(planSnapshot.companionId);
      if (!grant || !companion) return { accepted: false, reason: "grant_missing", world: this.#world, blocksUsedToday: 0 };
      const blocksUsedToday = this.#homeBlocksUsed.get(budgetKey) ?? 0;
      const lastCommitAt = this.#lastHomeCommitAt.get(rateKey) ?? Number.NEGATIVE_INFINITY;
      if (nowMs - lastCommitAt < 5_000) return { accepted: false, reason: "rate_limited", world: this.#world, blocksUsedToday };
      const worldBeforeHash = this.#world;
      const eligibility = await checkHomeAutoCommitEligibility(worldBeforeHash, companion, grant, planSnapshot, {
        authenticatedOwnerUserId: actor.authenticatedOwnerUserId,
        trustedGrant: this.#homeGrantIssuerUserIds.has(actor.authenticatedOwnerUserId),
        currentGrantRev: grant.grantRev,
        blocksUsedToday,
        rateAvailable: true,
        trackingReady: options.trackingReady,
        nowMs,
      }, this.#hashCanonicalDiff);
      if (!eligibility.ok) return { accepted: false, reason: eligibility.code, world: this.#world, blocksUsedToday };

      // Hashing is asynchronous; reload every trusted record before mutating so a
      // concurrent revoke/rotation/world edit cannot pass a stale preflight.
      const currentGrant = this.#homeGrants.get(planSnapshot.plotId);
      const currentCompanion = this.#homeCompanions.get(planSnapshot.companionId);
      const commitNowMs = this.#clock();
      const commitDay = Number.isFinite(commitNowMs) ? new Date(commitNowMs).toISOString().slice(0, 10) : "";
      const commitBudgetKey = `${planSnapshot.plotId}:${commitDay}`;
      const commitBlocksUsedToday = this.#homeBlocksUsed.get(commitBudgetKey) ?? 0;
      if (!currentGrant || currentGrant.grantId !== grant.grantId || currentGrant.grantRev !== planSnapshot.grantRev || !isGrantActive(currentGrant, commitNowMs)
        || !currentCompanion || currentCompanion.ownerUserId !== actor.authenticatedOwnerUserId || currentCompanion.worldId !== this.#world.worldId
        || currentCompanion.state !== companion.state || currentCompanion.autonomyEnabled !== companion.autonomyEnabled
        || this.#world !== worldBeforeHash || this.#world.rev !== planSnapshot.baseRev || commitDay !== budgetDay || commitBlocksUsedToday !== blocksUsedToday || (this.#homeBlocksUsed.get(budgetKey) ?? 0) !== blocksUsedToday || (this.#lastHomeCommitAt.get(rateKey) ?? Number.NEGATIVE_INFINITY) !== lastCommitAt) {
        return { accepted: false, reason: "stale_revision", world: this.#world, blocksUsedToday: commitBlocksUsedToday };
      }
      if (!actor.authenticatedOwnerUserId || !this.#homeGrantIssuerUserIds.has(actor.authenticatedOwnerUserId)
        || actor.authenticatedOwnerUserId !== currentGrant.ownerUserId || currentGrant.approvedByUserId !== actor.authenticatedOwnerUserId || this.#owners.get(currentGrant.worldId) !== actor.authenticatedOwnerUserId
        || !currentCompanion.autonomyEnabled || currentCompanion.state === "paused") {
        return { accepted: false, reason: "grant_missing", world: this.#world, blocksUsedToday };
      }
      if (!options.trackingReady) return { accepted: false, reason: "tracking_unready", world: this.#world, blocksUsedToday };
      if (currentGrant.revokedAt) return { accepted: false, reason: "grant_revoked", world: this.#world, blocksUsedToday };
      if (!Number.isFinite(commitNowMs) || Date.parse(currentGrant.expiresAt) <= commitNowMs || Date.parse(planSnapshot.expiresAt) <= commitNowMs) return { accepted: false, reason: "plan_expired", world: this.#world, blocksUsedToday };
      if (blocksUsedToday + planSnapshot.blockCount > currentGrant.maxBlocksPerDay || planSnapshot.blockCount > currentGrant.maxBlocksPerPlan) return { accepted: false, reason: "daily_budget", world: this.#world, blocksUsedToday };
      // applyTransaction synchronously rechecks bounds, occupancy, actor policy and baseRev.
      const result = applyTransaction(this.#world, planSnapshot.ops, { baseRev: planSnapshot.baseRev, actor: "ai" });
      if (!result.ok) return { accepted: false, reason: result.code, world: this.#world, blocksUsedToday };
      let txId: string;
      try {
        txId = this.#idFactory();
        if (!txId || txId.length > 128) throw new TypeError("invalid txId");
      } catch {
        return { accepted: false, reason: "commit_prepare_failed", world: this.#world, blocksUsedToday };
      }
      const commit: CommitMessage = Object.freeze({ protocolVersion: 1, type: "commit", worldId: this.#world.worldId, rev: result.rev, txId, actor: "ai", operations: result.operations });
      // Only publish after authorization, budget recheck, transaction and envelope preparation succeeded.
      this.#world = result.world;
      this.#homeBlocksUsed.set(commitBudgetKey, commitBlocksUsedToday + planSnapshot.blockCount);
      this.#lastHomeCommitAt.set(commitBudgetKey, commitNowMs);
      this.#homePlans.set(planSnapshot.planId, txId);
      return { accepted: true, world: this.#world, commit, blocksUsedToday: blocksUsedToday + planSnapshot.blockCount };
    } finally {
      this.#homeBusy = false;
    }
  }

  /**
   * Clears per-client replay state. Sequence numbers are scoped to one live
   * connection, so a reconnecting client starts again at seq 1.
   */
  resetClientSequence(clientId: string): void {
    this.#lastSeq.delete(clientId);
    this.#decisions.delete(clientId);
  }

  handleIntent(intent: ClientIntent): IntentDecision {
    const fingerprint = JSON.stringify(intent);
    let clientCache = this.#decisions.get(intent.clientId);
    if (!clientCache) {
      clientCache = new Map();
      this.#decisions.set(intent.clientId, clientCache);
    }
    const duplicate = clientCache.get(intent.seq);
    if (duplicate) {
      if (duplicate.requestFingerprint === fingerprint) return duplicate.decision;
      return this.#reject(intent.seq, "sequence_reuse_with_different_payload");
    }

    const expectedSeq = (this.#lastSeq.get(intent.clientId) ?? 0) + 1;
    if (intent.seq !== expectedSeq) return this.#remember(clientCache, intent, fingerprint, this.#reject(intent.seq, "sequence_gap"));
    if (intent.worldId !== this.#world.worldId) return this.#remember(clientCache, intent, fingerprint, this.#reject(intent.seq, "world_mismatch"));
    if (intent.baseRev !== this.#world.rev) return this.#remember(clientCache, intent, fingerprint, this.#reject(intent.seq, "stale_revision"));

    const result: TransactionResult = applyTransaction(this.#world, [intent.operation], { baseRev: intent.baseRev, actor: "player" });
    if (!result.ok) return this.#remember(clientCache, intent, fingerprint, this.#reject(intent.seq, result.code));

    let commit: CommitMessage;
    try {
      const txId = this.#idFactory();
      if (typeof txId !== "string" || txId.length < 1 || txId.length > 128) throw new TypeError("invalid txId");
      commit = Object.freeze({
        protocolVersion: 1,
        type: "commit",
        worldId: result.world.worldId,
        rev: result.rev,
        txId,
        actor: "player",
        operations: result.operations,
      });
    } catch {
      // Preparation failures are transient infrastructure errors: do not consume seq or cache them.
      return this.#reject(intent.seq, "commit_prepare_failed");
    }
    const decision: IntentDecision = Object.freeze({
      ack: Object.freeze({ protocolVersion: 1, type: "ack", worldId: this.#world.worldId, seq: intent.seq, accepted: true, committedRev: result.rev }),
      commit,
      world: result.world,
    });
    // Publish all success state only after commit envelope and replay cache are ready.
    this.#world = result.world;
    this.#lastSeq.set(intent.clientId, intent.seq);
    clientCache.set(intent.seq, Object.freeze({ requestFingerprint: fingerprint, decision }));
    return decision;
  }

  #reject(seq: number, reason: string): IntentDecision {
    return Object.freeze({ ack: Object.freeze({ protocolVersion: 1, type: "ack", worldId: this.#world.worldId, seq, accepted: false, reason, committedRev: this.#world.rev }), world: this.#world });
  }

  #remember(cache: Map<number, CachedDecision>, intent: ClientIntent, fingerprint: string, decision: IntentDecision): IntentDecision {
    if (intent.seq === (this.#lastSeq.get(intent.clientId) ?? 0) + 1) {
      this.#lastSeq.set(intent.clientId, intent.seq);
      cache.set(intent.seq, Object.freeze({ requestFingerprint: fingerprint, decision }));
    }
    return decision;
  }
}
