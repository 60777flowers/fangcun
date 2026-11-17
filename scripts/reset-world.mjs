#!/usr/bin/env node
// Wipes every player/companion block and resets the world to the pristine seed island,
// keeping the pet profiles, inventories and plot grant. Use for a clean demo recording.
//
// Stop the Host first (`node scripts/run-host.mjs` must not be listening), otherwise the
// running process keeps its in-memory world and will overwrite this reset on next commit.
//
//   node scripts/reset-world.mjs [--data <dir>] [--drop-grant]

import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createSeedWorld } from "@fangcun/voxel-core";
import { BLOCK_IDS, WORLD_CELL_COUNT } from "@fangcun/world-schema";

function args() {
  const result = { data: process.env.FANGCUN_DATA ?? join(homedir(), ".fangcun"), dropGrant: false };
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--data") result.data = argv[++index];
    else if (argv[index] === "--drop-grant") result.dropGrant = true;
  }
  return result;
}

const options = args();
const dbPath = join(options.data, "world.sqlite");
if (!existsSync(dbPath)) throw new Error(`no store at ${dbPath}`);

// The Host keeps the authoritative world in memory, so run this only while it is stopped.
try {
  const probe = await fetch("http://127.0.0.1:8765/api/health", { signal: AbortSignal.timeout(800) });
  if (probe.ok) throw new Error("the Host is still running on 127.0.0.1:8765 — stop it before resetting the world");
} catch (error) {
  if (error instanceof Error && error.message.includes("still running")) throw error;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
copyFileSync(dbPath, `${dbPath}.bak-${stamp}`);
for (const suffix of ["-wal", "-shm"]) {
  if (existsSync(`${dbPath}${suffix}`)) copyFileSync(`${dbPath}${suffix}`, `${dbPath}${suffix}.bak-${stamp}`);
}
console.log(`backup: ${dbPath}.bak-${stamp}`);

const seed = createSeedWorld(`fangcun-local`);
const encoded = new Uint8Array(WORLD_CELL_COUNT);
for (let index = 0; index < WORLD_CELL_COUNT; index += 1) {
  const block = seed.blocks[index];
  if (!block) continue;
  const code = BLOCK_IDS.indexOf(block) + 1;
  if (code <= 0) throw new TypeError(`unknown block ${block} at ${index}`);
  encoded[index] = code;
}

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = FULL");
db.exec("BEGIN IMMEDIATE");
try {
  const before = db.prepare("SELECT id, rev FROM world LIMIT 1").get();
  db.prepare("UPDATE world SET rev = 0, blocks = ?, updated_at_ms = ?").run(encoded, Date.now());
  db.prepare("DELETE FROM commits").run();
  if (options.dropGrant) db.prepare("DELETE FROM grant").run();
  db.exec("COMMIT");
  console.log(`world reset: ${before?.id} rev ${before?.rev} -> 0, ${seed.blocks.filter(Boolean).length} seed blocks`);
  if (options.dropGrant) console.log("plot grant dropped; the companion will ask for a new home");
  else console.log("plot grant kept (bounds unchanged)");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
db.close();

// Old WAL/SHM files would resurrect the previous pages; they were backed up above.
for (const suffix of ["-wal", "-shm"]) {
  if (existsSync(`${dbPath}${suffix}`)) unlinkSync(`${dbPath}${suffix}`);
}
console.log(`store dir now: ${readdirSync(options.data).join(", ")}`);
