import { DatabaseSync } from "node:sqlite";
import { BLOCK_IDS, WORLD_CELL_COUNT, type BlockId } from "@fangcun/world-schema";
import { createSeedWorld, worldStateFromObject, type WorldState } from "@fangcun/voxel-core";
import type { CommitMessage } from "@fangcun/protocol";
import type { CompanionInstance, HomePlotGrant } from "@fangcun/companion-schema";
import {
  companionProfilesDocument,
  parseStoredCompanionProfiles,
  type CompanionProfile,
} from "./companions.ts";
import {
  parseStoredUserInventory,
  userInventoryDocument,
  WAREHOUSE_SEED_VERSION,
  type UserInventoryEntry,
} from "./items.ts";
import {
  parseLegacyPetProfile,
  parseStoredPetScale,
  petScaleDocument,
  type LegacyPetProfile,
} from "./pet.ts";

/**
 * Durable Host storage. The world snapshot, the commit log and the companion
 * grants are written in one SQLite transaction so a crash can never publish a
 * revision that the commit log does not contain.
 */

const BLOCK_CODE = new Map<BlockId, number>(BLOCK_IDS.map((id, index) => [id, index + 1]));
const CODE_BLOCK = new Map<number, BlockId>(BLOCK_IDS.map((id, index) => [index + 1, id]));

function encodeBlocks(blocks: readonly (BlockId | null)[]): Uint8Array {
  const bytes = new Uint8Array(WORLD_CELL_COUNT);
  for (let index = 0; index < WORLD_CELL_COUNT; index += 1) {
    const block = blocks[index] ?? null;
    if (block === null) continue;
    const code = BLOCK_CODE.get(block);
    if (code === undefined) throw new TypeError(`unknown block id at ${index}`);
    bytes[index] = code;
  }
  return bytes;
}

function decodeBlocks(raw: unknown): readonly (BlockId | null)[] {
  if (!(raw instanceof Uint8Array) || raw.length !== WORLD_CELL_COUNT) throw new TypeError("corrupt world blob");
  const blocks: (BlockId | null)[] = new Array(WORLD_CELL_COUNT).fill(null);
  for (let index = 0; index < WORLD_CELL_COUNT; index += 1) {
    const code = raw[index]!;
    if (code === 0) continue;
    const block = CODE_BLOCK.get(code);
    if (block === undefined) throw new TypeError(`corrupt block code ${code} at ${index}`);
    blocks[index] = block;
  }
  return blocks;
}

export type StoredCommit = Readonly<{ commit: CommitMessage; atMs: number }>;

export class HostStore {
  readonly #db: DatabaseSync;
  readonly #now: () => number;

  constructor(dbPath: string, now: () => number = Date.now) {
    this.#db = new DatabaseSync(dbPath);
    this.#now = now;
    try {
      this.#migrate();
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  #migrate(): void {
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA synchronous = FULL");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS world (
          id TEXT PRIMARY KEY,
          rev INTEGER NOT NULL,
          blocks BLOB NOT NULL,
          updated_at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS commits (
          rev INTEGER PRIMARY KEY,
          tx_id TEXT NOT NULL UNIQUE,
          actor TEXT NOT NULL,
          world_id TEXT NOT NULL,
          ops_json TEXT NOT NULL,
          at_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS grant (
          grant_id TEXT PRIMARY KEY,
          plot_id TEXT NOT NULL UNIQUE,
          grant_rev INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS companion (
          companion_id TEXT PRIMARY KEY,
          json TEXT NOT NULL
        );
      `);
      const version = this.#db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value?: string } | undefined;
      if (!version) {
        this.#db.prepare("INSERT INTO meta(key, value) VALUES ('schemaVersion', '1')").run();
      } else if (version.value !== "1") {
        throw new TypeError(`unsupported store schema ${String(version.value)}`);
      }
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  get schemaVersion(): number {
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value?: string } | undefined;
    return Number(row?.value ?? 0);
  }

  /** Returns the persisted world, or seeds and persists a new one when absent. */
  loadOrSeedWorld(worldId: string): WorldState {
    const row = this.#db.prepare("SELECT id, rev, blocks FROM world LIMIT 1").get() as { id?: string; rev?: number; blocks?: unknown } | undefined;
    if (!row) {
      const seeded = createSeedWorld(worldId);
      this.#writeWorld(seeded);
      this.#db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('worldId', ?)").run(seeded.worldId);
      return seeded;
    }
    if (row.id !== worldId) throw new TypeError(`store holds world ${String(row.id)}, expected ${worldId}`);
    const world = worldStateFromObject({
      schemaVersion: 1,
      worldId: row.id,
      rev: row.rev,
      blocks: decodeBlocks(row.blocks),
    });
    const maxRev = this.#db.prepare("SELECT MAX(rev) AS rev FROM commits").get() as { rev?: number | null } | undefined;
    const logged = maxRev?.rev ?? 0;
    if (logged !== world.rev) throw new TypeError(`commit log (${logged}) disagrees with world revision (${world.rev})`);
    return world;
  }

  #writeWorld(world: WorldState): void {
    this.#db
      .prepare("INSERT INTO world(id, rev, blocks, updated_at_ms) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET rev = excluded.rev, blocks = excluded.blocks, updated_at_ms = excluded.updated_at_ms")
      .run(world.worldId, world.rev, encodeBlocks(world.blocks), this.#now());
  }

  /**
   * Publishes one accepted revision. The commit row and the world snapshot are
   * written atomically; a failure leaves the previous revision authoritative.
   */
  commit(world: WorldState, commit: CommitMessage): void {
    if (commit.worldId !== world.worldId) throw new TypeError("commit/world mismatch");
    if (commit.rev !== world.rev) throw new TypeError("commit revision must equal world revision");
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#db
        .prepare("INSERT INTO commits(rev, tx_id, actor, world_id, ops_json, at_ms) VALUES (?, ?, ?, ?, ?, ?)")
        .run(commit.rev, commit.txId, commit.actor, commit.worldId, JSON.stringify(commit.operations), this.#now());
      this.#writeWorld(world);
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  recentCommits(limit = 64): readonly StoredCommit[] {
    const rows = this.#db
      .prepare("SELECT rev, tx_id, actor, world_id, ops_json, at_ms FROM commits ORDER BY rev DESC LIMIT ?")
      .all(limit) as Array<{ rev: number; tx_id: string; actor: string; world_id: string; ops_json: string; at_ms: number }>;
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          atMs: row.at_ms,
          commit: Object.freeze({
            protocolVersion: 1 as const,
            type: "commit" as const,
            worldId: row.world_id,
            rev: row.rev,
            txId: row.tx_id,
            actor: row.actor as CommitMessage["actor"],
            operations: JSON.parse(row.ops_json) as CommitMessage["operations"],
          }),
        }),
      ),
    );
  }

  saveGrant(grant: HomePlotGrant): void {
    this.#db
      .prepare("INSERT INTO grant(grant_id, plot_id, grant_rev, json) VALUES (?, ?, ?, ?) ON CONFLICT(grant_id) DO UPDATE SET grant_rev = excluded.grant_rev, json = excluded.json")
      .run(grant.grantId, grant.plotId, grant.grantRev, JSON.stringify(grant));
  }

  loadGrants(): readonly HomePlotGrant[] {
    const rows = this.#db.prepare("SELECT json FROM grant").all() as Array<{ json: string }>;
    return Object.freeze(rows.map((row) => JSON.parse(row.json) as HomePlotGrant));
  }

  saveCompanion(companion: CompanionInstance): void {
    this.#db
      .prepare("INSERT INTO companion(companion_id, json) VALUES (?, ?) ON CONFLICT(companion_id) DO UPDATE SET json = excluded.json")
      .run(companion.companionId, JSON.stringify(companion));
  }

  loadCompanions(): readonly CompanionInstance[] {
    const rows = this.#db.prepare("SELECT json FROM companion").all() as Array<{ json: string }>;
    return Object.freeze(rows.map((row) => JSON.parse(row.json) as CompanionInstance));
  }

  /**
   * Multi-companion social state lives in the generic `meta` table so the companion
   * row schema (shared with the world authority) stays stable. The four keys are
   * written in one SQLite transaction by {@link saveSocialState}: a transfer must never
   * persist a decremented inventory without its companion item (or vice versa), and the
   * demo warehouse seed revision is committed with the inventory it describes.
   */
  saveSocialState(
    companions: readonly CompanionProfile[],
    inventory: readonly UserInventoryEntry[],
    petScale: number,
  ): void {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      this.#writeMeta("companionProfiles", JSON.stringify(companionProfilesDocument(companions)));
      this.#writeMeta("userInventory", JSON.stringify(userInventoryDocument(inventory)));
      this.#writeMeta("petScale", JSON.stringify(petScaleDocument(petScale)));
      this.#writeMeta("warehouseSeedVersion", String(WAREHOUSE_SEED_VERSION));
      this.#db.exec("COMMIT");
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  loadCompanionProfiles(): readonly CompanionProfile[] | null {
    const raw = this.#readMeta("companionProfiles");
    return raw === null ? null : parseStoredCompanionProfiles(parseJsonMeta(raw, "companion profiles"));
  }

  loadUserInventory(): readonly UserInventoryEntry[] | null {
    const raw = this.#readMeta("userInventory");
    return raw === null ? null : parseStoredUserInventory(parseJsonMeta(raw, "user inventory"));
  }

  loadPetScale(): number | null {
    const raw = this.#readMeta("petScale");
    return raw === null ? null : parseStoredPetScale(parseJsonMeta(raw, "pet scale"));
  }

  /**
   * Demo warehouse seed revision. `null` means the store was written before this
   * bookkeeping existed, i.e. the single-item v0 seed (revision 1).
   */
  loadWarehouseSeedVersion(): number | null {
    const raw = this.#readMeta("warehouseSeedVersion");
    if (raw === null) return null;
    const version = Number(raw);
    if (!Number.isSafeInteger(version) || version < 1) throw new TypeError("corrupt stored warehouse seed version");
    return version;
  }

  /**
   * Legacy single-pet row written before the multi-companion model. Read once at
   * startup to migrate `name/personaId/activeAction/scale` into the new keys; never
   * written again.
   */
  loadLegacyPetProfile(): LegacyPetProfile | null {
    const raw = this.#readMeta("petProfile");
    return raw === null ? null : parseLegacyPetProfile(parseJsonMeta(raw, "pet profile"));
  }

  #readMeta(key: string): string | null {
    const row = this.#db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  }

  #writeMeta(key: string, value: string): void {
    this.#db
      .prepare("INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  close(): void {
    this.#db.close();
  }
}

function parseJsonMeta(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError(`corrupt stored ${label}: invalid JSON`);
  }
}
