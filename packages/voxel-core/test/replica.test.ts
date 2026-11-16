import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorld, getBlock } from "../src/index.ts";
import { applyCommit } from "../src/replica.ts";

test("replica applies only the next commit; ACKs are outside this API", () => {
  const world = createEmptyWorld("replica");
  const commit = { protocolVersion: 1 as const, type: "commit" as const, worldId: "replica", rev: 1, txId: "tx", actor: "player" as const, operations: [{ type: "place" as const, at: { x: 0, y: 4, z: 0 }, blockId: "planks" as const }] };
  const applied = applyCommit(world, commit);
  assert.equal(applied.status, "applied");
  if (applied.status === "applied") {
    assert.equal(getBlock(applied.world, { x: 0, y: 4, z: 0 }), "planks");
    assert.equal(applyCommit(applied.world, commit).status, "duplicate");
    assert.deepEqual(applyCommit(applied.world, { ...commit, rev: 3 }), { status: "resync_required", world: applied.world, reason: "revision_gap" });
  }
});

test("replica does not partially apply a commit with a before-value conflict", () => {
  const world = createEmptyWorld("replica");
  const result = applyCommit(world, { protocolVersion: 1, type: "commit", worldId: "replica", rev: 1, txId: "bad", actor: "player", operations: [
    { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" },
    { type: "break", at: { x: 1, y: 4, z: 0 }, expectedBlock: "stone" },
  ] });
  assert.equal(result.status, "resync_required");
  assert.equal(getBlock(world, { x: 0, y: 4, z: 0 }), null);
});
