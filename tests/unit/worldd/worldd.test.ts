import test from "node:test";
import assert from "node:assert/strict";
import { validateClientIntent } from "@fangcun/protocol";
import { createEmptyWorld, getBlock } from "@fangcun/voxel-core";
import { WorldAuthority } from "../../../packages/worldd/src/index.ts";

function intent(seq: number, baseRev: number, x: number, blockId = "planks") {
  const parsed = validateClientIntent({ protocolVersion: 1, type: "intent", worldId: "test", clientId: "phone", seq, baseRev, operation: { type: "place", at: { x, y: 4, z: 0 }, blockId } });
  if (!parsed.ok) throw new Error("test intent unexpectedly failed validation");
  return parsed.value;
}

test("authority applies accepted intent once and duplicate replay does not advance rev", () => {
  const authority = new WorldAuthority({ initialWorld: createEmptyWorld("test"), idFactory: () => "tx-1" });
  const request = intent(1, 0, 0);
  const first = authority.handleIntent(request);
  const replay = authority.handleIntent(request);
  assert.equal(first.ack.accepted, true);
  assert.equal(first.ack.committedRev, 1);
  assert.equal(replay.ack.committedRev, 1);
  assert.equal(authority.snapshot.rev, 1);
  assert.equal(replay.commit?.txId, "tx-1");
});

test("failed commit preparation does not publish a state change and allows safe retry", () => {
  let fail = true;
  const authority = new WorldAuthority({ initialWorld: createEmptyWorld("test"), idFactory: () => { if (fail) throw new Error("id failure"); return "tx-ok"; } });
  const request = intent(1, 0, 0);
  const rejected = authority.handleIntent(request);
  assert.equal(rejected.ack.accepted, false);
  assert.equal(rejected.ack.reason, "commit_prepare_failed");
  assert.equal(authority.snapshot.rev, 0);
  fail = false;
  const retried = authority.handleIntent(request);
  assert.equal(retried.ack.accepted, true);
  assert.equal(authority.snapshot.rev, 1);
});

test("authority rejects stale revisions, seq reuse and player modifications in protected terrain", () => {
  const authority = new WorldAuthority({ initialWorld: createEmptyWorld("test") });
  const first = authority.handleIntent(intent(1, 0, 0));
  assert.equal(first.ack.accepted, true);
  const stale = authority.handleIntent(intent(2, 0, 1));
  assert.equal(stale.ack.reason, "stale_revision");
  const reused = authority.handleIntent({ ...intent(2, 1, 1), operation: { type: "place", at: { x: 1, y: 4, z: 0 }, blockId: "glass" } });
  assert.equal(reused.ack.reason, "sequence_reuse_with_different_payload");
  const below = validateClientIntent({ protocolVersion: 1, type: "intent", worldId: "test", clientId: "other", seq: 1, baseRev: 1, operation: { type: "place", at: { x: 0, y: 0, z: 0 }, blockId: "planks" } });
  assert.equal(below.ok, true);
  if (below.ok) assert.equal(authority.handleIntent(below.value).ack.reason, "protected_terrain");
  assert.equal(getBlock(authority.snapshot, { x: 0, y: 4, z: 0 }), "planks");
});

