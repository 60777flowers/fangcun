import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { BLOCK_IDS, WORLD_SPEC } from "@fangcun/world-schema";
import { worldStateToObject } from "@fangcun/voxel-core";
import { validateClientIntent, validateClientMessage, type ClientIntent, type CommitMessage, type CompanionActionId, type CompanionStateName, type ServerMessage } from "@fangcun/protocol";
import { WorldAuthority, type CompanionTickDecision } from "@fangcun/worldd";
import { findHomeCandidates, type HomeCandidate } from "@fangcun/companion-runtime";
import type { CompanionInstance, HomePlotGrant } from "@fangcun/companion-schema";
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
  ITEM_CATALOG,
  seedUserInventory,
  validateGiveRequest,
  type UserInventoryEntry,
} from "./items.ts";
import {
  buildLine,
  CHAT_MAX_TEXT_LENGTH,
  COMPANION_HOME_GRANTED_LINE,
  COMPANION_HOME_PROPOSAL_LINE,
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
const PAIRING_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_AUTONOMY_INTERVAL_MS = 20_000;
/** 30 messages is about 15 exchanges: enough for a demo without unbounded memory. */
const CHAT_HISTORY_LIMIT = 30;
/** Idle chatter is "occasional": one line every third idle interval, not every tick. */
const AUTONOMY_SAY_EVERY_STEPS = 3;

const WORLD_SCHEMA_HASH = `sha256:${createHash("sha256").update(JSON.stringify(WORLD_SPEC)).digest("hex")}`;
const BLOCK_CATALOG_HASH = `sha256:${createHash("sha256").update(BLOCK_IDS.join(",")).digest("hex")}`;

type Session = {
  connection: WsConnection;
  clientId: string;
  lastAppliedRev: number;
  authenticated: boolean;
};

type TickOutcome = Readonly<{ result: CompanionTickDecision; world: unknown }>;

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
    for (const grant of store.loadGrants()) {
      if (!this.#authority.restoreHomeGrant(grant)) throw new TypeError(`failed to restore grant ${grant.grantId}`);
      this.#grant = grant;
    }

    // Multi-companion social state: durable in the meta keys companionProfiles /
    // userInventory / petScale. A store written before this model (single legacy
    // meta['petProfile'] row) is migrated once; corrupt rows fail closed in the store.
    const legacyPet = store.loadLegacyPetProfile();
    const storedProfiles = store.loadCompanionProfiles();
    const storedInventory = store.loadUserInventory();
    const storedScale = store.loadPetScale();
    const resolvedProfiles = storedProfiles ?? seedCompanionProfiles(this.#ownerUserId, {
      name: legacyPet?.name ?? DEFAULT_PET_NAME,
      personaId: legacyPet?.personaId ?? this.#companion.personaId,
      activeAction: legacyPet?.activeAction ?? "stand",
    });
    const resolvedInventory = storedInventory ?? seedUserInventory();
    const resolvedScale = storedScale ?? legacyPet?.scale ?? 1;
    if (!storedProfiles || !storedInventory || storedScale === null) {
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
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.#port, this.#host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("unexpected server address");
    this.#port = address.port;
    this.#syncAutonomyTimer();
    return Object.freeze({ host: this.#host, port: this.#port, worldId: this.#worldId });
  }

  async stop(): Promise<void> {
    this.#stopAutonomyTimer();
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
      if (request.method === "GET") return send(200, this.#view(profile));
      if (request.method !== "PATCH") return send(405, { error: "method_not_allowed" });
      if (profile.ownerUserId !== this.#ownerUserId) return send(403, { error: "not_owner" });
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const parsed = validateCompanionPatch(body.value);
      if (!parsed.ok) return send(400, { error: parsed.error });
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
    if (this.#grant) return null;
    return findHomeCandidates(this.#authority.snapshot)[0] ?? null;
  }

  #coreState(): unknown {
    return {
      world: worldStateToObject(this.#authority.snapshot),
      ownerUserId: this.#ownerUserId,
      companion: this.#companion,
      candidate: this.#currentCandidate() ?? undefined,
      homeGrantActive: this.#grant !== null,
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
    return Object.freeze(ITEM_CATALOG.flatMap((item) => {
      const count = this.#userItems.get(item.itemId) ?? 0;
      return count > 0 ? [Object.freeze({ itemId: item.itemId, count })] : [];
    }));
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
      homeGrantActive: this.#grant !== null,
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
    });
    const nextProfiles = this.#replaceIn(profile.companionId, nextProfile);
    if (!this.#saveSocial(nextProfiles)) return { ok: false, status: 500, error: "companion_persist_failed" };
    this.#companionProfiles = nextProfiles;
    if (patch.name !== undefined || patch.personaId !== undefined) this.#setCompanionState(this.#companionState);
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
    return Object.freeze(ITEM_CATALOG.flatMap((item) => {
      const count = items.get(item.itemId) ?? 0;
      return count > 0 ? [Object.freeze({ itemId: item.itemId, count })] : [];
    }));
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

  #autonomyStatus(): Readonly<{ enabled: boolean; intervalMs: number; lastRunAtMs: number | null }> {
    return Object.freeze({
      enabled: this.#autonomyEnabled && this.#autonomyIntervalMs > 0,
      intervalMs: this.#autonomyIntervalMs,
      lastRunAtMs: this.#autonomyLastRunAtMs,
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
   * One self-driving behaviour per interval. Priority: propose a home while none is
   * granted (and none is pending owner approval), then build inside the grant,
   * otherwise just talk. Every world decision is delegated to WorldAuthority;
   * this scheduler never writes the world itself.
   */
  async #autonomyStep(): Promise<void> {
    if (!this.#autonomyEnabled || this.#autonomyIntervalMs <= 0 || this.#server === null) return;
    // A manual tick or a previous slow step still owns the companion; skipping
    // keeps two ticks from ever overlapping.
    if (this.#tickCount > 0) return;
    this.#autonomySteps += 1;
    this.#autonomyLastRunAtMs = this.#now();
    if (!this.#companion.autonomyEnabled) return;
    try {
      if (!this.#grant) {
        if (this.#lastTick?.status === "home_approval_required" && this.#lastTick.candidate) {
          this.#maybeAutonomySay();
          return;
        }
        await this.#runTick();
        return;
      }
      const outcome = await this.#runTick();
      if (outcome.result.status !== "committed") this.#maybeAutonomySay();
    } catch {
      // A best-effort step must never take the Host down; the next interval retries.
    }
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
      allowedBlockIds: Object.freeze(["planks", "glass"] as const),
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

  async #readJson(request: IncomingMessage): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
    const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (contentType !== "application/json") return { ok: false, status: 415, error: "content_type_required" };
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of request) {
      const buffer = chunk as Buffer;
      bytes += buffer.length;
      if (bytes > MAX_HTTP_BODY_BYTES) return { ok: false, status: 413, error: "payload_too_large" };
      chunks.push(buffer);
    }
    try {
      return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return { ok: false, status: 400, error: "invalid_json" };
    }
  }
}
