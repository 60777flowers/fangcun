import test from "node:test";
import assert from "node:assert/strict";
import { decodeClientIntentFrame, decodeCommitFrame, encodeClientIntentFrame, encodeCommitFrame } from "../../../packages/protocol/src/codec.ts";

const intent = { protocolVersion: 1, type: "intent", worldId: "w", clientId: "c", seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" } } as const;

test("intent frame round trips through bounded UTF-8 JSON codec", () => {
  const encoded = encodeClientIntentFrame(intent);
  assert.equal(encoded.ok, true);
  if (encoded.ok) assert.equal(decodeClientIntentFrame(encoded.value).ok, true);
});

test("commit frame codec preserves canonical server messages", () => {
  const commit = { protocolVersion: 1 as const, type: "commit" as const, worldId: "w", rev: 1, txId: "tx", actor: "player" as const, operations: [{ type: "place" as const, at: { x: 0, y: 4, z: 0 }, blockId: "planks" as const }] };
  const encoded = encodeCommitFrame(commit);
  assert.equal(encoded.ok, true);
  if (encoded.ok) assert.deepEqual(decodeCommitFrame(encoded.value), { ok: true, value: commit });
});

test("decoder rejects oversized, malformed, extra-field and out-of-range frames", () => {
  assert.deepEqual(decodeClientIntentFrame("{"), { ok: false, error: "invalid_json_or_utf8" });
  assert.deepEqual(decodeClientIntentFrame(" ".repeat(16 * 1024 + 1)), { ok: false, error: "frame_too_large" });
  assert.equal(decodeClientIntentFrame(JSON.stringify({ ...intent, extra: "no" })).ok, false);
  assert.equal(decodeClientIntentFrame(JSON.stringify({ ...intent, operation: { ...intent.operation, at: { x: 8, y: 4, z: 0 } } })).ok, false);
});

