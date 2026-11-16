import { WORLD_SPEC, isCoord, type BlockId, type Coord } from "@fangcun/world-schema";

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

export type HomePlotGrant = Readonly<{
  schemaVersion: 1;
  plotId: string;
  worldId: string;
  ownerUserId: string;
  companionId: string;
  bounds: Readonly<{ min: Coord; max: Coord }>;
  allowedBlockIds: readonly BlockId[];
  maxBlocksPerPlan: number;
  maxBlocksPerDay: number;
  createdAt: string;
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

const BLOCK_ID_SET = new Set<string>(["grass", "dirt", "stone", "planks", "log", "leaves", "sand", "glass"]);
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
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value.length <= 40;
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
  const { min, max } = grant.bounds;
  return isCoord(coord) && coord.x >= min.x && coord.x < max.x && coord.y >= min.y && coord.y < max.y && coord.z >= min.z && coord.z < max.z;
}

export function validateHomePlotGrant(input: unknown): ValidationResult<HomePlotGrant> {
  if (!record(input) || !exactKeys(input, ["schemaVersion", "plotId", "worldId", "ownerUserId", "companionId", "bounds", "allowedBlockIds", "maxBlocksPerPlan", "maxBlocksPerDay", "createdAt", ...(Object.hasOwn(input, "revokedAt") ? ["revokedAt"] : [])])) return { ok: false, error: "invalid_plot_shape" };
  if (input.schemaVersion !== 1 || !text(input.plotId) || !text(input.worldId) || !text(input.ownerUserId) || !text(input.companionId)
    || !record(input.bounds) || !exactKeys(input.bounds, ["min", "max"]) || !isCoord(input.bounds.min) || !isCoord(input.bounds.max)
    || !input.bounds.min || !input.bounds.max) return { ok: false, error: "invalid_plot" };
  const min = input.bounds.min as Coord;
  const max = input.bounds.max as Coord;
  const { origin, size } = WORLD_SPEC;
  if (![min, max].every((coord) => coord.x >= origin.x && coord.x < origin.x + size.x && coord.y >= WORLD_SPEC.terrainTopY && coord.y < origin.y + size.y && coord.z >= origin.z && coord.z < origin.z + size.z)
    || max.x <= min.x || max.y <= min.y || max.z <= min.z) return { ok: false, error: "plot_out_of_bounds" };
  if (!Array.isArray(input.allowedBlockIds) || input.allowedBlockIds.length < 1 || input.allowedBlockIds.length > 8 || !input.allowedBlockIds.every((id) => typeof id === "string" && BLOCK_ID_SET.has(id))) return { ok: false, error: "invalid_plot_blocks" };
  if (!Number.isSafeInteger(input.maxBlocksPerPlan) || (input.maxBlocksPerPlan as number) < 1 || (input.maxBlocksPerPlan as number) > 64
    || !Number.isSafeInteger(input.maxBlocksPerDay) || (input.maxBlocksPerDay as number) < (input.maxBlocksPerPlan as number) || (input.maxBlocksPerDay as number) > 256
    || !isoDate(input.createdAt) || (input.revokedAt !== undefined && !isoDate(input.revokedAt))) return { ok: false, error: "invalid_plot_budget_or_date" };
  return { ok: true, value: Object.freeze({ ...input, bounds: Object.freeze({ min: Object.freeze({ ...min }), max: Object.freeze({ ...max }) }), allowedBlockIds: Object.freeze([...input.allowedBlockIds]) }) as HomePlotGrant };
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
