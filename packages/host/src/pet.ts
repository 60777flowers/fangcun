import {
  COMPANION_ACTION_IDS,
  isCompanionActionId,
  type CompanionActionId,
  type ValidationResult,
} from "@fangcun/protocol";

/**
 * Desktop-pet configuration shared by the `/api/core/pet` endpoints and the
 * multi-companion model in `companions.ts`.
 *
 * The action ids are the protocol's stable wire ids ({@link COMPANION_ACTION_IDS});
 * display names never travel on the wire, so the only action list the UI renders is
 * the one `GET /api/core/pet` returns. `name`, `personaId` and `activeAction` are now
 * stored on the primary companion profile; this module owns the action catalog, the
 * shared name/scale bounds and the one-time migration of the legacy single-pet row.
 */

export const PET_NAME_MIN_LENGTH = 1;
export const PET_NAME_MAX_LENGTH = 24;
export const PET_PERSONA_ID_MAX_LENGTH = 64;
export const PET_SCALE_MIN = 0.5;
export const PET_SCALE_MAX = 3;
export const DEFAULT_PET_NAME = "小鱼";
/** How long the tablet should keep playing a one-off action. */
export const COMPANION_ACTION_TTL_MS = 6_000;

export type PetAction = Readonly<{ id: CompanionActionId; displayName: string }>;

export const PET_ACTIONS: readonly PetAction[] = Object.freeze([
  Object.freeze({ id: "stand", displayName: "站立" }),
  Object.freeze({ id: "sit", displayName: "坐下" }),
  Object.freeze({ id: "lie", displayName: "躺下" }),
  Object.freeze({ id: "wave", displayName: "挥手" }),
  Object.freeze({ id: "jump", displayName: "跳一跳" }),
  Object.freeze({ id: "look_around", displayName: "张望" }),
]);

// Fail loudly if the action catalog and the wire contract drift apart: the UI renders
// PET_ACTIONS, while the validator accepts exactly COMPANION_ACTION_IDS.
if (PET_ACTIONS.length !== COMPANION_ACTION_IDS.length
  || PET_ACTIONS.some((action) => !COMPANION_ACTION_IDS.includes(action.id))) {
  throw new TypeError("pet action catalog disagrees with COMPANION_ACTION_IDS");
}

export type PetPatch = Readonly<{
  name?: string;
  personaId?: string;
  scale?: number;
  action?: CompanionActionId;
}>;

const PET_PATCH_FIELDS: ReadonlySet<string> = new Set(["name", "personaId", "scale", "action"]);

/**
 * Strict pet patch validator: unknown fields are rejected (`additionalProperties`),
 * strings are bounded and trimmed, and only action ids the Host knows are accepted.
 */
export function validatePetPatch(value: unknown): ValidationResult<PetPatch> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "invalid_pet_request" };
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!PET_PATCH_FIELDS.has(key)) return { ok: false, error: "unknown_pet_field" };
  }
  const patch: { name?: string; personaId?: string; scale?: number; action?: CompanionActionId } = {};
  if (Object.hasOwn(input, "name")) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < PET_NAME_MIN_LENGTH || name.length > PET_NAME_MAX_LENGTH) return { ok: false, error: "invalid_pet_name" };
    patch.name = name;
  }
  if (Object.hasOwn(input, "personaId")) {
    const personaId = typeof input.personaId === "string" ? input.personaId.trim() : "";
    if (personaId.length < 1 || personaId.length > PET_PERSONA_ID_MAX_LENGTH) return { ok: false, error: "invalid_pet_persona" };
    patch.personaId = personaId;
  }
  if (Object.hasOwn(input, "scale")) {
    const scale = input.scale;
    if (typeof scale !== "number" || !Number.isFinite(scale) || scale < PET_SCALE_MIN || scale > PET_SCALE_MAX) {
      return { ok: false, error: "invalid_pet_scale" };
    }
    patch.scale = scale;
  }
  if (Object.hasOwn(input, "action")) {
    const action = input.action;
    if (!isCompanionActionId(action)) return { ok: false, error: "unknown_pet_action" };
    patch.action = action;
  }
  return { ok: true, value: Object.freeze(patch) };
}

/**
 * Legacy single-pet row (`meta['petProfile']`), read once when upgrading a store whose
 * companions predate the multi-companion model. New writes use `meta['companionProfiles']`.
 */
export type LegacyPetProfile = Readonly<{
  schemaVersion: 1;
  name: string;
  personaId: string;
  scale: number;
  activeAction: CompanionActionId;
  updatedAtMs: number;
}>;

export function parseLegacyPetProfile(value: unknown): LegacyPetProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("corrupt stored pet profile");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new TypeError(`unsupported stored pet profile schema ${String(input.schemaVersion)}`);
  const name = input.name;
  if (typeof name !== "string" || name.length < PET_NAME_MIN_LENGTH || name.length > PET_NAME_MAX_LENGTH) throw new TypeError("corrupt stored pet name");
  const personaId = input.personaId;
  if (typeof personaId !== "string" || personaId.length < 1 || personaId.length > PET_PERSONA_ID_MAX_LENGTH) throw new TypeError("corrupt stored pet persona");
  const scale = input.scale;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale < PET_SCALE_MIN || scale > PET_SCALE_MAX) throw new TypeError("corrupt stored pet scale");
  const activeAction = input.activeAction;
  if (!isCompanionActionId(activeAction)) throw new TypeError("corrupt stored pet action");
  const updatedAtMs = input.updatedAtMs;
  if (typeof updatedAtMs !== "number" || !Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) throw new TypeError("corrupt stored pet timestamp");
  return Object.freeze({ schemaVersion: 1, name, personaId, scale, activeAction, updatedAtMs });
}

export function petScaleDocument(scale: number): Readonly<{ schemaVersion: 1; scale: number }> {
  return Object.freeze({ schemaVersion: 1, scale });
}

export function parseStoredPetScale(value: unknown): number {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("corrupt stored pet scale");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new TypeError(`unsupported stored pet scale schema ${String(input.schemaVersion)}`);
  const scale = input.scale;
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale < PET_SCALE_MIN || scale > PET_SCALE_MAX) throw new TypeError("corrupt stored pet scale");
  return scale;
}
