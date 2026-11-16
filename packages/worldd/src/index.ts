import {
  applyTransaction,
  createSeedWorld,
  type TransactionResult,
  type WorldState,
} from "@fangcun/voxel-core";
import type { ClientIntent, CommitMessage, ServerAck } from "@fangcun/protocol";

export type IntentDecision = Readonly<{
  ack: ServerAck;
  commit?: CommitMessage;
  world: WorldState;
}>;

type CachedDecision = Readonly<{ requestFingerprint: string; decision: IntentDecision }>;

type WorlddOptions = Readonly<{ worldId?: string; initialWorld?: WorldState; idFactory?: () => string }>;

/** In-memory serialized authority prototype. Durable WAL and session auth are future M3 work. */
export class WorldAuthority {
  #world: WorldState;
  #idFactory: () => string;
  #lastSeq = new Map<string, number>();
  #decisions = new Map<string, Map<number, CachedDecision>>();

  constructor(options: WorlddOptions = {}) {
    this.#world = options.initialWorld ?? createSeedWorld(options.worldId);
    this.#idFactory = options.idFactory ?? (() => globalThis.crypto.randomUUID());
  }

  get snapshot(): WorldState { return this.#world; }

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
