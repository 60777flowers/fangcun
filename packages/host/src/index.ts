import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { BLOCK_IDS, WORLD_SPEC } from "@fangcun/world-schema";
import { worldStateToObject } from "@fangcun/voxel-core";
import { validateClientMessage, type ClientIntent, type ServerMessage } from "@fangcun/protocol";
import { WorldAuthority, type CompanionTickDecision } from "@fangcun/worldd";
import { findHomeCandidates } from "@fangcun/companion-runtime";
import type { CompanionInstance, HomePlotGrant } from "@fangcun/companion-schema";
import { HostStore } from "./persistence.ts";
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

const WORLD_SCHEMA_HASH = `sha256:${createHash("sha256").update(JSON.stringify(WORLD_SPEC)).digest("hex")}`;
const BLOCK_CATALOG_HASH = `sha256:${createHash("sha256").update(BLOCK_IDS.join(",")).digest("hex")}`;

type Session = {
  connection: WsConnection;
  clientId: string;
  lastAppliedRev: number;
  authenticated: boolean;
};

export type PairingCode = Readonly<{ code: string; expiresAtMs: number }>;
export type HostOptions = Readonly<{
  worldId?: string;
  host?: string;
  port?: number;
  dbPath?: string;
  ownerUserId?: string;
  nowMs?: () => number;
  idFactory?: () => string;
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
  #lastTick: CompanionTickDecision | null = null;
  #grant: HomePlotGrant | null = null;

  constructor(options: HostOptions = {}) {
    this.#worldId = options.worldId ?? "fangcun-local";
    this.#host = options.host ?? "127.0.0.1";
    this.#port = options.port ?? 8765;
    this.#ownerUserId = options.ownerUserId ?? "local-user";
    this.#now = options.nowMs ?? Date.now;
    this.#idFactory = options.idFactory ?? (() => randomUUID());
    this.#dbPath = options.dbPath ?? ":memory:";
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
    return Object.freeze({ host: this.#host, port: this.#port, worldId: this.#worldId });
  }

  async stop(): Promise<void> {
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

    const token = bearerToken(request);
    const session = token ? this.#tokens.get(sha256(token)) : undefined;
    if (!token || !session || session.expiresAtMs <= this.#now()) return send(401, { error: "unauthorized" });

    if (request.method === "GET" && url.pathname === "/api/state") {
      return send(200, {
        world: worldStateToObject(this.#authority.snapshot),
        ownerUserId: this.#ownerUserId,
        companion: this.#companion,
        candidate: this.#lastTick?.status === "home_approval_required" ? this.#lastTick.candidate : undefined,
        homeGrantActive: this.#grant !== null,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/companion/tick") {
      const result = await this.#authority.runCompanionTick({ authenticatedOwnerUserId: this.#ownerUserId }, { trackingReady: true });
      this.#lastTick = result;
      if (result.status === "committed" && result.commit) {
        try {
          this.#store!.commit(this.#authority.snapshot, result.commit);
        } catch {
          return send(500, { error: "commit_persist_failed" });
        }
        for (const peer of this.#sessions) {
          if (!peer.authenticated) continue;
          this.#send(peer, result.commit);
          peer.lastAppliedRev = result.commit.rev;
        }
      }
      return send(200, { result, world: worldStateToObject(this.#authority.snapshot) });
    }

    if (request.method === "POST" && url.pathname === "/api/home/approve") {
      const body = await this.#readJson(request);
      if (!body.ok) return send(body.status, { error: body.error });
      const input = body.value as { candidateId?: unknown };
      if (typeof input.candidateId !== "string") return send(400, { error: "invalid_home_approval" });
      const candidate = findHomeCandidates(this.#authority.snapshot)[0];
      if (!candidate || candidate.candidateId !== input.candidateId) return send(409, { error: "candidate_stale" });
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
      }
      return send(approved ? 200 : 409, { approved, world: worldStateToObject(this.#authority.snapshot) });
    }

    send(404, { error: "not_found" });
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
    const commit = decision.commit;
    try {
      this.#store!.commit(decision.world, commit);
    } catch {
      session.connection.close(1011);
      return;
    }
    session.lastAppliedRev = commit.rev;
    for (const peer of this.#sessions) {
      if (!peer.authenticated) continue;
      this.#send(peer, commit);
      peer.lastAppliedRev = commit.rev;
    }
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
