import {
  isCompanionActionId,
  type CompanionActionId,
  type CompanionStateName,
  type ValidationResult,
} from "@fangcun/protocol";
import { isKnownItemId, MAX_COMPANION_ITEMS } from "./items.ts";
import { PET_NAME_MAX_LENGTH, PET_NAME_MIN_LENGTH } from "./pet.ts";

/**
 * Multi-companion (v0: two fixtures) social model for the PC/DSH inspector.
 *
 * The durable unit is a {@link CompanionProfile}; `isMine` is always derived from the
 * Host owner id and is never stored. The friend fixture is a **local demo fixture**:
 * `ownerUserId: "friend-demo"` does not represent a remote user and no networking,
 * account or friend-discovery path exists. Adding a companion is a seed-entry change,
 * and the model is a list so N companions need no schema change.
 */

export const PRIMARY_COMPANION_ID = "fish-1";
export const DEMO_FRIEND_COMPANION_ID = "fish-friend-1";
export const DEMO_FRIEND_OWNER_USER_ID = "friend-demo";
export const DEMO_FRIEND_NAME = "阿石";
export const DEMO_FRIEND_PERSONALITY = "慢热，喜欢收集石头";
export const DEFAULT_PRIMARY_PERSONALITY = "好奇，喜欢聊天和盖小房子";
/** Both fixtures are rendered with the one bundled placeholder asset in v0. */
export const DEFAULT_AVATAR_MODEL_ID = "models/companion/default.vrm";

export const COMPANION_ID_MAX_LENGTH = 128;
export const OWNER_USER_ID_MAX_LENGTH = 128;
export const COMPANION_PERSONA_ID_MAX_LENGTH = 64;
export const COMPANION_PERSONALITY_MIN_LENGTH = 1;
export const COMPANION_PERSONALITY_MAX_LENGTH = 60;
export const AVATAR_MODEL_ID_MAX_LENGTH = 160;
/** Defensive bound so a corrupt store cannot make the inspector render unbounded data. */
export const MAX_COMPANIONS = 64;

const COMPANION_STATES: readonly CompanionStateName[] = Object.freeze([
  "idle",
  "observing",
  "planning",
  "awaiting_approval",
  "building",
  "cooldown",
  "paused",
]);

/** The persisted shape. Runtime `state` is display-only and reset to idle on restart. */
export type CompanionProfile = Readonly<{
  companionId: string;
  name: string;
  ownerUserId: string;
  personaId: string;
  personality: string;
  avatarModelId: string;
  state: CompanionStateName;
  activeAction: CompanionActionId;
  /** Companion bag: distinct item ids, at most {@link MAX_COMPANION_ITEMS}. */
  items: readonly string[];
}>;

export type CompanionView = Readonly<CompanionProfile & { isMine: boolean }>;

export type CompanionPatch = Readonly<{
  name?: string;
  personality?: string;
  personaId?: string;
}>;

function frozenEmptyItems(): readonly string[] {
  return Object.freeze([]);
}

export function seedCompanionProfiles(
  hostOwnerUserId: string,
  primary: Readonly<{ name: string; personaId: string; activeAction: CompanionActionId }>,
): readonly CompanionProfile[] {
  return Object.freeze([
    Object.freeze({
      companionId: PRIMARY_COMPANION_ID,
      name: primary.name,
      ownerUserId: hostOwnerUserId,
      personaId: primary.personaId,
      personality: DEFAULT_PRIMARY_PERSONALITY,
      avatarModelId: DEFAULT_AVATAR_MODEL_ID,
      state: "idle" as const,
      activeAction: primary.activeAction,
      items: frozenEmptyItems(),
    }),
    Object.freeze({
      companionId: DEMO_FRIEND_COMPANION_ID,
      name: DEMO_FRIEND_NAME,
      ownerUserId: DEMO_FRIEND_OWNER_USER_ID,
      personaId: "playful-fish",
      personality: DEMO_FRIEND_PERSONALITY,
      avatarModelId: DEFAULT_AVATAR_MODEL_ID,
      state: "idle" as const,
      activeAction: "stand" as const,
      items: frozenEmptyItems(),
    }),
  ]);
}

export function companionView(profile: CompanionProfile, hostOwnerUserId: string): CompanionView {
  return Object.freeze({ ...profile, isMine: profile.ownerUserId === hostOwnerUserId });
}

export function companionProfilesDocument(profiles: readonly CompanionProfile[]): Readonly<{
  schemaVersion: 1;
  companions: readonly CompanionProfile[];
}> {
  return Object.freeze({ schemaVersion: 1, companions: Object.freeze([...profiles]) });
}

function isCompanionStateName(value: unknown): value is CompanionStateName {
  return typeof value === "string" && COMPANION_STATES.includes(value as CompanionStateName);
}

function isBoundedString(value: unknown, minLength: number, maxLength: number): value is string {
  return typeof value === "string" && value.length >= minLength && value.length <= maxLength;
}

/** Strict inspector patch: unknown fields rejected, text trimmed and bounded. */
export function validateCompanionPatch(value: unknown): ValidationResult<CompanionPatch> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "invalid_companion_request" };
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== "name" && key !== "personality" && key !== "personaId") return { ok: false, error: "unknown_companion_field" };
  }
  const patch: { name?: string; personality?: string; personaId?: string } = {};
  if (Object.hasOwn(input, "name")) {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < PET_NAME_MIN_LENGTH || name.length > PET_NAME_MAX_LENGTH) return { ok: false, error: "invalid_companion_name" };
    patch.name = name;
  }
  if (Object.hasOwn(input, "personality")) {
    const personality = typeof input.personality === "string" ? input.personality.trim() : "";
    if (personality.length < COMPANION_PERSONALITY_MIN_LENGTH || personality.length > COMPANION_PERSONALITY_MAX_LENGTH) {
      return { ok: false, error: "invalid_companion_personality" };
    }
    patch.personality = personality;
  }
  if (Object.hasOwn(input, "personaId")) {
    const personaId = typeof input.personaId === "string" ? input.personaId.trim() : "";
    if (personaId.length < 1 || personaId.length > COMPANION_PERSONA_ID_MAX_LENGTH) return { ok: false, error: "invalid_companion_persona" };
    patch.personaId = personaId;
  }
  return { ok: true, value: Object.freeze(patch) };
}

/** Parses the persisted companion list, failing closed on any corrupt entry. */
export function parseStoredCompanionProfiles(value: unknown): readonly CompanionProfile[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("corrupt stored companion profiles");
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1) throw new TypeError(`unsupported stored companion profiles schema ${String(document.schemaVersion)}`);
  if (!Array.isArray(document.companions) || document.companions.length < 1 || document.companions.length > MAX_COMPANIONS) {
    throw new TypeError("corrupt stored companion profiles list");
  }
  const seen = new Set<string>();
  const profiles: CompanionProfile[] = [];
  for (const raw of document.companions) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new TypeError("corrupt stored companion profile");
    const profile = raw as Record<string, unknown>;
    const companionId = profile.companionId;
    if (!isBoundedString(companionId, 1, COMPANION_ID_MAX_LENGTH)) throw new TypeError("corrupt stored companion id");
    if (seen.has(companionId)) throw new TypeError(`corrupt stored duplicate companion ${companionId}`);
    seen.add(companionId);
    const name = profile.name;
    if (!isBoundedString(name, PET_NAME_MIN_LENGTH, PET_NAME_MAX_LENGTH)) throw new TypeError(`corrupt stored companion name ${companionId}`);
    const ownerUserId = profile.ownerUserId;
    if (!isBoundedString(ownerUserId, 1, OWNER_USER_ID_MAX_LENGTH)) throw new TypeError(`corrupt stored companion owner ${companionId}`);
    const personaId = profile.personaId;
    if (!isBoundedString(personaId, 1, COMPANION_PERSONA_ID_MAX_LENGTH)) throw new TypeError(`corrupt stored companion persona ${companionId}`);
    const personality = profile.personality;
    if (!isBoundedString(personality, COMPANION_PERSONALITY_MIN_LENGTH, COMPANION_PERSONALITY_MAX_LENGTH)) {
      throw new TypeError(`corrupt stored companion personality ${companionId}`);
    }
    const avatarModelId = profile.avatarModelId;
    if (!isBoundedString(avatarModelId, 1, AVATAR_MODEL_ID_MAX_LENGTH)) throw new TypeError(`corrupt stored companion avatar ${companionId}`);
    const state = profile.state;
    if (!isCompanionStateName(state)) throw new TypeError(`corrupt stored companion state ${companionId}`);
    const activeAction = profile.activeAction;
    if (!isCompanionActionId(activeAction)) throw new TypeError(`corrupt stored companion action ${companionId}`);
    if (!Array.isArray(profile.items) || profile.items.length > MAX_COMPANION_ITEMS) throw new TypeError(`corrupt stored companion items ${companionId}`);
    const items: string[] = [];
    for (const rawItem of profile.items) {
      if (!isKnownItemId(rawItem)) throw new TypeError(`corrupt stored companion item ${companionId}`);
      if (items.includes(rawItem)) throw new TypeError(`corrupt stored duplicate companion item ${companionId}`);
      items.push(rawItem);
    }
    profiles.push(Object.freeze({
      companionId,
      name,
      ownerUserId,
      personaId,
      personality,
      avatarModelId,
      state,
      activeAction,
      items: Object.freeze(items),
    }));
  }
  return Object.freeze(profiles);
}
