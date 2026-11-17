import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFileSync, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { BLOCK_IDS, WORLD_SPEC, type Coord } from "@fangcun/world-schema";
import { createSeedWorld, worldStateToObject, type WorldState } from "@fangcun/voxel-core";
import { validateClientIntent, validateClientMessage, type ClientIntent, type CommitMessage, type CompanionActionId, type CompanionStateName, type IntentOperation, type ServerMessage } from "@fangcun/protocol";
import { WorldAuthority, type CompanionTickDecision } from "@fangcun/worldd";
import { buildLazyHousePlan, canBuildHousePlan, findHouseBuildPlan, findHomeCandidates, HOUSE_SEAT_BLOCK_ID, LAZY_HOUSE_BLOCK_COUNT, type HomeCandidate, type HouseBuildPlan } from "@fangcun/companion-runtime";
import { isGrantActive, validateHomePlotGrant, type CompanionInstance, type HomePlotGrant } from "@fangcun/companion-schema";
import { HostStore } from "./persistence.ts";
import {
  COMPANION_ACTION_TTL_MS,
  DEFAULT_PET_NAME,
  PET_ACTIONS,
  validatePetPatch,
  type PetAction,
  type PetPatch,
} from "./pet.ts";
import {
  companionView,
  seedCompanionProfiles,
  validateCompanionPatch,
  type CompanionPatch,
  type CompanionProfile,
  type CompanionView,
} from "./companions.ts";
import {
  addItemToCompanion,
  inventoryEntriesFromCounts,
  ITEM_CATALOG,
  seedUserInventory,
  topUpDemoWarehouse,
  validateGiveRequest,
  WAREHOUSE_SEED_VERSION,
  type UserInventoryEntry,
} from "./items.ts";
import {
  buildLine,
  CHAT_MAX_TEXT_LENGTH,
  COMPANION_HOME_GRANTED_LINE,
  COMPANION_HOME_PROPOSAL_LINE,
  COMPANION_HOUSE_DONE_LINE,
  COMPANION_HOUSE_PROPOSAL_LINE,
  COMPANION_HOUSE_REJECTED_LINE,
  COMPANION_HOUSE_START_LINE,
  COMPANION_HOUSE_STOPPED_LINE,
  COMPANION_LAZY_HOUSE_DONE_LINE,
  COMPANION_LAZY_HOUSE_LINE,
  COMPANION_SAY_MAX_TEXT_LENGTH,
  composeCompanionReply,
  idleLine,
  type ChatMessage,
} from "./persona.ts";
import { WsConnection } from "./websocket.ts";

/**
 * Loopback Host for the Fangcun desktop demo.
 *
 * Implemented here: durable world + commit log in SQLite, one-time pairing code,
 * WebSocket replica protocol (hello/welcome/intent/ack/commit/resync/ping) and
 * the Companion home tick/approval endpoints.
 *
 * NOT implemented yet (documented as pending, not claimed): LAN TLS with pinned
 * fingerprints, plan/approval leases, undo, the DSH/MCP adapter and the Android
 * client. The desktop demo reaches this Host over loopback.
 */

const MAX_HTTP_BODY_BYTES = 8 * 1024;
/**
 * Companion PATCH is the one route allowed to carry an inline avatar: a 64 KiB decoded
 * payload is ~87.4 KB base64, so this route needs a larger cap while every other
 * inspector endpoint keeps the 8 KiB limit.
 */
const MAX_COMPANION_PATCH_BODY_BYTES = 96 * 1024;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_AUTONOMY_INTERVAL_MS = 20_000;
/** 30 messages is about 15 exchanges: enough for a demo without unbounded memory. */
const CHAT_HISTORY_LIMIT = 30;
/** Idle chatter is "occasional": one line every third idle interval, not every tick. */
const AUTONOMY_SAY_EVERY_STEPS = 3;
/** Block-by-block home build pacing; `FANGCUN_BUILD_INTERVAL_MS` overrides it (0 = as fast as possible). */
const DEFAULT_BUILD_INTERVAL_MS = 600;
const HOUSE_PROPOSAL_TTL_MS = 120_000;
/** Self-driven house proposal cadence and backoffs (in-memory only, never persisted). */
const AUTO_HOUSE_PROPOSAL_INTERVAL_MS = 45_000;
const HOUSE_PROPOSAL_REJECT_COOLDOWN_MS = 60_000;
const HOUSE_PROPOSAL_BLOCKED_COOLDOWN_MS = 120_000;
const HOUSE_PROPOSAL_POST_BUILD_COOLDOWN_MS = 120_000;
/**
 * Ports that clients built on undici/Chromium refuse to connect to ("bad port").
 * When the Host is asked for an ephemeral port (`0`), retry rather than hand a test or
 * a browser a URL it can never use.
 */
const CLIENT_BLOCKED_PORTS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95,
  101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179,
  389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601,
  636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080,
]);

const WORLD_SCHEMA_HASH = `sha256:${createHash("sha256").update(JSON.stringify(WORLD_SPEC)).digest("hex")}`;
const BLOCK_CATALOG_HASH = `sha256:${createHash("sha256").update(BLOCK_IDS.join(",")).digest("hex")}`;

type Session = {
  connection: WsConnection;
  clientId: string;
  lastAppliedRev: number;
  authenticated: boolean;
};

type TickOutcome = Readonly<{ result: CompanionTickDecision; world: unknown }>;

/** A companion-highlighted build area waiting for the owner's accept/reject decision. */
type PendingHouseProposal = Readonly<{
  proposalId: string;
  companionId: string;
  bounds: Readonly<{ min: Coord; maxExclusive: Coord }>;
  planBlockCount: number;
  expiresAtMs: number;
}>;

/** In-memory block-by-block queue; dropped on Host shutdown (never resumed). */
type BuildQueueState = {
  companionId: string;
  proposalId: string;
  plotId: string;
  grantId: string;
  grantRev: number;
  ops: readonly Extract<IntentOperation, { type: "place" }>[];
  seat: Coord;
  index: number;
  completedBlocks: number;
  expectedRev: number;
  /** Cancels the scheduled next step (setTimeout clear, or a no-op for a manual scheduler). */
  timer: (() => void) | null;
  /** Which flow produced this queue (the PC/DSH panel uses this to show "演示运行中"). */
  kind: "house" | "lazy-house";
  /** Optional line spoken exactly once after N committed blocks (lazy-house says it after the 8 posts). */
  midLine: Readonly<{ afterBlocks: number; text: string }> | null;
  /** Optional closing line / action (house: done + sit; lazy-house: short line + sit). */
  finishLine: string | null;
  finishAction: CompanionActionId | null;
  /** House places its seat after the plan; lazy-house already has the stairs as its 9th op. */
  placeSeatAfter: boolean;
};

type BuildSummary = Readonly<{
  inProgress: boolean;
  completedBlocks: number;
  totalBlocks: number;
  /** Configured pacing; 0 means "as fast as possible". */
  intervalMs: number;
  lastError: string | null;
  seatPlaced: boolean;
  seatError: string | null;
  /** "lazy-house" while the scripted one-click demo runs (or last ran); null for normal builds. */
  demo: "lazy-house" | null;
}>;

/** In-memory marker of the currently running one-click demo (exposed in GET state.demo). */
type DemoRun = Readonly<{ kind: "lazy-house"; startedAtMs: number }>;

/** Demo-only record of the one-time startup grant migration (in memory for this process). */
type GrantMigration = Readonly<{
  at: number;
  grantId: string;
  from: Readonly<{ min: Coord; maxExclusive: Coord }>;
  to: Readonly<{ min: Coord; maxExclusive: Coord }>;
  reason: "widened_for_clear_footprint" | "relocated_to_clear_site";
}>;

export type PairingCode = Readonly<{ code: string; expiresAtMs: number }>;
export type HostOptions = Readonly<{
  worldId?: string;
  host?: string;
  port?: number;
  dbPath?: string;
  ownerUserId?: string;
  nowMs?: () => number;
  idFactory?: () => string;
  /** Overrides `FANGCUN_AUTONOMY_MS`; 0 disables the self-driving loop. */
  autonomyIntervalMs?: number;
  /** Demo-only readiness probe; production binds this to a fresh authenticated device lease. */
  trackingReady?: () => boolean;
  /** Block-by-block build pacing in ms; 0 builds as fast as possible (tests). */
  buildIntervalMs?: number;
  /**
   * Test seam: drives build-step scheduling. Defaults to setTimeout; tests pass a
   * manual queue so the block sequence does not depend on wall-clock timers.
   */
  buildStepScheduler?: (run: () => void, delayMs: number) => () => void;
  /**
   * Demo-only opt-in: `FANGCUN_DEMO_RELOCATE_GRANT=1` (default off). When on and the
   * grant-wide 3x3 scan finds nothing, startup may widen/relocate the single active
   * grant once so the video demo can still propose. Never production behaviour.
   */
  demoRelocateGrant?: boolean;
}>;
export type HostAddress = Readonly<{ host: string; port: number; worldId: string }>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") return null;
  return /^Bearer (.{16,512})$/.exec(header)?.[1] ?? null;
}

export class FangcunHost {
  #store: HostStore | null = null;
  #authority!: WorldAuthority;
  #server: Server | null = null;
  #worldId: string;
  #host: string;
  #port: number;
  #ownerUserId: string;
  #now: () => number;
  #idFactory: () => string;
  #dbPath: string;
  #sessions = new Set<Session>();
  #tokens = new Map<string, { clientId: string; expiresAtMs: number }>();
  #pairing: PairingCode | null = null;
  #companion: CompanionInstance;
  /** Durable multi-companion list; N entries, seeded with the owner pet + one demo friend. */
  #companionProfiles: readonly CompanionProfile[];
  /** Primary pet appearance scale (the other profile fields live on the profile). */
  #petScale: number;
  /** Host user's item stacks; companion bags live on their profiles. */
  #userItems: Map<string, number>;
  #companionState: CompanionStateName = "idle";
  #lastTick: CompanionTickDecision | null = null;
  #grant: HomePlotGrant | null = null;
  /** Pending house-build proposal (in memory; not persisted). */
  #pendingHouseProposal: PendingHouseProposal | null = null;
  /** Deterministic plan captured with the pending proposal; reused on approval. */
  #pendingHousePlan: HouseBuildPlan | null = null;
  /** Active block-by-block build queue; at most one at a time. */
  #buildQueue: BuildQueueState | null = null;
  #lastBuild: BuildSummary = Object.freeze({
    inProgress: false, completedBlocks: 0, totalBlocks: 0, intervalMs: 0, lastError: null, seatPlaced: false, seatError: null, demo: null,
  });
  /** Self-driven proposal bookkeeping (in memory; documented as non-persistent). */
  #lastHouseProposalAttemptAtMs: number | null = null;
  #houseProposalCooldownUntilMs = 0;
  /** Demo-only opt-in; see {@link HostOptions.demoRelocateGrant}. */
  #demoRelocateGrant: boolean;
  /** The one startup migration this process performed, if any (demo-only visibility). */
  #grantMigration: GrantMigration | null = null;
  /** Active one-click scripted demo (lazy-house / real-house); null when idle. */
  #demoRun: DemoRun | null = null;
  #buildIntervalMs: number;
  #buildStepScheduler: (run: () => void, delayMs: number) => () => void;
  #buildIdleWaiters: Array<(summary: BuildSummary) => void> = [];
  /** Per-companion in-memory chat logs; unknown ids are rejected before use. */
  #chats = new Map<string, ChatMessage[]>();
  #lineIndex = 0;
  #idleLineIndex = 0;
  #trackingReady: () => boolean;
  #autonomyEnabled: boolean;
  #autonomyIntervalMs: number;
  #autonomyLastRunAtMs: number | null = null;
  #autonomyTimer: ReturnType<typeof setInterval> | null = null;
  #autonomySteps = 0;
  #tickCount = 0;
  #tickChain: Promise<void> = Promise.resolve();

  constructor(options: HostOptions = {}) {
    this.#worldId = options.worldId ?? "fangcun-local";
    this.#host = options.host ?? "127.0.0.1";
    this.#port = options.port ?? 8765;
    this.#ownerUserId = options.ownerUserId ?? "local-user";
    this.#now = options.nowMs ?? Date.now;
    this.#idFactory = options.idFactory ?? (() => randomUUID());
    this.#dbPath = options.dbPath ?? ":memory:";
    this.#trackingReady = options.trackingReady ?? (() => true);
    // 0 disables the loop; a malformed env value falls back to the default instead of
    // silently turning autonomy off.
    const configuredInterval = options.autonomyIntervalMs ?? Number(process.env.FANGCUN_AUTONOMY_MS ?? DEFAULT_AUTONOMY_INTERVAL_MS);
    this.#autonomyIntervalMs = Number.isSafeInteger(configuredInterval) && configuredInterval >= 0
      ? configuredInterval
      : DEFAULT_AUTONOMY_INTERVAL_MS;
    this.#autonomyEnabled = this.#autonomyIntervalMs > 0;
    // 0 is a valid pacing override ("build as fast as possible", used by tests); a
    // malformed env value falls back to the default instead of stalling the queue.
    const configuredBuildInterval = options.buildIntervalMs ?? Number(process.env.FANGCUN_BUILD_INTERVAL_MS ?? DEFAULT_BUILD_INTERVAL_MS);
    this.#buildIntervalMs = Number.isSafeInteger(configuredBuildInterval) && configuredBuildInterval >= 0
      ? configuredBuildInterval
      : DEFAULT_BUILD_INTERVAL_MS;
    this.#buildStepScheduler = options.buildStepScheduler ?? ((run, delayMs) => {
      const timer = setTimeout(run, Math.max(0, delayMs));
      (timer as { unref?: () => void }).unref?.();
      return () => clearTimeout(timer);
    });
    // Until the first queue runs, the idle summary still reports the configured pacing.
    this.#lastBuild = Object.freeze({ ...this.#lastBuild, intervalMs: this.#buildIntervalMs });
    // Demo-only opt-in; default OFF so a blocked plot stays plot_not_clear and nothing moves.
    this.#demoRelocateGrant = options.demoRelocateGrant ?? process.env.FANGCUN_DEMO_RELOCATE_GRANT === "1";
    this.#companion = Object.freeze({
      schemaVersion: 1,
      companionId: "fish-1",
      ownerUserId: this.#ownerUserId,
      worldId: this.#worldId,
      personaId: "playful-fish",
      state: "idle",
      autonomyEnabled: true,
      createdAt: new Date(this.#now()).toISOString(),
    });
    this.#companionProfiles = seedCompanionProfiles(this.#ownerUserId, {
      name: DEFAULT_PET_NAME,
      personaId: this.#companion.personaId,
      activeAction: "stand",
    });
    this.#petScale = 1;
    this.#userItems = new Map(seedUserInventory().map((entry) => [entry.itemId, entry.count] as const));
  }

  get worldId(): string { return this.#worldId; }
  get revision(): number { return this.#authority?.snapshot.rev ?? 0; }

  get pairing(): PairingCode | null {
    if (this.#pairing && this.#pairing.expiresAtMs <= this.#now()) this.#pairing = null;
    return this.#pairing;
  }

  async start(): Promise<HostAddress> {
    const store = new HostStore(this.#dbPath, this.#now);
    const world = store.loadOrSeedWorld(this.#worldId);
    this.#store = store;
    this.#authority = new WorldAuthority({
      initialWorld: world,
      ownerUserId: this.#ownerUserId,
      homeGrantIssuerUserIds: [this.#ownerUserId],
      idFactory: this.#idFactory,
      clock: this.#now,
    });

    const storedCompanions = store.loadCompanions();
    if (storedCompanions.length === 0) {
      if (!this.#authority.registerCompanion(this.#companion)) throw new Error("failed to seed companion");
      store.saveCompanion(this.#companion);
    } else {
      this.#companion = storedCompanions[0]!;
      if (!this.#authority.registerCompanion(this.#companion)) throw new Error("failed to restore companion");
    }
    const storedGrants = store.loadGrants();
    const demoGrantMigrationApplied = store.loadDemoGrantMigrated();
    for (const storedGrant of storedGrants) {
      // Demo migration: existing grants get the v0 seat block added to their allowlist
      // once, so an upgraded live world can place the seat after a house build.
      let grant = this.#grantWithSeatAllowlist(storedGrant);
      // DEMO-ONLY opt-in migration (FANGCUN_DEMO_RELOCATE_GRANT=1, default off): the
      // grant-wide scan runs first; if the world truly has no clear 3x3, widen/relocate
      // the single active grant once. Never repeats (persisted marker), never moves blocks.
      if (this.#demoRelocateGrant && !demoGrantMigrationApplied && storedGrants.length === 1) {
        const migrated = this.#grantWithHouseRoom(grant, world);
        if (migrated !== grant) {
          grant = migrated;
          store.saveDemoGrantMigrated();
        }
      }
      if (grant !== storedGrant) store.saveGrant(grant);
      if (!this.#authority.restoreHomeGrant(grant)) throw new TypeError(`failed to restore grant ${grant.grantId}`);
      this.#grant = grant;
    }

    // Multi-companion social state: durable in the meta keys companionProfiles /
    // userInventory / petScale / warehouseSeedVersion. A store written before this model
    // (single legacy meta['petProfile'] row, single-item warehouse) is migrated once;
    // corrupt rows fail closed in the store.
    const legacyPet = store.loadLegacyPetProfile();
    const storedProfiles = store.loadCompanionProfiles();
    const storedInventory = store.loadUserInventory();
    const storedScale = store.loadPetScale();
    const storedSeedVersion = store.loadWarehouseSeedVersion();
    const resolvedProfiles = storedProfiles ?? seedCompanionProfiles(this.#ownerUserId, {
      name: legacyPet?.name ?? DEFAULT_PET_NAME,
      personaId: legacyPet?.personaId ?? this.#companion.personaId,
      activeAction: legacyPet?.activeAction ?? "stand",
    });
    // A legacy warehouse is topped up once with the new demo items; items already spent
    // (e.g. a basin living in a companion bag) are never re-granted.
    const resolvedInventory = storedInventory === null
      ? seedUserInventory()
      : topUpDemoWarehouse(storedInventory, storedSeedVersion);
    const resolvedScale = storedScale ?? legacyPet?.scale ?? 1;
    if (!storedProfiles || storedInventory === null || storedScale === null || storedSeedVersion !== WAREHOUSE_SEED_VERSION) {
      store.saveSocialState(resolvedProfiles, resolvedInventory, resolvedScale);
    }
    this.#companionProfiles = resolvedProfiles;
    this.#userItems = new Map(resolvedInventory.map((entry) => [entry.itemId, entry.count] as const));
    this.#petScale = resolvedScale;
    if (!this.#companionProfiles.some((profile) => profile.companionId === this.#companion.companionId)) {
      throw new TypeError(`stored companions are missing the primary companion ${this.#companion.companionId}`);
    }
    // `state` is a runtime display field: always start the primary companion idle.
    const storedPrimary = this.#findCompanion(this.#companion.companionId);
    if (storedPrimary && storedPrimary.state !== "idle") {
      this.#replaceProfile(Object.freeze({ ...storedPrimary, state: "idle" }));
    }

    const server = createServer((request, response) => {
      void this.#handleHttp(request, response);
    });
    server.on("upgrade", (request, socket, head) => this.#handleUpgrade(request, socket, head));
    this.#server = server;
    // Ephemeral ports assigned by the OS can fall on ports that browsers/undici refuse
    // ("bad port"); retry so a loopback demo URL is always client-usable.
    const requestedPort = this.#port;
    let portAttempts = 0;
    for (;;) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(requestedPort === 0 ? 0 : requestedPort, this.#host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("unexpected server address");
      if (requestedPort === 0 && CLIENT_BLOCKED_PORTS.has(address.port) && portAttempts < 10) {
        portAttempts += 1;
        await new Promise<void>((resolve) => server.close(() => resolve()));
        continue;
      }
      this.#port = address.port;
      break;
    }
    this.#syncAutonomyTimer();
    return Object.freeze({ host: this.#host, port: this.#port, worldId: this.#worldId });
  }

  async stop(): Promise<void> {
    this.#stopAutonomyTimer();
    // Block-by-block builds are in-memory only: drop them on shutdown (no resume).
    this.#dropBuildQueue();
    this.#settleBuildIdle();
    this.#clearHouseProposal();
    for (const session of this.#sessions) session.connection.close(1001);
    this.#sessions.clear();
    const server = this.#server;
    this.#server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    this.#store?.close();
    this.#store = null;
  }

  /** Rotates and returns the one-time pairing code the user types on the phone. */
  issuePairingCode(): PairingCode {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = randomBytes(8);
    let code = "";
    for (let index = 0; index < 8; index += 1) code += alphabet[bytes[index]! % alphabet.length];
    this.#pairing = Object.freeze({ code, expiresAtMs: this.#now() + PAIRING_TTL_MS });
    return this.#pairing;
  }

  async #handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${this.#host}:${this.#port}`);
    const send = (status: number, body: unknown): void => {
      const text = JSON.stringify(body);
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(text),
        "Cache-Control": "no-store",
      });
      response.end(text);
    };

    if (request.method === "GET" && url.pathname === "/api/health") {
      send(200, { ok: true, worldId: this.#worldId, rev: this.revision });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/pair") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const input = body.value as { code?: unknown; clientId?: unknown };
      if (typeof input.code !== "string" || typeof input.clientId !== "string"
        || input.clientId.length < 1 || input.clientId.length > 64) {
        return send(400, { error: "invalid_pairing_request" });
      }
      const pairing = this.pairing;
      if (!pairing || pairing.code !== input.code) return send(403, { error: "pairing_code_rejected" });
      this.#pairing = null;
      const token = randomBytes(32).toString("base64url");
      const expiresAtMs = this.#now() + SESSION_TTL_MS;
      this.#tokens.set(sha256(token), { clientId: input.clientId, expiresAtMs });
      return send(200, { token, worldId: this.#worldId, expiresAtMs, protocolVersion: 1 });
    }

    // PC inspector core API. Loopback-only by socket binding and intentionally
    // unauthenticated: it is the documented local approval/inspection surface, and any
    // local process could read the store anyway. The device path always needs a token.
    if (url.pathname.startsWith("/api/core/")) {
      return this.#handleCoreApi(request, response, url, send);
    }

    const token = bearerToken(request);
    const session = token ? this.#tokens.get(sha256(token)) : undefined;
    if (!token || !session || session.expiresAtMs <= this.#now()) return send(401, { error: "unauthorized" });

    if (request.method === "GET" && url.pathname === "/api/state") {
      return send(200, this.#coreState());
    }

    if (request.method === "POST" && url.pathname === "/api/companion/tick") {
      const result = await this.#runTick();
      return send(200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/home/approve") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const outcome = this.#approveHome((body.value as { candidateId?: unknown }).candidateId);
      return send(outcome.approved ? 200 : 409, outcome.body);
    }

    send(404, { error: "not_found" });
  }

  async #handleCoreApi(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    send: (status: number, body: unknown) => void,
  ): Promise<void> {
    const path = url.pathname;
    if (request.method === "GET" && path === "/api/core/state") {
      return send(200, this.#coreState());
    }

    if (request.method === "POST" && path === "/api/core/intent") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const input = body.value as {
        clientId?: unknown; seq?: unknown; baseRev?: unknown; operation?: unknown;
      };
      if (typeof input.clientId !== "string" || typeof input.seq !== "number" || typeof input.baseRev !== "number") {
        return send(400, { error: "invalid_intent" });
      }
      const intent = {
        protocolVersion: 1 as const,
        type: "intent" as const,
        worldId: this.#worldId,
        clientId: input.clientId,
        seq: input.seq,
        baseRev: input.baseRev,
        operation: input.operation,
      };
      const parsed = validateClientIntent(intent);
      if (!parsed.ok) return send(400, { error: parsed.error });
      // The browser keeps its own sequence counter across reloads while the Host's
      // per-client replay window resets on restart, so align the window instead of
      // failing the edit. Conflict safety still comes from baseRev.
      this.#authority.adoptClientSequence(input.clientId, input.seq);
      const decision = this.#authority.handleIntent(parsed.value);
      if (decision.ack.accepted && decision.commit) {
        if (!this.#commitAndBroadcast(decision.commit)) return send(500, { error: "commit_persist_failed" });
      }
      return send(200, { decision: { ack: decision.ack, commit: decision.commit }, world: worldStateToObject(this.#authority.snapshot) });
    }

    if (request.method === "POST" && path === "/api/core/companion/tick") {
      return send(200, await this.#runTick());
    }

    if (request.method === "POST" && path === "/api/core/home/approve") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const outcome = this.#approveHome((body.value as { candidateId?: unknown }).candidateId);
      return send(outcome.approved ? 200 : 409, outcome.body);
    }

    // Companion house proposal flow: propose highlights a 3x3 plot inside the granted
    // home and asks the owner; decide starts (or cancels) the block-by-block build.
    if (request.method === "POST" && path === "/api/core/house/propose") {
      const outcome = this.#proposeHouse();
      return send(outcome.status, outcome.body);
    }

    if (request.method === "POST" && path === "/api/core/house/decide") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const parsed = this.#parseHouseDecision(body.value);
      if (!parsed.ok) return send(parsed.status, { error: parsed.error });
      const outcome = this.#decideHouse(parsed.value.proposalId, parsed.value.approve);
      return send(outcome.status, outcome.body);
    }

    // One-click demo triggers (loopback inspector surface; the DSH panel proxies them as
    // /api/host/demo/*). No body or an empty JSON object `{}` is accepted.
    if (request.method === "POST" && (path === "/api/core/demo/lazy-house" || path === "/api/core/demo/real-house" || path === "/api/core/demo/reset-world")) {
      const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
      if (contentType === "application/json") {
        const body = await this.#readJson(request);
        if (!body.ok) return send(body.status, { error: body.error });
        const value = body.value;
        if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 0) {
          return send(400, { error: "invalid_demo_request" });
        }
      }
      const outcome = path === "/api/core/demo/lazy-house"
        ? this.#startLazyHouseDemo()
        : path === "/api/core/demo/real-house"
          ? this.#startRealHouseDemo()
          : this.#resetWorldDemo();
      return send(outcome.status, outcome.body);
    }

    if (request.method === "GET" && path === "/api/core/chat") {
      const requested = url.searchParams.get("companionId");
      const companionId = requested ?? this.#companion.companionId;
      if (!this.#findCompanion(companionId)) return send(404, { error: "companion_not_found" });
      return send(200, { messages: this.#chats.get(companionId) ?? [], companionId });
    }

    if (request.method === "POST" && path === "/api/core/chat") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const parsedChat = this.#parseChatRequest(body.value);
      if (!parsedChat.ok) return send(parsedChat.status, { error: parsedChat.error });
      // Legacy no-`companionId` form always talks to the primary companion.
      const companionId = parsedChat.companionId ?? this.#companion.companionId;
      if (!this.#findCompanion(companionId)) return send(404, { error: "companion_not_found" });
      const outcome = this.#chatExchange(parsedChat.text, companionId);
      return send(200, { reply: outcome.reply, state: outcome.state, companionId });
    }

    if (request.method === "POST" && path === "/api/core/companion/say") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const outcome = this.#companionSay((body.value as { text?: unknown }).text);
      return outcome.ok
        ? send(200, { ok: true })
        : send(outcome.status, { error: outcome.error });
    }

    if (request.method === "GET" && path === "/api/core/autonomy") {
      return send(200, this.#autonomyStatus());
    }

    if (request.method === "POST" && path === "/api/core/autonomy") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const enabled = (body.value as { enabled?: unknown }).enabled;
      if (typeof enabled !== "boolean") return send(400, { error: "invalid_autonomy_request" });
      // A zero interval is a configuration-level stop; the toggle cannot revive it.
      if (enabled && this.#autonomyIntervalMs <= 0) return send(409, { error: "autonomy_interval_zero" });
      this.#setAutonomyEnabled(enabled);
      return send(200, this.#autonomyStatus());
    }

    // Desktop-pet inspection/configuration. The GET view is also the action catalog
    // the PC panel renders; the strict PATCH/POST body accepts any subset of
    // { name, personaId, scale, action } and persists it across restart.
    if (request.method === "GET" && path === "/api/core/pet") {
      return send(200, this.#petState());
    }

    if ((request.method === "PATCH" || request.method === "POST") && path === "/api/core/pet") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const parsed = validatePetPatch(body.value);
      if (!parsed.ok) return send(400, { error: parsed.error });
      const outcome = this.#updatePet(parsed.value);
      if (!outcome.ok) return send(outcome.status, { error: outcome.error });
      return send(200, this.#petState());
    }

    // Multi-companion social surfaces. `isMine` is always derived from the Host owner;
    // the friend fixture is local demo data, and no mutation path exists for it.
    if (request.method === "GET" && path === "/api/core/companions") {
      return send(200, { companions: this.#companionViews() });
    }

    const companionRoute = /^\/api\/core\/companions\/([^/]+)$/.exec(path);
    if (companionRoute) {
      const rawCompanionId = companionRoute[1];
      if (rawCompanionId === undefined) return send(400, { error: "invalid_companion_id" });
      let companionId: string;
      try {
        companionId = decodeURIComponent(rawCompanionId);
      } catch {
        return send(400, { error: "invalid_companion_id" });
      }
      const profile = this.#findCompanion(companionId);
      if (!profile) return send(404, { error: "companion_not_found" });
      if (request.method === "GET") {
        return send(200, this.#companionDetailView(profile));
      }
      if (request.method !== "PATCH") return send(405, { error: "method_not_allowed" });
      if (profile.ownerUserId !== this.#ownerUserId) return send(403, { error: "not_owner" });
      const body = await this.#readJson(request, MAX_COMPANION_PATCH_BODY_BYTES);
      if (!body.ok) return send(body.status, { error: body.error });
      const parsed = validateCompanionPatch(body.value);
      if (!parsed.ok) {
        // Avatar size is a payload problem (413); every other invalid field is a 400.
        return send(parsed.error === "avatar_too_large" ? 413 : 400, { error: parsed.error });
      }
      const outcome = this.#updateCompanionProfile(profile, parsed.value);
      if (!outcome.ok) return send(outcome.status, { error: outcome.error });
      return send(200, outcome.view);
    }

    if (request.method === "GET" && path === "/api/core/items") {
      return send(200, { items: ITEM_CATALOG });
    }

    if (request.method === "GET" && path === "/api/core/inventory") {
      return send(200, { items: this.#userInventoryEntries() });
    }

    if (request.method === "POST" && path === "/api/core/inventory/give") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const parsed = validateGiveRequest(body.value);
      if (!parsed.ok) return send(400, { error: parsed.error });
      const outcome = this.#giveItem(parsed.value.companionId, parsed.value.itemId);
      if (!outcome.ok) return send(outcome.status, { error: outcome.error });
      return send(200, outcome.body);
    }

    send(404, { error: "not_found" });
  }

  /**
   * Candidates are derived from the current snapshot rather than cached from the last
   * tick: a tick observed at an older revision would otherwise be offered to the user
   * after the world moved, and approving it could never succeed.
   */
  #currentCandidate(): HomeCandidate | null {
    if (this.#activeGrant()) return null;
    return findHomeCandidates(this.#authority.snapshot)[0] ?? null;
  }

  /** The current home grant only when it is still usable (not revoked/expired). */
  #activeGrant(): HomePlotGrant | null {
    const grant = this.#grant;
    if (!grant || grant.revokedAt || !isGrantActive(grant, this.#now())) return null;
    return grant;
  }

  #coreState(): unknown {
    return {
      world: worldStateToObject(this.#authority.snapshot),
      ownerUserId: this.#ownerUserId,
      companion: this.#companion,
      candidate: this.#currentCandidate() ?? undefined,
      homeGrantActive: this.#activeGrant() !== null,
      /** Runtime companion state (idle / building / awaiting_approval …) for the PC panel. */
      companionState: this.#companionState,
      houseProposal: this.#currentHouseProposal(),
      /** Demo-only: one startup grant migration, when FANGCUN_DEMO_RELOCATE_GRANT=1 ran it. */
      grantMigration: this.#grantMigration,
      /** Demo panel: which scripted demo is running right now (cleared on finish/stop/reset). */
      demo: Object.freeze({ run: this.#demoRun }),
      build: this.#buildInfo(),
    };
  }

  #findCompanion(companionId: string): CompanionProfile | null {
    return this.#companionProfiles.find((profile) => profile.companionId === companionId) ?? null;
  }

  #primaryProfile(): CompanionProfile {
    const profile = this.#findCompanion(this.#companion.companionId);
    if (!profile) throw new Error("primary companion profile is missing");
    return profile;
  }

  #view(profile: CompanionProfile): CompanionView {
    return companionView(profile, this.#ownerUserId);
  }

  #companionViews(): readonly CompanionView[] {
    return Object.freeze(this.#companionProfiles.map((profile) => this.#view(profile)));
  }

  #replaceProfile(profile: CompanionProfile): void {
    this.#companionProfiles = Object.freeze(this.#companionProfiles.map((current) =>
      current.companionId === profile.companionId ? profile : current));
  }

  #replaceIn(id: string, profile: CompanionProfile, profiles: readonly CompanionProfile[] = this.#companionProfiles): readonly CompanionProfile[] {
    return Object.freeze(profiles.map((current) => current.companionId === id ? profile : current));
  }

  /** Owned stacks only, in catalog order; a zero count disappears from the view. */
  #userInventoryEntries(): readonly UserInventoryEntry[] {
    return inventoryEntriesFromCounts(this.#userItems);
  }

  /** Persists companions + inventory + scale in one transaction; memory is applied after success. */
  #saveSocial(
    profiles: readonly CompanionProfile[] = this.#companionProfiles,
    inventory: readonly UserInventoryEntry[] = this.#userInventoryEntries(),
    scale: number = this.#petScale,
  ): boolean {
    const store = this.#store;
    if (!store) return false;
    try {
      store.saveSocialState(profiles, inventory, scale);
      return true;
    } catch {
      return false;
    }
  }

  /** The single action list the PC panel renders: display names live here, not in JS. */
  #petState(): Readonly<{
    name: string;
    personaId: string;
    scale: number;
    actions: readonly PetAction[];
    activeAction: CompanionActionId;
    homeGrantActive: boolean;
    companionId: string;
  }> {
    const primary = this.#primaryProfile();
    return Object.freeze({
      name: primary.name,
      personaId: primary.personaId,
      scale: this.#petScale,
      actions: PET_ACTIONS,
      activeAction: primary.activeAction,
      homeGrantActive: this.#activeGrant() !== null,
      companionId: primary.companionId,
    });
  }

  /**
   * Applies an already-validated pet patch and persists it before announcing it, so a
   * client never sees a configuration the store cannot survive a restart with.
   */
  #updatePet(patch: PetPatch): { ok: true } | { ok: false; status: number; error: string } {
    if (!this.#store) return { ok: false, status: 503, error: "host_stopping" };
    const primary = this.#primaryProfile();
    const nextScale = patch.scale ?? this.#petScale;
    const nextProfile: CompanionProfile = Object.freeze({
      ...primary,
      name: patch.name ?? primary.name,
      personaId: patch.personaId ?? primary.personaId,
      activeAction: patch.action ?? primary.activeAction,
    });
    const nextProfiles = this.#replaceIn(primary.companionId, nextProfile);
    if (!this.#saveSocial(nextProfiles, this.#userInventoryEntries(), nextScale)) {
      return { ok: false, status: 500, error: "pet_persist_failed" };
    }
    this.#companionProfiles = nextProfiles;
    this.#petScale = nextScale;
    const profileChanged = patch.name !== undefined || patch.personaId !== undefined || patch.scale !== undefined;
    // Name/persona/scale have no dedicated wire message: re-announcing the existing
    // companion state tells replicas the companion record changed. Actions carry the
    // typed `companion_action` message because the tablet must play them.
    if (profileChanged) this.#setCompanionState(this.#companionState);
    if (patch.action !== undefined) this.#broadcastCompanionAction(patch.action);
    return { ok: true };
  }

  #updateCompanionProfile(
    profile: CompanionProfile,
    patch: CompanionPatch,
  ): { ok: true; view: CompanionView } | { ok: false; status: number; error: string } {
    if (!this.#store) return { ok: false, status: 503, error: "host_stopping" };
    const nextProfile: CompanionProfile = Object.freeze({
      ...profile,
      name: patch.name ?? profile.name,
      personality: patch.personality ?? profile.personality,
      personaId: patch.personaId ?? profile.personaId,
      avatarImage: patch.avatarImage !== undefined ? patch.avatarImage : profile.avatarImage,
    });
    const nextProfiles = this.#replaceIn(profile.companionId, nextProfile);
    if (!this.#saveSocial(nextProfiles)) return { ok: false, status: 500, error: "companion_persist_failed" };
    this.#companionProfiles = nextProfiles;
    if (patch.name !== undefined || patch.personaId !== undefined || patch.avatarImage !== undefined) {
      this.#setCompanionState(this.#companionState);
    }
    return { ok: true, view: this.#view(nextProfile) };
  }

  /**
   * Transfers one owned item into a companion bag. Only owned companions accept items;
   * the user stack, the companion bag and the profile list are persisted atomically.
   */
  #giveItem(
    companionId: string,
    itemId: string,
  ): { ok: true; body: Readonly<{ companion: CompanionView; inventory: Readonly<{ items: readonly UserInventoryEntry[] }> }> }
    | { ok: false; status: number; error: string } {
    if (!this.#store) return { ok: false, status: 503, error: "host_stopping" };
    const profile = this.#findCompanion(companionId);
    if (!profile) return { ok: false, status: 404, error: "companion_not_found" };
    if (profile.ownerUserId !== this.#ownerUserId) return { ok: false, status: 403, error: "not_owner" };
    const ownedCount = this.#userItems.get(itemId) ?? 0;
    if (ownedCount < 1) return { ok: false, status: 409, error: "item_not_owned" };
    const added = addItemToCompanion(profile.items, itemId);
    if (!added.ok) return { ok: false, status: 409, error: added.error };
    const nextProfile: CompanionProfile = Object.freeze({ ...profile, items: added.items });
    const nextProfiles = this.#replaceIn(profile.companionId, nextProfile);
    const nextItems = new Map(this.#userItems);
    if (ownedCount > 1) nextItems.set(itemId, ownedCount - 1);
    else nextItems.delete(itemId);
    const nextInventory = this.#inventoryEntries(nextItems);
    if (!this.#saveSocial(nextProfiles, nextInventory)) return { ok: false, status: 500, error: "social_persist_failed" };
    this.#companionProfiles = nextProfiles;
    this.#userItems = nextItems;
    // Lightweight refresh signal for open replicas; inventory has no wire type of its own.
    this.#setCompanionState(this.#companionState);
    return { ok: true, body: Object.freeze({ companion: this.#view(nextProfile), inventory: Object.freeze({ items: nextInventory }) }) };
  }

  #inventoryEntries(items: ReadonlyMap<string, number>): readonly UserInventoryEntry[] {
    return inventoryEntriesFromCounts(items);
  }

  /**
   * Strict chat request: only `{text, companionId?}`; omitted companionId keeps the
   * legacy primary-companion behaviour. Unknown fields are rejected.
   */
  #parseChatRequest(value: unknown): { ok: true; text: string; companionId: string | null } | { ok: false; status: number; error: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, status: 400, error: "invalid_chat_request" };
    const input = value as Record<string, unknown>;
    for (const key of Object.keys(input)) {
      if (key !== "text" && key !== "companionId") return { ok: false, status: 400, error: "invalid_chat_request" };
    }
    const rawText = input.text;
    if (typeof rawText !== "string") return { ok: false, status: 400, error: "invalid_chat_text" };
    const text = rawText.trim();
    if (text.length < 1 || text.length > CHAT_MAX_TEXT_LENGTH) return { ok: false, status: 400, error: "invalid_chat_text" };
    const rawCompanionId = input.companionId;
    if (rawCompanionId !== undefined
      && (typeof rawCompanionId !== "string" || rawCompanionId.length < 1 || rawCompanionId.length > 128)) {
      return { ok: false, status: 400, error: "invalid_chat_request" };
    }
    return { ok: true, text, companionId: rawCompanionId ?? null };
  }

  #broadcastCompanionAction(actionId: CompanionActionId): void {
    this.#broadcast({
      protocolVersion: 1,
      type: "companion_action",
      worldId: this.#worldId,
      companionId: this.#companion.companionId,
      actionId,
      expiresAtMs: this.#now() + COMPANION_ACTION_TTL_MS,
    });
  }

  #broadcast(message: ServerMessage): void {
    for (const peer of this.#sessions) {
      if (!peer.authenticated) continue;
      this.#send(peer, message);
    }
  }

  #setCompanionState(state: CompanionStateName): void {
    this.#companionState = state;
    // Keep the primary profile's runtime `state` field in sync for the social views.
    const primary = this.#findCompanion(this.#companion.companionId);
    if (primary && primary.state !== state) this.#replaceProfile(Object.freeze({ ...primary, state }));
    this.#broadcast({
      protocolVersion: 1,
      type: "companion_state",
      worldId: this.#worldId,
      companionId: this.#companion.companionId,
      state,
      updatedAtMs: this.#now(),
    });
  }

  #say(text: string, companionId: string = this.#companion.companionId): void {
    this.#broadcast({
      protocolVersion: 1,
      type: "companion_say",
      worldId: this.#worldId,
      companionId,
      text,
      expiresAtMs: this.#now() + 8000,
    });
  }

  #appendChat(companionId: string, role: ChatMessage["role"], text: string): void {
    let log = this.#chats.get(companionId);
    if (log === undefined) {
      log = [];
      this.#chats.set(companionId, log);
    }
    log.push(Object.freeze({ role, text, atMs: this.#now() }));
    if (log.length > CHAT_HISTORY_LIMIT) log.splice(0, log.length - CHAT_HISTORY_LIMIT);
  }

  /**
   * One PC chat turn for one companion: append the user message, compose the reply and
   * broadcast it. The tablet renders companion speech, so `companion_say` carries the
   * reply (never the user's own text) with that companion's id.
   */
  #chatExchange(text: string, companionId: string): Readonly<{ reply: string; state: CompanionStateName }> {
    const profile = this.#findCompanion(companionId);
    if (!profile) throw new Error("chat companion is missing");
    this.#appendChat(companionId, "user", text);
    const { reply } = composeCompanionReply(text);
    this.#appendChat(companionId, "companion", reply);
    this.#say(reply, companionId);
    return Object.freeze({ reply, state: profile.state });
  }

  /** MCP/agent speech hook: broadcast a line without inventing a chat turn for it. */
  #companionSay(rawText: unknown): { ok: true } | { ok: false; status: number; error: string } {
    if (typeof rawText !== "string") return { ok: false, status: 400, error: "invalid_companion_say" };
    const text = rawText.trim();
    if (text.length < 1 || text.length > COMPANION_SAY_MAX_TEXT_LENGTH) return { ok: false, status: 400, error: "invalid_companion_say" };
    this.#appendChat(this.#companion.companionId, "companion", text);
    this.#say(text);
    return { ok: true };
  }

  #commitAndBroadcast(commit: CommitMessage): boolean {
    try {
      this.#store!.commit(this.#authority.snapshot, commit);
    } catch {
      return false;
    }
    this.#broadcast(commit);
    return true;
  }

  /**
   * Serializes companion ticks: the autonomy timer and the HTTP endpoints share one
   * chain, so two ticks can never interleave their async plan hashing.
   */
  #runTick(): Promise<TickOutcome> {
    this.#tickCount += 1;
    const run = this.#tickChain.then(() => this.#runTickNow());
    this.#tickChain = run.then(() => undefined, () => undefined);
    return run.finally(() => { this.#tickCount -= 1; });
  }

  async #runTickNow(): Promise<TickOutcome> {
    if (!this.#store) {
      // A tick racing Host shutdown has no durable store to publish to; refuse it
      // instead of mutating the in-memory authority.
      return { result: { status: "paused", intents: [], reason: "host_stopping" }, world: worldStateToObject(this.#authority.snapshot) };
    }
    if (this.#buildQueue) {
      // The block-by-block queue owns the companion; an instant tick would interleave.
      return { result: { status: "paused", intents: [], reason: "build_in_progress" }, world: worldStateToObject(this.#authority.snapshot) };
    }
    this.#setCompanionState("planning");
    const result = await this.#authority.runCompanionTick({ authenticatedOwnerUserId: this.#ownerUserId }, { trackingReady: this.#trackingReady() });
    this.#lastTick = result;
    if (result.status === "committed" && result.commit) {
      this.#setCompanionState("building");
      this.#commitAndBroadcast(result.commit);
      this.#setCompanionState("idle");
      this.#say(buildLine(this.#lineIndex));
      this.#lineIndex += 1;
    } else if (result.status === "home_approval_required") {
      this.#setCompanionState("awaiting_approval");
      this.#say(COMPANION_HOME_PROPOSAL_LINE);
    } else if (result.status === "paused") {
      this.#setCompanionState("paused");
    } else {
      this.#setCompanionState("idle");
    }
    return { result, world: worldStateToObject(this.#authority.snapshot) };
  }

  #autonomyStatus(): Readonly<{
    enabled: boolean;
    intervalMs: number;
    lastRunAtMs: number | null;
    autoHousePropose: boolean;
    lastHouseProposalAtMs: number | null;
    houseProposalCooldownUntilMs: number;
  }> {
    return Object.freeze({
      enabled: this.#autonomyEnabled && this.#autonomyIntervalMs > 0,
      intervalMs: this.#autonomyIntervalMs,
      lastRunAtMs: this.#autonomyLastRunAtMs,
      autoHousePropose: true,
      lastHouseProposalAtMs: this.#lastHouseProposalAttemptAtMs,
      houseProposalCooldownUntilMs: this.#houseProposalCooldownUntilMs,
    });
  }

  #setAutonomyEnabled(enabled: boolean): void {
    this.#autonomyEnabled = enabled;
    this.#syncAutonomyTimer();
  }

  #syncAutonomyTimer(): void {
    this.#stopAutonomyTimer();
    if (!this.#autonomyEnabled || this.#autonomyIntervalMs <= 0) return;
    const timer = setInterval(() => { void this.#autonomyStep(); }, this.#autonomyIntervalMs);
    // Never keep a CLI or test process alive just because the companion is idle.
    timer.unref();
    this.#autonomyTimer = timer;
  }

  #stopAutonomyTimer(): void {
    if (this.#autonomyTimer === null) return;
    clearInterval(this.#autonomyTimer);
    this.#autonomyTimer = null;
  }

  /**
   * One self-driving behaviour per interval. Priority: while no home is granted,
   * propose a home candidate; while a home grant is active, self-drive a house
   * proposal (highlight a clear 3x3 spot + ask) and only fall back to the legacy
   * instant starter-home tick when proposing is not possible. Every world decision is
   * delegated to WorldAuthority; this scheduler never writes the world itself.
   */
  async #autonomyStep(): Promise<void> {
    if (!this.#autonomyEnabled || this.#autonomyIntervalMs <= 0 || this.#server === null) return;
    // The block-by-block queue owns the companion while it runs.
    if (this.#buildQueue) return;
    // A manual tick or a previous slow step still owns the companion; skipping
    // keeps two ticks from ever overlapping.
    if (this.#tickCount > 0) return;
    this.#autonomySteps += 1;
    this.#autonomyLastRunAtMs = this.#now();
    if (!this.#companion.autonomyEnabled) return;
    try {
      if (!this.#activeGrant()) {
        if (this.#lastTick?.status === "home_approval_required" && this.#lastTick.candidate) {
          this.#maybeAutonomySay();
          return;
        }
        await this.#runTick();
        return;
      }
      // Self-driven house proposal first: the demo expects 小鱼 to ask on its own.
      if (this.#maybeAutoProposeHouse()) return;
      // The house flow owns an actively granted plot: never fall back to the legacy
      // instant starter-home commit while a proposal is pending, cooling down, or a
      // build is queued. Idle chatter keeps the bubble alive between attempts.
      if (this.#companionState !== "awaiting_approval") this.#maybeAutonomySay();
    } catch {
      // A best-effort step must never take the Host down; the next interval retries.
    }
  }

  /**
   * Self-driven house proposal: highlight a clear footprint inside the granted plot
   * and ask the owner. In-memory cadence only: at most one attempt per
   * {@link AUTO_HOUSE_PROPOSAL_INTERVAL_MS}; a user rejection backs off 60 s and a
   * blocked plot backs off 120 s. Returns true when this cycle was consumed by the
   * proposal attempt (success or failure) so the legacy tick does not double-act.
   */
  #maybeAutoProposeHouse(): boolean {
    if (this.#buildQueue) return false;
    if (!this.#activeGrant()) return false;
    if (this.#companionState === "awaiting_approval") return false;
    if (this.#currentHouseProposal()) return false;
    const now = this.#now();
    if (this.#lastHouseProposalAttemptAtMs !== null
      && now - this.#lastHouseProposalAttemptAtMs < AUTO_HOUSE_PROPOSAL_INTERVAL_MS) return false;
    if (now < this.#houseProposalCooldownUntilMs) return false;
    const outcome = this.#proposeHouse();
    this.#lastHouseProposalAttemptAtMs = now;
    if (outcome.status === 200) return true;
    const error = (outcome.body as { error?: unknown }).error;
    if (error === "plot_not_clear" || error === "no_safe_plan") {
      this.#houseProposalCooldownUntilMs = now + HOUSE_PROPOSAL_BLOCKED_COOLDOWN_MS;
    }
    return true;
  }

  #maybeAutonomySay(): void {
    // "Occasionally": one idle line every third interval keeps the bubble alive
    // without spamming the tablet or pretending the companion did real work.
    if (this.#autonomySteps % AUTONOMY_SAY_EVERY_STEPS !== 0) return;
    this.#say(idleLine(this.#idleLineIndex));
    this.#idleLineIndex += 1;
  }

  #approveHome(candidateId: unknown): { approved: boolean; body: unknown } {
    const candidate = this.#currentCandidate();
    if (typeof candidateId !== "string" || !candidate || candidate.candidateId !== candidateId) {
      return { approved: false, body: { approved: false, error: "candidate_stale", world: worldStateToObject(this.#authority.snapshot) } };
    }
    const now = new Date(this.#now());
    const grant: HomePlotGrant = Object.freeze({
      schemaVersion: 1,
      grantId: "grant-local-home-1",
      grantRev: 1,
      plotId: "home-local-1",
      worldId: this.#worldId,
      ownerUserId: this.#ownerUserId,
      approvedByUserId: this.#ownerUserId,
      companionId: this.#companion.companionId,
      bounds: candidate.bounds,
      allowedBlockIds: Object.freeze(["planks", "glass", HOUSE_SEAT_BLOCK_ID] as const),
      maxBlocksPerPlan: 32,
      maxBlocksPerDay: 128,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const approved = this.#authority.approveHomePlot(grant, candidate, { authenticatedOwnerUserId: this.#ownerUserId });
    if (approved && this.#store) {
      this.#store.saveGrant(grant);
      this.#grant = grant;
      this.#setCompanionState("idle");
      this.#say(COMPANION_HOME_GRANTED_LINE);
    }
    return { approved, body: { approved, world: worldStateToObject(this.#authority.snapshot) } };
  }

  /** One-time demo migration: make the v0 seat block placeable on an existing grant. */
  #grantWithSeatAllowlist(grant: HomePlotGrant): HomePlotGrant {
    if (grant.revokedAt || grant.allowedBlockIds.includes(HOUSE_SEAT_BLOCK_ID) || grant.allowedBlockIds.length >= 8) return grant;
    return Object.freeze({ ...grant, allowedBlockIds: Object.freeze([...grant.allowedBlockIds, HOUSE_SEAT_BLOCK_ID]) });
  }

  /**
   * DEMO-ONLY (opt-in): make a cramped active grant usable for the cottage flow. The
   * grant-wide 3x3 scan is always the primary path; this only runs when that scan finds
   * nothing. Widen first (≤6x6, the schema maximum) inside the island footprint; if even
   * that cannot host a clear 3x3, relocate once to the nearest clear 4x4x4 site.
   * Caller gates on FANGCUN_DEMO_RELOCATE_GRANT and the persisted one-time marker.
   */
  #grantWithHouseRoom(grant: HomePlotGrant, world: WorldState): HomePlotGrant {
    if (grant.revokedAt || !isGrantActive(grant, this.#now())) return grant;
    if (findHouseBuildPlan(world, grant) !== null) return grant;
    for (const bounds of this.#expandedGrantBounds(grant.bounds)) {
      const candidate: HomePlotGrant = Object.freeze({ ...grant, bounds });
      if (!validateHomePlotGrant(candidate).ok) continue;
      if (findHouseBuildPlan(world, candidate) !== null) return this.#recordGrantMigration(grant, candidate, "widened_for_clear_footprint");
    }
    // Last resort: relocate to a clear plot-sized site on the island. The world only
    // needs the 3x3x3 cottage volume, so a clear 4x4x4 candidate guarantees room.
    const site = findHomeCandidates(world, { width: 4, depth: 4, height: 4, maxResults: 1 })[0];
    if (site) {
      const relocated: HomePlotGrant = Object.freeze({ ...grant, bounds: site.bounds });
      if (validateHomePlotGrant(relocated).ok && findHouseBuildPlan(world, relocated) !== null) {
        return this.#recordGrantMigration(grant, relocated, "relocated_to_clear_site");
      }
    }
    return grant;
  }

  #recordGrantMigration(
    from: HomePlotGrant,
    to: HomePlotGrant,
    reason: GrantMigration["reason"],
  ): HomePlotGrant {
    this.#grantMigration = Object.freeze({
      at: this.#now(),
      grantId: from.grantId,
      from: from.bounds,
      to: to.bounds,
      reason,
    });
    // Loud, identifiable demo-only line: grant id, old → new bounds and why.
    console.log(`[fangcun][DEMO][grant-migration] ${from.grantId}: bounds ${JSON.stringify(from.bounds)} -> ${JSON.stringify(to.bounds)} reason=${reason} (FANGCUN_DEMO_RELOCATE_GRANT=1, demo-only, world blocks untouched)`);
    return to;
  }

  /** Deterministic expansion options for a grant AABB (bounds max 6x6 inside x,z ∈ [-7,7)). */
  #expandedGrantBounds(bounds: HomePlotGrant["bounds"]): readonly HomePlotGrant["bounds"][] {
    const { min, maxExclusive } = bounds;
    const options: HomePlotGrant["bounds"][] = [];
    const push = (minX: number, minZ: number, maxX: number, maxZ: number): void => {
      if (minX < -7 || minZ < -7 || maxX > 7 || maxZ > 7) return;
      if (maxX - minX < 3 || maxZ - minZ < 3 || maxX - minX > 6 || maxZ - minZ > 6) return;
      options.push(Object.freeze({
        min: Object.freeze({ x: minX, y: min.y, z: minZ }),
        maxExclusive: Object.freeze({ x: maxX, y: maxExclusive.y, z: maxZ }),
      }));
    };
    // 1) symmetric one-cell growth (the live 4x4 → 6x6 case).
    push(min.x - 1, min.z - 1, maxExclusive.x + 1, maxExclusive.z + 1);
    // 2) grow a single axis by one cell on each side.
    push(min.x - 1, min.z, maxExclusive.x + 1, maxExclusive.z);
    push(min.x, min.z - 1, maxExclusive.x, maxExclusive.z + 1);
    // 3) grow each axis up to 6 cells, extending whichever side has room.
    const grow = (lo: number, hi: number): readonly [number, number] | null => {
      let left = lo;
      let right = hi;
      while (right - left < 6) {
        if (left - 1 >= -7) left -= 1;
        else if (right + 1 <= 7) right += 1;
        else break;
      }
      return right - left >= 3 ? [left, right] : null;
    };
    const grownX = grow(min.x, maxExclusive.x);
    const grownZ = grow(min.z, maxExclusive.z);
    if (grownX && grownZ) push(grownX[0], grownZ[0], grownX[1], grownZ[1]);
    if (grownX) push(grownX[0], min.z, grownX[1], maxExclusive.z);
    if (grownZ) push(min.x, grownZ[0], maxExclusive.x, grownZ[1]);
    return Object.freeze(options);
  }

  /** Single-companion view plus its pending house proposal (null when none applies). */
  #companionDetailView(profile: CompanionProfile): Readonly<CompanionView & { houseProposal: PendingHouseProposal | null }> {
    const pending = this.#currentHouseProposal();
    return Object.freeze({
      ...this.#view(profile),
      houseProposal: pending && pending.companionId === profile.companionId ? pending : null,
    });
  }

  /** The pending proposal, or null when none/expired (expired records stay until decided). */
  #currentHouseProposal(): PendingHouseProposal | null {
    const pending = this.#pendingHouseProposal;
    if (!pending) return null;
    return this.#now() < pending.expiresAtMs ? pending : null;
  }

  #clearHouseProposal(): void {
    this.#pendingHouseProposal = null;
    this.#pendingHousePlan = null;
  }

  #buildInfo(): BuildSummary {
    const queue = this.#buildQueue;
    if (!queue) return this.#lastBuild;
    return Object.freeze({
      inProgress: true,
      completedBlocks: queue.completedBlocks,
      totalBlocks: queue.ops.length,
      intervalMs: this.#buildIntervalMs,
      lastError: null,
      seatPlaced: false,
      seatError: null,
      demo: queue.kind === "house" ? null : queue.kind,
    });
  }

  /**
   * Resolves when the current build queue finishes or stops (immediately when idle).
   * Tests use this instead of sleeping; PC/DSH callers may poll `build` in the state too.
   */
  waitForBuildIdle(): Promise<BuildSummary> {
    if (!this.#buildQueue) return Promise.resolve(this.#lastBuild);
    return new Promise((resolve) => { this.#buildIdleWaiters.push(resolve); });
  }

  #settleBuildIdle(): void {
    const waiters = this.#buildIdleWaiters;
    this.#buildIdleWaiters = [];
    for (const resolve of waiters) resolve(this.#lastBuild);
  }

  #parseHouseDecision(value: unknown): { ok: true; value: Readonly<{ proposalId: string; approve: boolean }> } | { ok: false; status: number; error: string } {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, status: 400, error: "invalid_house_decision" };
    const input = value as Record<string, unknown>;
    if (Object.keys(input).length !== 2 || !Object.hasOwn(input, "proposalId") || !Object.hasOwn(input, "approve")) {
      return { ok: false, status: 400, error: "invalid_house_decision" };
    }
    const proposalId = input.proposalId;
    if (typeof proposalId !== "string" || proposalId.length < 1 || proposalId.length > 128) {
      return { ok: false, status: 400, error: "invalid_house_decision" };
    }
    if (typeof input.approve !== "boolean") return { ok: false, status: 400, error: "invalid_house_decision" };
    return { ok: true, value: Object.freeze({ proposalId, approve: input.approve }) };
  }

  /**
   * Highlights a clear 3x3x3 cottage area somewhere inside the granted plot and asks
   * the owner. No world write happens here; the proposal is in-memory and expires.
   */
  #proposeHouse(): { status: number; body: unknown } {
    if (this.#buildQueue) return { status: 409, body: { error: "build_in_progress" } };
    const pending = this.#pendingHouseProposal;
    if (pending && this.#now() < pending.expiresAtMs) return { status: 409, body: { error: "proposal_pending" } };
    if (pending) this.#clearHouseProposal();
    const grant = this.#grant;
    if (!grant || grant.revokedAt || !isGrantActive(grant, this.#now())
      || grant.companionId !== this.#companion.companionId) {
      return { status: 409, body: { error: "grant_missing" } };
    }
    // Search the whole grant for a clear footprint: the live demo world already has a
    // house/player blocks near the plot origin. `plot_not_clear` means no slot at all.
    if (!canBuildHousePlan(grant)) return { status: 409, body: { error: "no_safe_plan" } };
    const plan = findHouseBuildPlan(this.#authority.snapshot, grant);
    if (!plan) return { status: 409, body: { error: "plot_not_clear" } };
    const proposalId = `house:${this.#idFactory()}`.slice(0, 128);
    const proposal: PendingHouseProposal = Object.freeze({
      proposalId,
      companionId: this.#companion.companionId,
      bounds: plan.bounds,
      planBlockCount: plan.blockCount,
      expiresAtMs: this.#now() + HOUSE_PROPOSAL_TTL_MS,
    });
    this.#pendingHouseProposal = proposal;
    this.#pendingHousePlan = plan;
    // Frame first: tablets render the highlighted plot, then the speech/state updates.
    this.#broadcast({
      protocolVersion: 1,
      type: "companion_build_proposal",
      worldId: this.#worldId,
      companionId: proposal.companionId,
      proposalId: proposal.proposalId,
      bounds: proposal.bounds,
      blockCount: proposal.planBlockCount,
      expiresAtMs: proposal.expiresAtMs,
    });
    this.#setCompanionState("awaiting_approval");
    this.#say(COMPANION_HOUSE_PROPOSAL_LINE);
    return { status: 200, body: { proposal } };
  }

  #decideHouse(proposalId: string, approve: boolean): { status: number; body: unknown } {
    const pending = this.#pendingHouseProposal;
    if (!pending || pending.proposalId !== proposalId) {
      return { status: 404, body: { error: "proposal_not_found" } };
    }
    if (this.#now() >= pending.expiresAtMs) {
      this.#clearHouseProposal();
      this.#setCompanionState("idle");
      return { status: 409, body: { error: "proposal_expired" } };
    }
    const plan = this.#pendingHousePlan;
    this.#clearHouseProposal();
    if (!approve) {
      // Respect the user's "no": do not ask again for the reject cooldown window.
      this.#houseProposalCooldownUntilMs = this.#now() + HOUSE_PROPOSAL_REJECT_COOLDOWN_MS;
      this.#setCompanionState("idle");
      this.#say(COMPANION_HOUSE_REJECTED_LINE);
      return { status: 200, body: { approved: false, proposalId } };
    }
    if (!plan || !this.#grant || this.#grant.revokedAt) {
      this.#setCompanionState("idle");
      return { status: 409, body: { error: "grant_missing" } };
    }
    this.#startBuildQueue(plan, proposalId);
    return { status: 200, body: { approved: true, proposalId, planBlockCount: plan.blockCount } };
  }

  /** Starts the one-block-per-interval house queue; the HTTP response returns immediately. */
  #startBuildQueue(plan: HouseBuildPlan, proposalId: string): void {
    this.#startScriptedBuild({
      kind: "house",
      proposalId,
      ops: plan.operations,
      seat: plan.seat,
      placeSeatAfter: true,
      midLine: null,
      finishLine: COMPANION_HOUSE_DONE_LINE,
      finishAction: "sit",
    });
  }

  /**
   * One-click scripted "懒懒小屋" demo: 8 corner-post planks then 1 stairs seat at the
   * footprint centre, driven through the SAME paced single-block queue as a real plan.
   * 409s mirror the normal flow: build_in_progress / proposal_pending / grant_missing /
   * no_safe_plan / plot_not_clear.
   */
  #startLazyHouseDemo(): { status: number; body: unknown } {
    if (this.#buildQueue) return { status: 409, body: { error: "build_in_progress" } };
    if (this.#currentHouseProposal()) return { status: 409, body: { error: "proposal_pending" } };
    const grant = this.#activeGrant();
    if (!grant) return { status: 409, body: { error: "grant_missing" } };
    if (!grant.allowedBlockIds.includes("planks") || !grant.allowedBlockIds.includes(HOUSE_SEAT_BLOCK_ID)) {
      return { status: 409, body: { error: "no_safe_plan" } };
    }
    const footprint = findHouseBuildPlan(this.#authority.snapshot, grant);
    if (!footprint) return { status: 409, body: { error: "plot_not_clear" } };
    const lazyPlan = buildLazyHousePlan(footprint);
    this.#startScriptedBuild({
      kind: "lazy-house",
      proposalId: "demo:lazy-house",
      ops: lazyPlan.operations,
      seat: lazyPlan.seat,
      placeSeatAfter: false, // the stairs block is already the 9th op of the script
      midLine: { afterBlocks: LAZY_HOUSE_BLOCK_COUNT - 1, text: COMPANION_LAZY_HOUSE_LINE },
      finishLine: COMPANION_LAZY_HOUSE_DONE_LINE,
      finishAction: "sit",
    });
    this.#demoRun = Object.freeze({ kind: "lazy-house", startedAtMs: this.#now() });
    return {
      status: 200,
      body: Object.freeze({
        ok: true,
        demo: "lazy-house",
        planBlockCount: lazyPlan.blockCount,
        bounds: lazyPlan.bounds,
        intervalMs: this.#buildIntervalMs,
      }),
    };
  }

  /**
   * One-click "认真盖房" demo: behaves exactly like a normal `POST /house/propose` — the
   * grant-wide 3x3 scan picks the footprint, the proposal frame/state/say are broadcast and
   * `houseProposal` is exposed. It does NOT auto-approve: the build starts only from the
   * normal owner decision path (`POST /house/decide {approve:true}`), either from the
   * tablet's 好呀 button or from the DSH panel's approve control.
   */
  #startRealHouseDemo(): { status: number; body: unknown } {
    if (this.#buildQueue) return { status: 409, body: { error: "build_in_progress" } };
    const outcome = this.#proposeHouse();
    if (outcome.status !== 200) return outcome;
    const proposal = (outcome.body as { proposal: PendingHouseProposal }).proposal;
    return {
      status: 200,
      body: Object.freeze({
        ok: true,
        demo: "real-house",
        proposalId: proposal.proposalId,
        planBlockCount: proposal.planBlockCount,
        bounds: proposal.bounds,
        expiresAtMs: proposal.expiresAtMs,
        intervalMs: this.#buildIntervalMs,
      }),
    };
  }

  /**
   * Demo reset: back up the store, then restore the pristine seed island exactly like
   * scripts/reset-world.mjs (world rev 0 + 196 seed blocks, DELETE FROM commits) while
   * keeping pets/inventories/grant/flags. The revision goes BACKWARDS, so every open
   * WebSocket session is closed with 1012 (service restart) and clients reconnect and
   * re-hello at rev 0 instead of keeping a stale replica. Refused while a build runs and
   * for an in-memory store (there is no file to back up).
   */
  #resetWorldDemo(): { status: number; body: unknown } {
    if (this.#buildQueue) return { status: 409, body: { error: "build_in_progress" } };
    const store = this.#store;
    if (!store) return { status: 503, body: { error: "store_unavailable" } };
    if (this.#dbPath === ":memory:") return { status: 409, body: { error: "reset_unavailable_in_memory" } };
    let backupPath: string;
    try {
      backupPath = this.#backupStore();
    } catch {
      return { status: 500, body: { error: "backup_failed" } };
    }
    const blockCount = store.resetWorldToSeed(this.#worldId);
    if (!this.#authority.resetWorld(createSeedWorld(this.#worldId))) {
      return { status: 500, body: { error: "reset_failed" } };
    }
    this.#clearHouseProposal();
    this.#lastBuild = Object.freeze({
      inProgress: false, completedBlocks: 0, totalBlocks: 0, intervalMs: this.#buildIntervalMs,
      lastError: null, seatPlaced: false, seatError: null, demo: null,
    });
    this.#demoRun = null;
    this.#lastHouseProposalAttemptAtMs = null;
    this.#houseProposalCooldownUntilMs = 0;
    this.#lastTick = null;
    this.#setCompanionState("idle");
    // Revision went backwards: close every session so tablets re-hello against rev 0.
    const sessions = [...this.#sessions];
    this.#sessions.clear();
    for (const session of sessions) session.connection.close(1012);
    return {
      status: 200,
      body: Object.freeze({ reset: true, rev: 0, blockCount, backupPath }),
    };
  }

  /** Copies world.sqlite (+ WAL/SHM) next to the store after a WAL checkpoint. */
  #backupStore(): string {
    const store = this.#store;
    if (!store) throw new Error("store unavailable");
    store.checkpoint();
    const stamp = new Date(this.#now()).toISOString().replace(/[:.]/g, "-");
    let backupPath = `${this.#dbPath}.bak-${stamp}`;
    for (let suffix = 2; existsSync(backupPath); suffix += 1) backupPath = `${this.#dbPath}.bak-${stamp}-${suffix}`;
    copyFileSync(this.#dbPath, backupPath);
    for (const walSuffix of ["-wal", "-shm"]) {
      const source = `${this.#dbPath}${walSuffix}`;
      if (existsSync(source)) copyFileSync(source, `${backupPath}${walSuffix}`);
    }
    return backupPath;
  }

  /** Shared scripted build: same per-step validation/commit path for house and demo. */
  #startScriptedBuild(options: Readonly<{
    kind: BuildQueueState["kind"];
    proposalId: string;
    ops: readonly Extract<IntentOperation, { type: "place" }>[];
    seat: Coord;
    placeSeatAfter: boolean;
    midLine: BuildQueueState["midLine"];
    finishLine: string | null;
    finishAction: CompanionActionId | null;
  }>): void {
    const grant = this.#grant;
    if (!grant) return;
    this.#buildQueue = {
      companionId: this.#companion.companionId,
      proposalId: options.proposalId,
      plotId: grant.plotId,
      grantId: grant.grantId,
      grantRev: grant.grantRev,
      ops: options.ops,
      seat: options.seat,
      index: 0,
      completedBlocks: 0,
      expectedRev: this.#authority.snapshot.rev,
      timer: null,
      kind: options.kind,
      midLine: options.midLine ? Object.freeze({ ...options.midLine }) : null,
      finishLine: options.finishLine,
      finishAction: options.finishAction,
      placeSeatAfter: options.placeSeatAfter,
    };
    this.#setCompanionState("building");
    this.#say(COMPANION_HOUSE_START_LINE);
    this.#scheduleBuildStep(0);
  }

  #scheduleBuildStep(delayMs: number): void {
    const queue = this.#buildQueue;
    if (!queue) return;
    queue.timer = this.#buildStepScheduler(() => this.#runBuildStep(), Math.max(0, delayMs));
  }

  /** Commits exactly one planned block, then schedules the next step. */
  #runBuildStep(): void {
    const queue = this.#buildQueue;
    if (!queue) return;
    queue.timer = null;
    if (this.#store === null) {
      this.#stopBuild("host_stopping");
      return;
    }
    if (queue.index >= queue.ops.length) {
      this.#finishBuild(queue);
      return;
    }
    const grant = this.#grant;
    if (!grant || grant.revokedAt || grant.grantId !== queue.grantId || grant.grantRev !== queue.grantRev) {
      this.#stopBuild("grant_revoked");
      return;
    }
    // Re-check before each step: a player edit (or any commit) invalidates the queue.
    if (this.#authority.snapshot.rev !== queue.expectedRev) {
      this.#stopBuild("stale_revision");
      return;
    }
    const operation = queue.ops[queue.index];
    if (!operation) {
      this.#stopBuild("invalid_step");
      return;
    }
    const decision = this.#authority.commitHomeStep({
      plotId: queue.plotId,
      companionId: queue.companionId,
      grantRev: queue.grantRev,
      baseRev: queue.expectedRev,
      operation,
    }, { authenticatedOwnerUserId: this.#ownerUserId }, { trackingReady: this.#trackingReady() });
    if (!decision.accepted || !decision.commit) {
      this.#stopBuild(decision.reason ?? "build_step_rejected");
      return;
    }
    if (!this.#commitAndBroadcast(decision.commit)) {
      this.#stopBuild("commit_persist_failed");
      return;
    }
    queue.index += 1;
    queue.completedBlocks += 1;
    queue.expectedRev = decision.world.rev;
    // Scripted demo: speak the exact line between the 8 corner posts and the seat.
    if (queue.midLine && queue.completedBlocks === queue.midLine.afterBlocks) this.#say(queue.midLine.text);
    this.#scheduleBuildStep(this.#buildIntervalMs);
  }

  /** Stops the queue with an honest reason; partial blocks stay committed on purpose. */
  #stopBuild(reason: string): void {
    const queue = this.#buildQueue;
    if (!queue) return;
    this.#dropBuildQueue();
    this.#lastBuild = Object.freeze({
      inProgress: false,
      completedBlocks: queue.completedBlocks,
      totalBlocks: queue.ops.length,
      intervalMs: this.#buildIntervalMs,
      lastError: reason,
      seatPlaced: false,
      seatError: null,
      demo: queue.kind === "house" ? null : queue.kind,
    });
    this.#demoRun = null;
    this.#settleBuildIdle();
    this.#setCompanionState("idle");
    this.#say(COMPANION_HOUSE_STOPPED_LINE);
  }

  /**
   * Queue finished. House flow: try one last seat placement, then idle + done line + sit.
   * Scripted lazy-house flow: the stairs is already the 9th committed op, then a short
   * line + `companion_action sit` (reusing the existing expression signal) + idle.
   */
  #finishBuild(queue: BuildQueueState): void {
    this.#dropBuildQueue();
    let seatPlaced = false;
    let seatError: string | null = null;
    const grant = this.#grant;
    if (queue.placeSeatAfter) {
      if (grant && !grant.revokedAt && this.#authority.snapshot.rev === queue.expectedRev) {
        const seatDecision = this.#authority.commitHomeStep({
          plotId: queue.plotId,
          companionId: queue.companionId,
          grantRev: queue.grantRev,
          baseRev: queue.expectedRev,
          operation: Object.freeze({ type: "place", at: queue.seat, blockId: HOUSE_SEAT_BLOCK_ID }),
        }, { authenticatedOwnerUserId: this.#ownerUserId }, { trackingReady: this.#trackingReady() });
        if (seatDecision.accepted && seatDecision.commit) {
          if (this.#commitAndBroadcast(seatDecision.commit)) seatPlaced = true;
          else seatError = "commit_persist_failed";
        } else {
          seatError = seatDecision.reason ?? "seat_rejected";
        }
      } else if (!grant || grant.revokedAt) {
        seatError = "grant_revoked";
      } else {
        seatError = "stale_revision";
      }
    }
    this.#lastBuild = Object.freeze({
      inProgress: false,
      completedBlocks: queue.completedBlocks,
      totalBlocks: queue.ops.length,
      intervalMs: this.#buildIntervalMs,
      lastError: null,
      seatPlaced,
      seatError,
      demo: queue.kind === "house" ? null : queue.kind,
    });
    this.#demoRun = null;
    this.#settleBuildIdle();
    // Do not immediately ask to build another house right after finishing one.
    this.#houseProposalCooldownUntilMs = this.#now() + HOUSE_PROPOSAL_POST_BUILD_COOLDOWN_MS;
    if (queue.kind === "lazy-house") {
      // Demo order: closing line → sit expression → idle.
      if (queue.finishLine) this.#say(queue.finishLine);
      if (queue.finishAction) this.#broadcastCompanionAction(queue.finishAction);
      this.#setCompanionState("idle");
    } else {
      this.#setCompanionState("idle");
      if (queue.finishLine) this.#say(queue.finishLine);
      // Reuse the existing companion_action "sit" signal; no new expression frame.
      if (queue.finishAction) this.#broadcastCompanionAction(queue.finishAction);
    }
    const primary = this.#findCompanion(this.#companion.companionId);
    if (primary && primary.activeAction !== "sit") {
      const nextProfiles = this.#replaceIn(primary.companionId, Object.freeze({ ...primary, activeAction: "sit" as const }));
      if (this.#saveSocial(nextProfiles)) this.#companionProfiles = nextProfiles;
    }
  }

  #dropBuildQueue(): void {
    const queue = this.#buildQueue;
    this.#buildQueue = null;
    queue?.timer?.();
  }

  /**
   * Revokes the current home grant (loopback/demo helper for the PC panel and tests).
   * A running build queue stops on its next step with `grant_revoked`.
   */
  revokeHomeGrant(): boolean {
    const grant = this.#grant;
    const store = this.#store;
    if (!grant || grant.revokedAt || !store) return false;
    if (!this.#authority.revokeHomeGrant(grant.plotId, { authenticatedOwnerUserId: this.#ownerUserId })) return false;
    const revokedGrant: HomePlotGrant = Object.freeze({ ...grant, revokedAt: new Date(this.#now()).toISOString() });
    store.saveGrant(revokedGrant);
    this.#grant = revokedGrant;
    this.#clearHouseProposal();
    if (this.#buildQueue) this.#stopBuild("grant_revoked");
    this.#setCompanionState("idle");
    return true;
  }

  #handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(request.url ?? "/", `http://${this.#host}:${this.#port}`);
    if (url.pathname !== "/api/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    let connection: WsConnection;
    try {
      connection = WsConnection.accept(request as unknown as { headers: Record<string, string | string[] | undefined> }, socket, head);
    } catch {
      return;
    }
    const session: Session = { connection, clientId: "", lastAppliedRev: 0, authenticated: false };
    this.#sessions.add(session);
    connection.attach({
      onMessage: (text) => this.#onMessage(session, text),
      onClose: () => { this.#sessions.delete(session); },
    });
  }

  #send(session: Session, message: ServerMessage): void {
    session.connection.sendText(JSON.stringify(message));
  }

  #onMessage(session: Session, text: string): void {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      session.connection.close(1007);
      return;
    }
    const parsed = validateClientMessage(raw);
    if (!parsed.ok) {
      session.connection.close(1008);
      return;
    }
    const message = parsed.value;

    if (message.type === "hello") {
      const record = this.#tokens.get(sha256(message.credential));
      if (!record || record.expiresAtMs <= this.#now() || message.worldId !== this.#worldId) {
        session.connection.close(1008);
        return;
      }
      session.authenticated = true;
      session.clientId = message.clientId;
      session.lastAppliedRev = message.lastAppliedRev;
      // Sequence numbers are scoped to one live connection.
      this.#authority.resetClientSequence(message.clientId);
      this.#send(session, this.#welcome());
      this.#send(session, {
        protocolVersion: 1,
        type: "companion_state",
        worldId: this.#worldId,
        companionId: this.#companion.companionId,
        state: this.#grant ? "idle" : "observing",
        updatedAtMs: this.#now(),
      });
      return;
    }

    if (!session.authenticated) {
      session.connection.close(1008);
      return;
    }

    if (message.type === "ping") {
      this.#send(session, { protocolVersion: 1, type: "pong", worldId: this.#worldId, nonce: message.nonce });
      return;
    }
    if (message.type === "resync") {
      this.#send(session, this.#welcome());
      return;
    }
    if (message.type === "intent") {
      this.#handleIntent(session, message);
      return;
    }
    session.connection.close(1008);
  }

  #handleIntent(session: Session, intent: ClientIntent): void {
    const decision = this.#authority.handleIntent(intent);
    this.#send(session, decision.ack);
    if (!decision.ack.accepted || !decision.commit) return;
    if (!this.#commitAndBroadcast(decision.commit)) session.connection.close(1011);
  }

  #welcome(): ServerMessage {
    return {
      protocolVersion: 1,
      type: "welcome",
      worldId: this.#worldId,
      rev: this.#authority.snapshot.rev,
      snapshot: worldStateToObject(this.#authority.snapshot),
      worldSchemaHash: WORLD_SCHEMA_HASH,
      blockCatalogHash: BLOCK_CATALOG_HASH,
    };
  }

  async #readJson(
    request: IncomingMessage,
    maxBytes: number = MAX_HTTP_BODY_BYTES,
  ): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return { ok: false, status: 415, error: "content_type_required" };
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      if (bytes > maxBytes) return { ok: false, status: 413, error: "payload_too_large" };
      chunks.push(buffer);
    }
    try {
      return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { ok: false, status: 400, error: "invalid_json" };
    }
  }
}
