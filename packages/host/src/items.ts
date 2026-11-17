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

/**
 * Demo warehouse seed revision. Version 1 was the single-basin v0 seed; version 2 is
 * the 3-item drag-and-drop demo. A store written by an older revision is topped up
 * once, so upgrading never re-grants items the user already spent.
 */
export const WAREHOUSE_SEED_VERSION = 2;

export const V0_IRON_BASIN_ITEM_ID = "v0-iron-basin";
export const V0_WOOD_CUP_ITEM_ID = "v0-wood-cup";
export const V0_STONE_BELL_ITEM_ID = "v0-stone-bell";

export type ItemDefinition = Readonly<{
  itemId: string;
  displayName: string;
  description: string;
  /** Stable icon key the PC/DSH UI maps to its own SVG; never a URL. */
  icon: string;
}>;

/** Kept in a stable order: v0-iron-basin first, then the drag-and-drop demo items. */
export const ITEM_CATALOG: readonly ItemDefinition[] = Object.freeze([
  Object.freeze({
    itemId: V0_IRON_BASIN_ITEM_ID,
    displayName: "v0体验版小铁盆",
    description: "第一版体验发放的小铁盆，能装水，也能当见面礼。",
    icon: "basin",
  }),
  Object.freeze({
    itemId: V0_WOOD_CUP_ITEM_ID,
    displayName: "v0体验版小木杯",
    description: "一块整木头掏出来的小杯子，捧在手里是温的。",
    icon: "cup",
  }),
  Object.freeze({
    itemId: V0_STONE_BELL_ITEM_ID,
    displayName: "v0体验版小石铃",
    description: "从岛边捡来的小石头磨成的铃铛，摇起来声音很轻。",
    icon: "bell",
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

/** Builds catalog-ordered inventory entries from a count map; zero counts disappear. */
export function inventoryEntriesFromCounts(counts: ReadonlyMap<string, number>): readonly UserInventoryEntry[] {
  return Object.freeze(ITEM_CATALOG.flatMap((item) => {
    const count = counts.get(item.itemId) ?? 0;
    return count > 0 ? [Object.freeze({ itemId: item.itemId, count })] : [];
  }));
}

/**
 * Fresh demo seed: 1× each catalog item so the drag-and-drop flow is demoable
 * immediately. "Every user" is v0's single local user.
 */
export function seedUserInventory(): readonly UserInventoryEntry[] {
  return Object.freeze(ITEM_CATALOG.map((item) => Object.freeze({ itemId: item.itemId, count: 1 })));
}

/**
 * One-time demo top-up when upgrading a warehouse written by an older seed revision.
 * Only adds the items introduced after that revision; it never re-grants an item the
 * user already spent (e.g. a basin already given to a companion).
 */
export function topUpDemoWarehouse(
  entries: readonly UserInventoryEntry[],
  storedSeedVersion: number | null,
): readonly UserInventoryEntry[] {
  const fromVersion = storedSeedVersion ?? 1;
  if (fromVersion >= WAREHOUSE_SEED_VERSION) return entries;
  const counts = new Map(entries.map((entry) => [entry.itemId, entry.count] as const));
  // Version 2 introduced the two drag-and-drop demo items; v0-iron-basin already existed.
  if (fromVersion < 2) {
    for (const itemId of [V0_WOOD_CUP_ITEM_ID, V0_STONE_BELL_ITEM_ID]) {
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
  }
  return inventoryEntriesFromCounts(counts);
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
