import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK_IDS } from "@fangcun/world-schema";
import { validateClientIntent, validateCommitMessage } from "../src/index.ts";

test("client intent is validated and copied into canonical shape", () => {
  const result = validateClientIntent({ protocolVersion: 1, type: "intent", worldId: "w", clientId: "c", seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" } });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.operation, { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" });
});

test("every catalog block id round-trips through the intent and commit validators", () => {
  // Derived from BLOCK_IDS so adding a block needs no new test case here.
  for (const blockId of BLOCK_IDS) {
    const place = validateClientIntent({ protocolVersion: 1, type: "intent", worldId: "w", clientId: "c", seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId } });
    assert.equal(place.ok, true, `place intent rejected catalog block ${blockId}`);
    if (place.ok && place.value.operation.type === "place") assert.equal(place.value.operation.blockId, blockId);
    const remove = validateCommitMessage({ protocolVersion: 1, type: "commit", worldId: "w", rev: 1, txId: "tx", actor: "player", operations: [{ type: "break", at: { x: 0, y: 4, z: 0 }, expectedBlock: blockId }] });
    assert.equal(remove.ok, true, `break commit rejected catalog block ${blockId}`);
  }
});

test("invalid protocol version, extra executable fields, and unknown blocks are rejected", () => {
  assert.equal(validateClientIntent({ protocolVersion: 2 }).ok, false);
  assert.equal(validateClientIntent({ protocolVersion: 1, type: "intent", worldId: "w", clientId: "c", seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "tnt", script: "throw 1" } }).ok, false);
});

test("commit requires a valid revision and bounded non-empty atomic operation list", () => {
  const valid = validateCommitMessage({ protocolVersion: 1, type: "commit", worldId: "w", rev: 1, txId: "tx", actor: "player", operations: [{ type: "break", at: { x: 0, y: 4, z: 0 }, expectedBlock: "planks" }] });
  assert.equal(valid.ok, true);
  assert.equal(validateCommitMessage({ protocolVersion: 1, type: "commit", worldId: "w", rev: 0, txId: "tx", actor: "player", operations: [] }).ok, false);
  assert.equal(validateCommitMessage({ protocolVersion: 1, type: "commit", worldId: "w", rev: 1, txId: "tx", actor: "player", operations: [
    { type: "place", at: { x: 1, y: 4, z: 0 }, blockId: "planks" },
    { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "glass" },
  ] }).ok, false, "commit operations must be canonical index order");
  assert.equal(validateCommitMessage({ protocolVersion: 1, type: "commit", worldId: "w", rev: 1, txId: "tx", actor: "player", operations: [
    { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" },
    { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "glass" },
  ] }).ok, false, "duplicate cells must be rejected");
});
