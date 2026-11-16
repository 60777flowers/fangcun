import test from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import protocolSchema from "../schema/protocol-v1.json" with { type: "json" };
import { WORLD_CELL_COUNT } from "@fangcun/world-schema";
import { validateClientMessage, validateServerMessage } from "../src/index.ts";
import { decodeClientMessageFrame, decodeServerMessageFrame, encodeClientMessageFrame, encodeServerMessageFrame } from "../src/codec.ts";

const hello = { protocolVersion: 1, type: "hello", worldId: "w", clientId: "phone", credential: "one-time", lastAppliedRev: 0 };
const ack = { protocolVersion: 1, type: "ack", worldId: "w", seq: 1, accepted: true, committedRev: 0 };
const snapshot = { schemaVersion: 1, worldId: "w", rev: 0, blocks: Array(WORLD_CELL_COUNT).fill(null) };
const welcome = { protocolVersion: 1, type: "welcome", worldId: "w", rev: 0, snapshot, worldSchemaHash: "sha256:world", blockCatalogHash: "sha256:blocks" };

const ajv = new Ajv2020({ allErrors: true });
const validateJsonSchema = ajv.compile(protocolSchema);

test("client connection, resync, approval and ping messages validate and round-trip", () => {
  const messages = [
    hello,
    { protocolVersion: 1, type: "resync", worldId: "w", lastAppliedRev: 0 },
    { protocolVersion: 1, type: "approve_plan", worldId: "w", planId: "p", diffHash: "sha256:diff", shownBaseRev: 0 },
    { protocolVersion: 1, type: "ping", worldId: "w", nonce: "n-1" },
  ];
  for (const message of messages) {
    const validated = validateClientMessage(message);
    assert.equal(validateJsonSchema(message), true, `JSON Schema rejected client message: ${JSON.stringify(message)}`);
    assert.equal(validated.ok, true);
    const encoded = encodeClientMessageFrame(message as never);
    assert.equal(encoded.ok, true);
    if (encoded.ok) assert.equal(decodeClientMessageFrame(encoded.value).ok, true);
  }
});

test("welcome snapshot and ack/pong/approval server messages validate and round-trip", () => {
  const messages = [
    welcome,
    ack,
    { protocolVersion: 1, type: "pong", worldId: "w", nonce: "n-1" },
    { protocolVersion: 1, type: "approval_granted", worldId: "w", planId: "p", approvalId: "once", diffHash: "sha256:diff", expiresAt: 1000 },
  ];
  for (const message of messages) {
    const validated = validateServerMessage(message);
    assert.equal(validateJsonSchema(message), true, `JSON Schema rejected server message: ${JSON.stringify(message).slice(0, 120)}`);
    assert.equal(validated.ok, true);
    const encoded = encodeServerMessageFrame(message as never);
    assert.equal(encoded.ok, true);
    if (encoded.ok) assert.equal(decodeServerMessageFrame(encoded.value).ok, true);
  }
});

test("credentials and snapshots are strictly validated and bounded", () => {
  assert.equal(validateClientMessage({ ...hello, credential: "" }).ok, false);
  assert.equal(validateClientMessage({ ...hello, secretExtra: true }).ok, false);
  assert.equal(validateServerMessage({ ...welcome, snapshot: { ...snapshot, blocks: new Array(WORLD_CELL_COUNT) } }).ok, false);
  assert.equal(validateServerMessage({ ...ack, mystery: 1 }).ok, false);
  const tooLarge = { ...hello, credential: "x".repeat(20_000) };
  assert.equal(encodeClientMessageFrame(tooLarge as never).ok, false);
});
