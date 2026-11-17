import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HostStore } from "../../../packages/host/src/persistence.ts";

function tempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "fangcun-upgrade-"));
  return { path: join(dir, "world.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("fresh and previously initialized stores keep schema version 1 across repeated startup", () => {
  const db = tempDb();
  try {
    for (let startup = 0; startup < 3; startup += 1) {
      const store = new HostStore(db.path);
      assert.equal(store.schemaVersion, 1);
      assert.equal(store.loadOrSeedWorld("upgrade-world").rev, 0);
      store.close();
    }

    const raw = new DatabaseSync(db.path);
    const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    raw.close();
    assert.deepEqual(tables.map(({ name }) => name), ["commits", "companion", "grant", "meta", "world"]);
  } finally {
    db.cleanup();
  }
});

test("unsupported future schema fails closed without modifying the database", () => {
  const db = tempDb();
  try {
    const raw = new DatabaseSync(db.path);
    raw.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    raw.prepare("INSERT INTO meta(key, value) VALUES ('schemaVersion', '2')").run();
    raw.close();

    assert.throws(() => new HostStore(db.path), /unsupported store schema 2/);

    const verify = new DatabaseSync(db.path);
    assert.equal((verify.prepare("SELECT value FROM meta WHERE key = 'schemaVersion'").get() as { value: string }).value, "2");
    const tables = verify.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>;
    assert.deepEqual(tables.map(({ name }) => name), ["meta"]);
    verify.close();
  } finally {
    db.cleanup();
  }
});

