import { BLOCK_IDS, WORLD_SPEC, isCoord, type BlockId, type Coord } from "@fangcun/world-schema";

export const COMPANION_SCHEMA_VERSION = 1 as const;

export type PersonaCard = Readonly<{
  schemaVersion: 1;
  personaId: string;
  version: number;
  displayName: string;
  /** Style/voice text only; never a capability grant or executable instruction. */
  personaText: string;
  toneTags: readonly string[];
  allowedEmotes: readonly string[];
  memoryPolicy: "session-only";
}>;

export type CompanionInstance = Readonly<{
  schemaVersion: 1;
  companionId: string;
  ownerUserId: string;
  worldId: string;
  personaId: string;
  state: "idle" | "thinking" | "walking" | "building" | "talking" | "paused";
  autonomyEnabled: boolean;
  createdAt: string;
}>;

export type CellBounds = Readonly<{ min: Coord; maxExclusive: Coord }>;

/** Validated grant-shaped data; authorization still requires loading it from trusted worldd storage. */
export type HomePlotGrant = Readonly<{
  schemaVersion: 1;
  grantId: string;
  grantRev: number;
  plotId: string;
  worldId: string;
  ownerUserId: string;
  approvedByUserId: string;
  companionId: string;
  bounds: CellBounds;
  allowedBlockIds: readonly BlockId[];
  maxBlocksPerPlan: number;
  maxBlocksPerDay: number;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}>;

export type VisitInvitationV1 = Readonly<{
  schemaVersion: 1;
  visitId: string;
  hostWorldId: string;
  hostUserId: string;
  hostCompanionId: string;
  guestUserId: string;
  guestCompanionId: string;
  scope: "read-summary" | "send-greeting";
  createdAt: string;
  expiresAt: string;
  status: "pending" | "accepted" | "declined" | "expired" | "revoked";
}>;

export type VisitEventV1 = Readonly<{
  schemaVersion: 1;
  visitId: string;
  eventId: string;
  actorCompanionId: string;
  kind: "greeting" | "visit-note";
  payload: Readonly<{ text: string }>;
  createdAt: string;
}>;

export type ValidationResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

const BLOCK_ID_SET = new Set<string>(BLOCK_IDS);
const VISIT_SCOPE = new Set(["read-summary", "send-greeting"]);
const VISIT_STATUSES = new Set(["pending", "accepted", "declined", "expired", "revoked"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function text(value: unknown, max = 128): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\x00-\x1F\x7F]/.test(value);
}

function opaqueId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isoDate(value: unknown): value is string {
  return isCanonicalUtc(value);
}

export function validatePersonaCard(input: unknown): ValidationResult<PersonaCard> {
  if (!record(input) || !exactKeys(input, ["schemaVersion", "personaId", "version", "displayName", "personaText", "toneTags", "allowedEmotes", "memoryPolicy"])) return { ok: false, error: "invalid_persona_shape" };
  if (input.schemaVersion !== 1 || !text(input.personaId) || !Number.isSafeInteger(input.version) || (input.version as number) < 1
    || !text(input.displayName, 64) || typeof input.personaText !== "string" || input.personaText.length > 4_000
    || !Array.isArray(input.toneTags) || input.toneTags.length > 16 || !input.toneTags.every((tag) => text(tag, 32))
    || !Array.isArray(input.allowedEmotes) || input.allowedEmotes.length > 32 || !input.allowedEmotes.every((emote) => text(emote, 32))
    || input.memoryPolicy !== "session-only") return { ok: false, error: "invalid_persona" };
  return { ok: true, value: Object.freeze({ ...input, toneTags: Object.freeze([...input.toneTags]), allowedEmotes: Object.freeze([...input.allowedEmotes]) }) as PersonaCard };
}

export function validateCompanionInstance(input: unknown): ValidationResult<CompanionInstance> {
  if (!record(input) || !exactKeys(input, ["schemaVersion", "companionId", "ownerUserId", "worldId", "personaId", "state", "autonomyEnabled", "createdAt"])) return { ok: false, error: "invalid_instance_shape" };
  if (input.schemaVersion !== 1 || !text(input.companionId) || !text(input.ownerUserId) || !text(input.worldId) || !text(input.personaId)
    || !["idle", "thinking", "walking", "building", "talking", "paused"].includes(String(input.state))
    || typeof input.autonomyEnabled !== "boolean" || !isoDate(input.createdAt)) return { ok: false, error: "invalid_instance" };
  return { ok: true, value: Object.freeze({ ...input }) as CompanionInstance };
}

export function isInsidePlot(grant: HomePlotGrant, coord: Coord): boolean {
  const { min, maxExclusive } = grant.bounds;
  return isCoord(coord) && coord.x >= min.x && coord.x < maxExclusive.x && coord.y >= min.y && coord.y < maxExclusive.y && coord.z >= min.z && coord.z < maxExclusive.z;
}

export function isCanonicalUtc(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const canonicalMs = new Date(value).toISOString();
  const normalized = value.includes(".") ? value.replace(/\.(\d{1,3})Z$/, (_match, fraction: string) => `.${fraction.padEnd(3, "0")}Z`) : value.replace(/Z$/, ".000Z");
  return canonicalMs === normalized;
}

export function isGrantActive(grant: HomePlotGrant, nowMs: number): boolean {
  return !grant.revokedAt && Number.isFinite(nowMs) && nowMs >= Date.parse(grant.createdAt) && nowMs < Date.parse(grant.expiresAt);
}

export function validateHomePlotGrant(input: unknown): ValidationResult<HomePlotGrant> {
  if (!record(input) || !exactKeys(input, ["schemaVersion", "grantId", "grantRev", "plotId", "worldId", "ownerUserId", "approvedByUserId", "companionId", "bounds", "allowedBlockIds", "maxBlocksPerPlan", "maxBlocksPerDay", "createdAt", "expiresAt", ...(Object.hasOwn(input, "revokedAt") ? ["revokedAt"] : [])])) return { ok: false, error: "invalid_plot_shape" };
  if (input.schemaVersion !== 1 || !text(input.plotId) || !text(input.worldId) || !text(input.ownerUserId) || !text(input.companionId)
    || !opaqueId(input.grantId) || !Number.isSafeInteger(input.grantRev) || (input.grantRev as number) < 1
    || !text(input.approvedByUserId) || input.approvedByUserId !== input.ownerUserId || !record(input.bounds) || !exactKeys(input.bounds, ["min", "maxExclusive"]) || !isCoord(input.bounds.min) || !isCoord(input.bounds.maxExclusive)
    || !isCanonicalUtc(input.createdAt) || !isCanonicalUtc(input.expiresAt) || Date.parse(input.expiresAt as string) <= Date.parse(input.createdAt as string)
    || (input.revokedAt !== undefined && (!isCanonicalUtc(input.revokedAt) || Date.parse(input.revokedAt as string) < Date.parse(input.createdAt as string) || Date.parse(input.revokedAt as string) > Date.parse(input.expiresAt as string)))
    || !input.bounds.min || !input.bounds.maxExclusive) return { ok: false, error: "invalid_plot" };
  const min = input.bounds.min as Coord;
  const max = input.bounds.maxExclusive as Coord;
  const { origin, size } = WORLD_SPEC;
  // Bounds are half-open AABBs: min must reference an in-world build cell;
  // max may equal the exclusive world edge.
  if (min.x < origin.x || min.x >= origin.x + size.x || min.y < WORLD_SPEC.terrainTopY || min.y >= origin.y + size.y || min.z < origin.z || min.z >= origin.z + size.z
    || max.x > origin.x + size.x || max.y > origin.y + size.y || max.z > origin.z + size.z
    || max.x <= min.x || max.y <= min.y || max.z <= min.z
    || max.x - min.x > 6 || max.y - min.y > 8 || max.z - min.z > 6
    || (max.x - min.x) * (max.y - min.y) * (max.z - min.z) > 288) return { ok: false, error: "plot_out_of_bounds" };
  if (!Array.isArray(input.allowedBlockIds) || input.allowedBlockIds.length < 1 || input.allowedBlockIds.length > 8 || !input.allowedBlockIds.every((id) => typeof id === "string" && BLOCK_ID_SET.has(id))) return { ok: false, error: "invalid_plot_blocks" };
  if (!Number.isSafeInteger(input.maxBlocksPerPlan) || (input.maxBlocksPerPlan as number) < 1 || (input.maxBlocksPerPlan as number) > 64
    || !Number.isSafeInteger(input.maxBlocksPerDay) || (input.maxBlocksPerDay as number) < (input.maxBlocksPerPlan as number) || (input.maxBlocksPerDay as number) > 256
    || (input.revokedAt !== undefined && Date.parse(input.revokedAt as string) < Date.parse(input.createdAt as string))) return { ok: false, error: "invalid_plot_budget_or_date" };
  if (new Set(input.allowedBlockIds).size !== input.allowedBlockIds.length) return { ok: false, error: "duplicate_plot_block" };
  return { ok: true, value: Object.freeze({ ...input, bounds: Object.freeze({ min: Object.freeze({ ...min }), maxExclusive: Object.freeze({ ...max }) }), allowedBlockIds: Object.freeze([...input.allowedBlockIds]) }) as HomePlotGrant };
}

export function validateVisitInvitation(input: unknown): ValidationResult<VisitInvitationV1> {
  if (!record(input) || !exactKeys(input, ["schemaVersion", "visitId", "hostWorldId", "hostUserId", "hostCompanionId", "guestUserId", "guestCompanionId", "scope", "createdAt", "expiresAt", "status"])) return { ok: false, error: "invalid_visit_shape" };
  if (input.schemaVersion !== 1 || !text(input.visitId) || !text(input.hostWorldId) || !text(input.hostUserId) || !text(input.hostCompanionId)
    || !text(input.guestUserId) || !text(input.guestCompanionId) || !VISIT_SCOPE.has(String(input.scope)) || !isoDate(input.createdAt) || !isoDate(input.expiresAt)
    || Date.parse(input.expiresAt as string) <= Date.parse(input.createdAt as string) || !VISIT_STATUSES.has(String(input.status))) return { ok: false, error: "invalid_visit" };
  return { ok: true, value: Object.freeze({ ...input }) as VisitInvitationV1 };
}

export function validateVisitEvent(input: unknown): ValidationResult<VisitEventV1> {
  if (!record(input) || !exactKeys(input, ["schemaVersion", "visitId", "eventId", "actorCompanionId", "kind", "payload", "createdAt"])) return { ok: false, error: "invalid_visit_event_shape" };
  if (input.schemaVersion !== 1 || !text(input.visitId) || !text(input.eventId) || !text(input.actorCompanionId)
    || (input.kind !== "greeting" && input.kind !== "visit-note") || !record(input.payload) || !exactKeys(input.payload, ["text"])
    || !text(input.payload.text, 280) || !isoDate(input.createdAt)) return { ok: false, error: "invalid_visit_event" };
  return { ok: true, value: Object.freeze({ ...input, payload: Object.freeze({ text: input.payload.text }) }) as VisitEventV1 };
}
