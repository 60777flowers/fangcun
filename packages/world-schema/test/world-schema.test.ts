import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK_IDS, WORLD_CELL_COUNT, WORLD_SPEC, coordToIndex, indexToCoord, isBlockId, isInBounds } from "../src/index.ts";

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
