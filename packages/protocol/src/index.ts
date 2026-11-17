import { WORLD_CELL_COUNT, coordToIndex, isBlockId, isCoord, type BlockId, type Coord } from "@fangcun/world-schema";

export const PROTOCOL_VERSION = 1 as const;

export type IntentOperation =
  | Readonly<{ type: "place"; at: Coord; blockId: BlockId }>
  | Readonly<{ type: "break"; at: Coord; expectedBlock: BlockId }>;

export type ClientIntent = Readonly<{
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "intent";
  worldId: string;
  clientId: string;
  seq: number;
  baseRev: number;
  operation: IntentOperation;
}>;

export type ServerAck = Readonly<{
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "ack";
  worldId: string;
  seq: number;
  accepted: boolean;
  reason?: string;
  committedRev: number;
}>;

export type HelloMessage = Readonly<{ protocolVersion: typeof PROTOCOL_VERSION; type: "hello"; worldId: string; clientId: string; credential: string; lastAppliedRev: number }>;
export type WelcomeMessage = Readonly<{ protocolVersion: typeof PROTOCOL_VERSION; type: "welcome"; worldId: string; rev: number; snapshot: Readonly<{ schemaVersion: 1; worldId: string; rev: number; blocks: readonly (BlockId | null)[] }>; worldSchemaHash: string; blockCatalogHash: string }>;
export type ResyncMessage = Readonly<{ protocolVersion: typeof PROTOCOL_VERSION; type: "resync"; worldId: string; lastAppliedRev: number }>;
export type ApprovePlanMessage = Readonly<{ protocolVersion: typeof PROTOCOL_VERSION; type: "approve_plan"; worldId: string; planId: string; diffHash: string; shownBaseRev: number }>;
export type PingMessage = Readonly<{ protocolVersion: typeof PROTOCOL_VERSION; type: "ping"; worldId: string; nonce: string }>;
export type PongMessage = Readonly<{ protocolVersion: typeof PROTOCOL_VERSION; type: "pong"; worldId: string; nonce: string }>;
export type ApprovalGrantedMessage = Readonly<{ protocolVersion: typeof PROTOCOL_VERSION; type: "approval_granted"; worldId: string; planId: string; approvalId: string; diffHash: string; expiresAt: number }>;
export type CompanionStateName = "idle" | "observing" | "planning" | "awaiting_approval" | "building" | "cooldown" | "paused";

export type CompanionStateMessage = Readonly<{
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "companion_state";
  worldId: string;
  companionId: string;
  state: CompanionStateName;
  updatedAtMs: number;
}>;

export type CompanionSayMessage = Readonly<{
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "companion_say";
  worldId: string;
  companionId: string;
  text: string;
  expiresAtMs: number;
}>;

export type ClientMessage = ClientIntent | HelloMessage | ResyncMessage | ApprovePlanMessage | PingMessage;
export type ServerMessage = WelcomeMessage | ServerAck | CommitMessage | PongMessage | ApprovalGrantedMessage | CompanionStateMessage | CompanionSayMessage;

export type CommitMessage = Readonly<{
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "commit";
  worldId: string;
  rev: number;
  txId: string;
  actor: "player" | "ai" | "system";
  operations: readonly IntentOperation[];
}>;

export type ValidationResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

export const MAX_CLIENT_FRAME_BYTES = 16 * 1024;
export const MAX_SERVER_FRAME_BYTES = 512 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
}

function isNonEmptyString(value: unknown, maxLength = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function isRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validateServerAck(value: unknown): ValidationResult<ServerAck> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "ack") return { ok: false, error: "unsupported_message" };
  const keys = value.accepted === true ? ["protocolVersion", "type", "worldId", "seq", "accepted", "committedRev"] : ["protocolVersion", "type", "worldId", "seq", "accepted", "reason", "committedRev"];
  if (!hasExactKeys(value, keys)) return { ok: false, error: "invalid_message_shape" };
  if (!isNonEmptyString(value.worldId) || !Number.isSafeInteger(value.seq) || (value.seq as number) < 1 || !isRevision(value.committedRev)) return { ok: false, error: "invalid_ack" };
  if (value.accepted === true) return { ok: true, value: Object.freeze({ protocolVersion: PROTOCOL_VERSION, type: "ack", worldId: value.worldId, seq: value.seq as number, accepted: true, committedRev: value.committedRev as number }) };
  if (value.accepted === false && isNonEmptyString(value.reason)) return { ok: true, value: Object.freeze({ protocolVersion: PROTOCOL_VERSION, type: "ack", worldId: value.worldId, seq: value.seq as number, accepted: false, reason: value.reason, committedRev: value.committedRev as number }) };
  return { ok: false, error: "invalid_ack" };
}

export function validateHelloMessage(value: unknown): ValidationResult<HelloMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "hello") return { ok: false, error: "unsupported_message" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "clientId", "credential", "lastAppliedRev"])) return { ok: false, error: "invalid_message_shape" };
  if (!isNonEmptyString(value.worldId) || !isNonEmptyString(value.clientId) || !isNonEmptyString(value.credential, 512) || !isRevision(value.lastAppliedRev)) return { ok: false, error: "invalid_hello" };
  return { ok: true, value: Object.freeze({ protocolVersion: PROTOCOL_VERSION, type: "hello", worldId: value.worldId, clientId: value.clientId, credential: value.credential, lastAppliedRev: value.lastAppliedRev as number }) };
}

function validateResyncMessage(value: unknown): ValidationResult<ResyncMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "resync") return { ok: false, error: "unsupported_message" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "lastAppliedRev"]) || !isNonEmptyString(value.worldId) || !isRevision(value.lastAppliedRev)) return { ok: false, error: "invalid_resync" };
  return { ok: true, value: Object.freeze({ protocolVersion: PROTOCOL_VERSION, type: "resync", worldId: value.worldId, lastAppliedRev: value.lastAppliedRev as number }) };
}

function validateHeartbeat<T extends "ping" | "pong">(value: unknown, type: T): ValidationResult<T extends "ping" ? PingMessage : PongMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== type) return { ok: false, error: "unsupported_message" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "nonce"]) || !isNonEmptyString(value.worldId) || !isNonEmptyString(value.nonce, 64)) return { ok: false, error: "invalid_heartbeat" };
  return { ok: true, value: Object.freeze({ protocolVersion: PROTOCOL_VERSION, type, worldId: value.worldId, nonce: value.nonce }) as unknown as T extends "ping" ? PingMessage : PongMessage };
}

export function validateWelcomeMessage(value: unknown): ValidationResult<WelcomeMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "welcome") return { ok: false, error: "unsupported_message" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "rev", "snapshot", "worldSchemaHash", "blockCatalogHash"])) return { ok: false, error: "invalid_message_shape" };
  if (!isNonEmptyString(value.worldId) || !isRevision(value.rev) || !isNonEmptyString(value.worldSchemaHash, 256) || !isNonEmptyString(value.blockCatalogHash, 256)) return { ok: false, error: "invalid_welcome" };
  if (!isRecord(value.snapshot) || !hasExactKeys(value.snapshot, ["schemaVersion", "worldId", "rev", "blocks"]) || value.snapshot.schemaVersion !== 1 || value.snapshot.worldId !== value.worldId || value.snapshot.rev !== value.rev || !Array.isArray(value.snapshot.blocks) || value.snapshot.blocks.length !== WORLD_CELL_COUNT) return { ok: false, error: "invalid_snapshot" };
  for (let index = 0; index < WORLD_CELL_COUNT; index += 1) {
    const block = value.snapshot.blocks[index];
    if (!Object.hasOwn(value.snapshot.blocks, index) || (block !== null && !isBlockId(block))) return { ok: false, error: "invalid_snapshot" };
  }
  return { ok: true, value: value as unknown as WelcomeMessage };
}

export function validateApprovalGrantedMessage(value: unknown): ValidationResult<ApprovalGrantedMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "approval_granted") return { ok: false, error: "unsupported_message" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "planId", "approvalId", "diffHash", "expiresAt"]) || !isNonEmptyString(value.worldId) || !isNonEmptyString(value.planId) || !isNonEmptyString(value.approvalId) || !isNonEmptyString(value.diffHash, 256) || !Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= 0) return { ok: false, error: "invalid_approval" };
  return { ok: true, value: Object.freeze({ protocolVersion: PROTOCOL_VERSION, type: "approval_granted", worldId: value.worldId, planId: value.planId, approvalId: value.approvalId, diffHash: value.diffHash, expiresAt: value.expiresAt as number }) };
}

export function validateApprovePlanMessage(value: unknown): ValidationResult<ApprovePlanMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "approve_plan") return { ok: false, error: "unsupported_message" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "planId", "diffHash", "shownBaseRev"]) || !isNonEmptyString(value.worldId) || !isNonEmptyString(value.planId) || !isNonEmptyString(value.diffHash, 256) || !isRevision(value.shownBaseRev)) return { ok: false, error: "invalid_approval_request" };
  return { ok: true, value: Object.freeze({ protocolVersion: PROTOCOL_VERSION, type: "approve_plan", worldId: value.worldId, planId: value.planId, diffHash: value.diffHash, shownBaseRev: value.shownBaseRev as number }) };
}

export function validateClientMessage(value: unknown): ValidationResult<ClientMessage> {
  if (!isRecord(value)) return { ok: false, error: "invalid_message" };
  if (value.type === "intent" || value.type === undefined) return validateClientIntent(value);
  if (value.type === "hello") return validateHelloMessage(value);
  if (value.type === "resync") return validateResyncMessage(value);
  if (value.type === "approve_plan") return validateApprovePlanMessage(value);
  if (value.type === "ping") return validateHeartbeat(value, "ping");
  return { ok: false, error: "unsupported_message" };
}

export function validateCompanionStateMessage(value: unknown): ValidationResult<CompanionStateMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "companion_state") return { ok: false, error: "unsupported_message" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "companionId", "state", "updatedAtMs"])) return { ok: false, error: "invalid_message_shape" };
  const states: readonly string[] = ["idle", "observing", "planning", "awaiting_approval", "building", "cooldown", "paused"];
  if (!isNonEmptyString(value.worldId) || !isNonEmptyString(value.companionId)
    || typeof value.state !== "string" || !states.includes(value.state)
    || !Number.isSafeInteger(value.updatedAtMs) || (value.updatedAtMs as number) < 0) {
    return { ok: false, error: "invalid_companion_state" };
  }
  return {
    ok: true,
    value: Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      type: "companion_state",
      worldId: value.worldId,
      companionId: value.companionId,
      state: value.state as CompanionStateName,
      updatedAtMs: value.updatedAtMs as number,
    }),
  };
}

export function validateCompanionSayMessage(value: unknown): ValidationResult<CompanionSayMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "companion_say") return { ok: false, error: "unsupported_message" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "companionId", "text", "expiresAtMs"])) return { ok: false, error: "invalid_message_shape" };
  if (!isNonEmptyString(value.worldId) || !isNonEmptyString(value.companionId)
    || !isNonEmptyString(value.text, 120)
    || !Number.isSafeInteger(value.expiresAtMs) || (value.expiresAtMs as number) < 0) {
    return { ok: false, error: "invalid_companion_say" };
  }
  return {
    ok: true,
    value: Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      type: "companion_say",
      worldId: value.worldId,
      companionId: value.companionId,
      text: value.text,
      expiresAtMs: value.expiresAtMs as number,
    }),
  };
}

export function validateServerMessage(value: unknown): ValidationResult<ServerMessage> {
  if (!isRecord(value)) return { ok: false, error: "invalid_message" };
  if (value.type === "ack") return validateServerAck(value);
  if (value.type === "commit" || value.type === undefined) return validateCommitMessage(value);
  if (value.type === "welcome") return validateWelcomeMessage(value);
  if (value.type === "pong") return validateHeartbeat(value, "pong");
  if (value.type === "approval_granted") return validateApprovalGrantedMessage(value);
  if (value.type === "companion_state") return validateCompanionStateMessage(value);
  if (value.type === "companion_say") return validateCompanionSayMessage(value);
  return { ok: false, error: "unsupported_message" };
}

export function validateIntentOperation(value: unknown): ValidationResult<IntentOperation> {
  if (!isRecord(value) || !isCoord(value.at)) return { ok: false, error: "invalid_operation" };
  try { coordToIndex(value.at); } catch { return { ok: false, error: "out_of_bounds" }; }
  if (value.type === "place" && hasExactKeys(value, ["type", "at", "blockId"]) && isBlockId(value.blockId)) {
    return { ok: true, value: Object.freeze({ type: "place", at: Object.freeze({ ...value.at }), blockId: value.blockId }) };
  }
  if (value.type === "break" && hasExactKeys(value, ["type", "at", "expectedBlock"]) && isBlockId(value.expectedBlock)) {
    return { ok: true, value: Object.freeze({ type: "break", at: Object.freeze({ ...value.at }), expectedBlock: value.expectedBlock }) };
  }
  return { ok: false, error: "invalid_operation" };
}

export function validateClientIntent(value: unknown): ValidationResult<ClientIntent> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "intent") return { ok: false, error: "unsupported_protocol" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "clientId", "seq", "baseRev", "operation"])) return { ok: false, error: "invalid_message_shape" };
  if (!isNonEmptyString(value.worldId) || !isNonEmptyString(value.clientId)) return { ok: false, error: "invalid_identity" };
  if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 1 || !isRevision(value.baseRev)) {
    return { ok: false, error: "invalid_sequence_or_revision" };
  }
  const operation = validateIntentOperation(value.operation);
  if (!operation.ok) return operation;
  return {
    ok: true,
    value: Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      type: "intent",
      worldId: value.worldId,
      clientId: value.clientId,
      seq: value.seq as number,
      baseRev: value.baseRev as number,
      operation: operation.value,
    }),
  };
}

export function validateCommitMessage(value: unknown): ValidationResult<CommitMessage> {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION || value.type !== "commit") return { ok: false, error: "unsupported_protocol" };
  if (!hasExactKeys(value, ["protocolVersion", "type", "worldId", "rev", "txId", "actor", "operations"])) return { ok: false, error: "invalid_message_shape" };
  if (!isNonEmptyString(value.worldId) || !isNonEmptyString(value.txId)) return { ok: false, error: "invalid_identity" };
  if (!isRevision(value.rev) || (value.rev as number) < 1) return { ok: false, error: "invalid_revision" };
  if (value.actor !== "player" && value.actor !== "ai" && value.actor !== "system") return { ok: false, error: "invalid_actor" };
  if (!Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > 256) {
    return { ok: false, error: "invalid_operations" };
  }
  const operations: IntentOperation[] = [];
  const seen = new Set<number>();
  let previousIndex = -1;
  for (const raw of value.operations) {
    const operation = validateIntentOperation(raw);
    if (!operation.ok) return operation;
    const index = coordToIndex(operation.value.at);
    if (seen.has(index)) return { ok: false, error: "duplicate_cell" };
    if (index <= previousIndex) return { ok: false, error: "non_canonical_operation_order" };
    seen.add(index);
    previousIndex = index;
    operations.push(operation.value);
  }
  return {
    ok: true,
    value: Object.freeze({
      protocolVersion: PROTOCOL_VERSION,
      type: "commit",
      worldId: value.worldId,
      rev: value.rev as number,
      txId: value.txId,
      actor: value.actor,
      operations: Object.freeze(operations),
    }),
  };
}
