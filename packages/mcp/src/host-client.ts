import { WORLD_CELL_COUNT, isBlockId, type BlockId, type Coord } from "@fangcun/world-schema";

/** Loopback base URL used when FANGCUN_HOST is not set. */
export const DEFAULT_HOST_URL = "http://127.0.0.1:8765";

/**
 * The two write primitives the Host accepts. Declared locally instead of importing
 * @fangcun/protocol so this package only needs the world bounds/catalog contract.
 */
export type McpIntentOperation =
  | Readonly<{ type: "place"; at: Coord; blockId: BlockId }>
  | Readonly<{ type: "break"; at: Coord; expectedBlock: BlockId }>;

export type HostWorldSnapshot = Readonly<{
  worldId: string;
  rev: number;
  /** Dense, x-fastest block array; null means empty. */
  blocks: readonly (BlockId | null)[];
}>;

export type HostBounds = Readonly<{ min: Coord; maxExclusive: Coord }>;

export type HostHomeCandidate = Readonly<{
  candidateId: string;
  bounds: HostBounds;
  score?: number;
}>;

export type HostState = Readonly<{
  world: HostWorldSnapshot;
  homeGrantActive: boolean;
  candidate?: HostHomeCandidate;
}>;

export type HostIntentOutcome = Readonly<{ accepted: boolean; reason?: string; rev: number }>;
export type HostTickOutcome = Readonly<{ status: string; committedOperations: number; rev: number }>;
export type HostApprovalOutcome = Readonly<{ approved: boolean; rev: number }>;

/** Short, user-safe failure raised when the Host is unreachable or answers with an unexpected shape. */
export class HostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readCoord(value: unknown, label: string): Coord {
  if (!isRecord(value)) throw new HostError(`Host returned invalid ${label}`);
  const { x, y, z } = value;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(z)) {
    throw new HostError(`Host returned invalid ${label}`);
  }
  return Object.freeze({ x: x as number, y: y as number, z: z as number });
}

/** The Host is a separate process, so its responses are validated instead of trusted structurally. */
function parseState(body: unknown): HostState {
  if (!isRecord(body) || !isRecord(body.world)) throw new HostError("Host returned an invalid world state");
  const world = body.world;
  if (typeof world.worldId !== "string" || world.worldId.length === 0
    || !Number.isSafeInteger(world.rev) || (world.rev as number) < 0
    || !Array.isArray(world.blocks) || world.blocks.length !== WORLD_CELL_COUNT) {
    throw new HostError("Host returned an invalid world snapshot");
  }
  const blocks: Array<BlockId | null> = [];
  for (let index = 0; index < WORLD_CELL_COUNT; index += 1) {
    const block = world.blocks[index];
    if (block !== null && !isBlockId(block)) throw new HostError("Host returned an invalid world snapshot");
    blocks.push(block);
  }
  if (typeof body.homeGrantActive !== "boolean") throw new HostError("Host returned an invalid world state");
  const snapshot: HostWorldSnapshot = Object.freeze({
    worldId: world.worldId,
    rev: world.rev as number,
    blocks: Object.freeze(blocks),
  });
  if (body.candidate === undefined) {
    return Object.freeze({ world: snapshot, homeGrantActive: body.homeGrantActive });
  }
  const rawCandidate = body.candidate;
  if (!isRecord(rawCandidate) || typeof rawCandidate.candidateId !== "string" || !isRecord(rawCandidate.bounds)) {
    throw new HostError("Host returned an invalid home candidate");
  }
  const bounds: HostBounds = Object.freeze({
    min: readCoord(rawCandidate.bounds.min, "home candidate bounds"),
    maxExclusive: readCoord(rawCandidate.bounds.maxExclusive, "home candidate bounds"),
  });
  if (rawCandidate.score !== undefined && typeof rawCandidate.score !== "number") {
    throw new HostError("Host returned an invalid home candidate");
  }
  return Object.freeze({
    world: snapshot,
    homeGrantActive: body.homeGrantActive,
    candidate: Object.freeze({
      candidateId: rawCandidate.candidateId,
      bounds,
      ...(typeof rawCandidate.score === "number" ? { score: rawCandidate.score } : {}),
    }),
  });
}

function errorCode(body: unknown, fallback: string): string {
  return isRecord(body) && typeof body.error === "string" ? body.error : fallback;
}

type HostHttpResponse = Readonly<{ status: number; body: unknown }>;

async function request(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<HostHttpResponse> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch {
    throw new HostError(`Cannot reach the Fangcun Host at ${new URL(url).origin}`);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return Object.freeze({ status: response.status, body });
}

/** Normalizes FANGCUN_HOST or the default; rejects anything that is not a plain http(s) base URL. */
export function resolveHostUrl(value?: string): string {
  const raw = (value ?? process.env.FANGCUN_HOST ?? DEFAULT_HOST_URL).trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HostError("FANGCUN_HOST is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HostError("FANGCUN_HOST must use http or https");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export type HostIntentRequest = Readonly<{
  clientId: string;
  seq: number;
  baseRev: number;
  operation: McpIntentOperation;
}>;

export type HostClient = Readonly<{
  getState(): Promise<HostState>;
  sendIntent(intent: HostIntentRequest): Promise<HostIntentOutcome>;
  companionTick(): Promise<HostTickOutcome>;
  approveHomeCandidate(candidateId: string): Promise<HostApprovalOutcome>;
  companionSay(text: string): Promise<void>;
}>;

/**
 * Thin loopback HTTP client. `fetchImpl` is injectable so tests can exercise the
 * JSON-RPC and tool layers without a live Host.
 */
export function createHostClient(baseUrl: string, fetchImpl: typeof fetch = globalThis.fetch): HostClient {
  const base = baseUrl.replace(/\/+$/, "");
  const postJson = (body: unknown): RequestInit => Object.freeze({
    method: "POST",
    headers: Object.freeze({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });

  return Object.freeze({
    async getState(): Promise<HostState> {
      const response = await request(fetchImpl, `${base}/api/core/state`, { method: "GET" });
      if (response.status !== 200) throw new HostError(`Host state request failed with HTTP ${response.status}`);
      return parseState(response.body);
    },

    async sendIntent(intent: HostIntentRequest): Promise<HostIntentOutcome> {
      const response = await request(fetchImpl, `${base}/api/core/intent`, postJson(intent));
      if (response.status !== 200) {
        throw new HostError(`Host rejected the intent: ${errorCode(response.body, `HTTP ${response.status}`)}`);
      }
      const body = response.body;
      if (!isRecord(body) || !isRecord(body.decision) || !isRecord(body.decision.ack)) {
        throw new HostError("Host returned an invalid intent decision");
      }
      const ack = body.decision.ack;
      if (typeof ack.accepted !== "boolean" || !Number.isSafeInteger(ack.committedRev) || (ack.committedRev as number) < 0) {
        throw new HostError("Host returned an invalid intent decision");
      }
      const reason = typeof ack.reason === "string" ? ack.reason : undefined;
      return Object.freeze({ accepted: ack.accepted, ...(reason ? { reason } : {}), rev: ack.committedRev as number });
    },

    async companionTick(): Promise<HostTickOutcome> {
      const response = await request(fetchImpl, `${base}/api/core/companion/tick`, { method: "POST" });
      if (response.status !== 200) throw new HostError(`Host companion tick failed with HTTP ${response.status}`);
      const body = response.body;
      if (!isRecord(body) || !isRecord(body.result) || !isRecord(body.world)
        || typeof body.result.status !== "string" || !Number.isSafeInteger(body.world.rev)) {
        throw new HostError("Host returned an invalid companion tick");
      }
      let committedOperations = 0;
      if (body.result.commit !== undefined) {
        if (!isRecord(body.result.commit) || !Array.isArray(body.result.commit.operations)) {
          throw new HostError("Host returned an invalid companion tick");
        }
        committedOperations = body.result.commit.operations.length;
      }
      return Object.freeze({
        status: body.result.status,
        committedOperations,
        rev: body.world.rev as number,
      });
    },

    async approveHomeCandidate(candidateId: string): Promise<HostApprovalOutcome> {
      const response = await request(fetchImpl, `${base}/api/core/home/approve`, postJson({ candidateId }));
      // 409 carries {approved:false, error, world}; it is a decision, not a transport failure.
      if (response.status !== 200 && response.status !== 409) {
        throw new HostError(`Host home approval failed with HTTP ${response.status}`);
      }
      const body = response.body;
      if (!isRecord(body) || typeof body.approved !== "boolean" || !isRecord(body.world) || !Number.isSafeInteger(body.world.rev)) {
        throw new HostError("Host returned an invalid home approval");
      }
      return Object.freeze({ approved: body.approved, rev: body.world.rev as number });
    },

    async companionSay(text: string): Promise<void> {
      const response = await request(fetchImpl, `${base}/api/core/companion/say`, postJson({ text }));
      if (response.status !== 200) throw new HostError(`Host companion_say failed with HTTP ${response.status}`);
    },
  });
}
