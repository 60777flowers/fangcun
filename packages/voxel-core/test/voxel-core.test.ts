import test from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, countBlocks, createEmptyWorld, createSeedWorld, getBlock, worldStateFromObject, worldStateToObject } from "../src/index.ts";

test("seed island is deterministic and all footprint columns reach the base", () => {
  const a = createSeedWorld("test");
  const b = createSeedWorld("test");
  assert.deepEqual(a.blocks, b.blocks);
  assert.equal(countBlocks(a), 14 * 14 * 4);
  assert.equal(getBlock(a, { x: -7, y: 0, z: -7 }), "stone");
  assert.equal(getBlock(a, { x: 6, y: 3, z: 6 }), "grass");
  assert.equal(getBlock(a, { x: 7, y: 3, z: 0 }), null);
});

test("transaction applies atomically and increments exactly one revision", () => {
  const world = createEmptyWorld("test");
  const result = applyTransaction(world, [
    { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" },
    { type: "place", at: { x: 1, y: 4, z: 0 }, blockId: "glass" },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.rev, 1);
    assert.equal(getBlock(result.world, { x: 0, y: 4, z: 0 }), "planks");
    assert.equal(getBlock(result.world, { x: 1, y: 4, z: 0 }), "glass");
  }
  assert.equal(world.rev, 0);
});

test("failed multi-cell operation leaves source world untouched", () => {
  const world = createSeedWorld("test");
  const result = applyTransaction(world, [
    { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" },
    { type: "place", at: { x: 0, y: 3, z: 0 }, blockId: "stone" },
  ]);
  assert.deepEqual(result, { ok: false, code: "protected_terrain", operationIndex: 1 });
  assert.equal(world.rev, 0);
  assert.equal(getBlock(world, { x: 0, y: 4, z: 0 }), null);
});

test("duplicate cells, stale expected block, and out-of-bounds writes are rejected", () => {
  const world = createSeedWorld("test");
  assert.equal(applyTransaction(world, [
    { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" },
    { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "glass" },
  ]).ok, false);
  assert.equal(applyTransaction(world, [{ type: "break", at: { x: 0, y: 3, z: 0 }, expectedBlock: "stone" }]).ok, false);
  assert.equal(applyTransaction(world, [{ type: "place", at: { x: 8, y: 4, z: 0 }, blockId: "planks" }]).ok, false);
});

test("snapshot serialization round-trips and rejects unsupported or sparse snapshots", () => {
  const world = createSeedWorld("snapshot");
  assert.deepEqual(worldStateFromObject(worldStateToObject(world)), world);
  assert.throws(() => worldStateFromObject({ ...worldStateToObject(world), schemaVersion: 999 }), /unsupported/);
  const sparse = new Array(4096) as (string | null)[];
  assert.throws(() => worldStateFromObject({ schemaVersion: 1, worldId: "snapshot", rev: 0, blocks: sparse }), /unsupported/);
});

test("base revision and terrain policy are enforced before any write", () => {
  const world = createSeedWorld("test");
  assert.deepEqual(applyTransaction(world, [{ type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" }], { baseRev: 9 }), { ok: false, code: "stale_revision" });
  assert.deepEqual(applyTransaction(world, [{ type: "break", at: { x: 0, y: 3, z: 0 }, expectedBlock: "grass" }], { baseRev: 0, actor: "player" }), { ok: false, code: "protected_terrain", operationIndex: 0 });
  assert.deepEqual(applyTransaction(world, [{ type: "break", at: { x: 0, y: 3, z: 0 }, expectedBlock: "grass" }], { baseRev: 0, actor: "ai" }), { ok: false, code: "protected_terrain", operationIndex: 0 });
});
