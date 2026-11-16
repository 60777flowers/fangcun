import test from "node:test";
import assert from "node:assert/strict";
import { validateClientIntent, validateCommitMessage } from "../src/index.ts";

test("client intent is validated and copied into canonical shape", () => {
  const result = validateClientIntent({ protocolVersion: 1, type: "intent", worldId: "w", clientId: "c", seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" } });
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value.operation, { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" });
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
