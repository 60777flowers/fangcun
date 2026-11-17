import type { ValidationResult } from "@fangcun/protocol";

/**
 * Frozen v0 item catalog and the inventory rules shared by the PC/DSH social views.
 *
 * Adding an item is exactly one entry in {@link ITEM_CATALOG}: display names,
 * descriptions and icons live here (never on the wire), and ids are what inventories
 * persist. All text is untrusted display data, never an authority input.
 */

/** v0 companion bags hold at most two item slots; the constant is the extensible knob. */
export const MAX_COMPANION_ITEMS = 2;
/** Defensive upper bound for a persisted user stack; keeps corrupt rows fail-closed. */
export const MAX_USER_ITEM_COUNT = 1_000_000;
export const SEED_USER_ITEM_ID = "v0-iron-basin";

export type ItemDefinition = Readonly<{
  itemId: string;
  displayName: string;
  description: string;
  icon: string;
}>;

export const ITEM_CATALOG: readonly ItemDefinition[] = Object.freeze([
  Object.freeze({
    itemId: SEED_USER_ITEM_ID,
    displayName: "v0体验版小铁盆",
    description: "第一版体验发放的小铁盆，能装水，也能当见面礼。",
    icon: "basin",
  }),
]);

const ITEM_BY_ID: ReadonlyMap<string, ItemDefinition> = new Map(
  ITEM_CATALOG.map((item) => [item.itemId, item] as const),
);

export function isKnownItemId(value: unknown): value is string {
  return typeof value === "string" && ITEM_BY_ID.has(value);
}

export function itemDefinition(itemId: string): ItemDefinition | null {
  return ITEM_BY_ID.get(itemId) ?? null;
}

/** One owned stack in the host user's inventory (`itemId` is always a catalog id). */
export type UserInventoryEntry = Readonly<{ itemId: string; count: number }>;

/** Every fresh user starts with one basin; "every user" is v0's single local user. */
export function seedUserInventory(): readonly UserInventoryEntry[] {
  return Object.freeze([Object.freeze({ itemId: SEED_USER_ITEM_ID, count: 1 })]);
}

export function userInventoryDocument(entries: readonly UserInventoryEntry[]): Readonly<{
  schemaVersion: 1;
  items: readonly UserInventoryEntry[];
}> {
  return Object.freeze({ schemaVersion: 1, items: Object.freeze([...entries]) });
}

/** Parses the persisted inventory, failing closed on unknown ids, duplicates or bad counts. */
export function parseStoredUserInventory(value: unknown): readonly UserInventoryEntry[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError("corrupt stored user inventory");
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1) throw new TypeError(`unsupported stored user inventory schema ${String(document.schemaVersion)}`);
  if (!Array.isArray(document.items)) throw new TypeError("corrupt stored user inventory items");
  const seen = new Set<string>();
  const entries: UserInventoryEntry[] = [];
  for (const raw of document.items) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new TypeError("corrupt stored user inventory entry");
    const entry = raw as Record<string, unknown>;
    const itemId = entry.itemId;
    if (!isKnownItemId(itemId)) throw new TypeError("corrupt stored user inventory item id");
    if (seen.has(itemId)) throw new TypeError(`corrupt stored user inventory duplicate ${itemId}`);
    const count = entry.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > MAX_USER_ITEM_COUNT) {
      throw new TypeError(`corrupt stored user inventory count for ${itemId}`);
    }
    seen.add(itemId);
    if (count > 0) entries.push(Object.freeze({ itemId, count }));
  }
  return Object.freeze(entries);
}

export function validateGiveRequest(value: unknown): ValidationResult<Readonly<{ companionId: string; itemId: string }>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "invalid_give_request" };
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (key !== "companionId" && key !== "itemId") return { ok: false, error: "invalid_give_request" };
  }
  const companionId = input.companionId;
  if (typeof companionId !== "string" || companionId.length < 1 || companionId.length > 128) {
    return { ok: false, error: "invalid_give_request" };
  }
  if (!Object.hasOwn(input, "itemId")) return { ok: false, error: "invalid_give_request" };
  const itemId = input.itemId;
  if (!isKnownItemId(itemId)) return { ok: false, error: "unknown_item" };
  return { ok: true, value: Object.freeze({ companionId, itemId }) };
}

export type CompanionItemAddError = "companion_inventory_full" | "item_already_held";

/**
 * Appends one item to a companion's bag. Rules decided for v0: at most
 * {@link MAX_COMPANION_ITEMS} slots and no duplicate item ids (one slot = one distinct
 * item type). The pure function is the seam that keeps these rules testable even while
 * the seeded catalog still has a single item.
 */
export function addItemToCompanion(
  items: readonly string[],
  itemId: string,
  maxItems: number = MAX_COMPANION_ITEMS,
): { ok: true; items: readonly string[] } | { ok: false; error: CompanionItemAddError } {
  if (items.length >= maxItems) return { ok: false, error: "companion_inventory_full" };
  if (items.includes(itemId)) return { ok: false, error: "item_already_held" };
  return { ok: true, items: Object.freeze([...items, itemId]) };
}
