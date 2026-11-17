import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK_DEFS, BLOCK_IDS, WORLD_CELL_COUNT, WORLD_SPEC, coordToIndex, indexToCoord, isBlockId, isInBounds } from "../../../packages/world-schema/src/index.ts";

// The v1 catalog ids in their pinned order. Durable stores encode a block id as
// BLOCK_IDS.indexOf(id) + 1, so these positions must never move.
const V1_BLOCK_IDS = ["grass", "dirt", "stone", "planks", "log", "leaves", "sand", "glass"] as const;
const DECORATIVE_BLOCK_COUNT = 8;

test("WorldSpec uses the agreed 16 cubed domain and 3 cm scale", () => {
  assert.equal(WORLD_CELL_COUNT, 4096);
  assert.equal(WORLD_SPEC.voxelSizeMeters, 0.03);
  assert.deepEqual(WORLD_SPEC.origin, { x: -8, y: 0, z: -8 });
});

test("coordinate index round-trips every world cell", () => {
  for (let index = 0; index < WORLD_CELL_COUNT; index += 1) {
    assert.equal(coordToIndex(indexToCoord(index)), index);
  }
});

test("negative origin, half-open bounds, and invalid indices are handled", () => {
  assert.equal(coordToIndex({ x: -8, y: 0, z: -8 }), 0);
  assert.equal(coordToIndex({ x: 7, y: 15, z: 7 }), WORLD_CELL_COUNT - 1);
  assert.equal(isInBounds({ x: 8, y: 15, z: 7 }), false);
  assert.throws(() => coordToIndex({ x: 8, y: 0, z: 0 }), RangeError);
  assert.throws(() => indexToCoord(-1), RangeError);
  assert.throws(() => indexToCoord(WORLD_CELL_COUNT), RangeError);
});

test("block allowlist rejects unknown identifiers", () => {
  assert.equal(isBlockId(BLOCK_IDS[0]), true);
  assert.equal(isBlockId("tnt"), false);
});

test("catalog appends eight decorative ids after the pinned v1 ids", () => {
  assert.equal(BLOCK_IDS.length, V1_BLOCK_IDS.length + DECORATIVE_BLOCK_COUNT);
  assert.deepEqual(BLOCK_IDS.slice(0, V1_BLOCK_IDS.length), [...V1_BLOCK_IDS], "v1 ids keep their positions");
  assert.equal(new Set(BLOCK_IDS).size, BLOCK_IDS.length, "block ids are unique");
  assert.equal(Object.keys(BLOCK_DEFS).length, BLOCK_IDS.length, "every id has exactly one BlockDef");
  for (const id of BLOCK_IDS) {
    assert.match(id, /^[a-z][a-z0-9_]*$/, `${id} is lowercase snake_case ASCII`);
    assert.equal(BLOCK_DEFS[id].id, id);
    assert.equal(BLOCK_DEFS[id].placeable, true, `${id} is an ordinary placeable block`);
    assert.ok(BLOCK_DEFS[id].label.length > 0, `${id} has a product label`);
    assert.equal(isBlockId(id), true);
  }
});

