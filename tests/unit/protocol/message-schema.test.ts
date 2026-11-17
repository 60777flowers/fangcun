import test from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import protocolSchema from "../../../packages/protocol/schema/protocol-v1.json" with { type: "json" };
import { BLOCK_IDS, WORLD_CELL_COUNT } from "@fangcun/world-schema";
import { validateClientMessage, validateServerMessage } from "../../../packages/protocol/src/index.ts";
import { decodeClientMessageFrame, decodeServerMessageFrame, encodeClientMessageFrame, encodeServerMessageFrame } from "../../../packages/protocol/src/codec.ts";

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

type EnumHolder = Readonly<{ enum?: readonly unknown[] }>;

/** Reads a sub-schema's `enum` without duplicating the JSON Schema shape in types. */
function readEnum(root: unknown, path: readonly (string | number)[]): readonly unknown[] {
  let current: unknown = root;
  for (const key of path) {
    current = typeof key === "number" ? (current as readonly unknown[])[key] : (current as Record<string, unknown>)[key];
  }
  return (current as EnumHolder | undefined)?.enum ?? [];
}

test("protocol JSON Schema block enums mirror the catalog", () => {
  // The wire schema is a static contract, so pin its enums to BLOCK_IDS here: a
  // catalog change that forgets the schema must fail instead of drifting silently.
  assert.deepEqual(readEnum(protocolSchema, ["$defs", "operation", "oneOf", 0, "properties", "blockId"]), [...BLOCK_IDS]);
  assert.deepEqual(readEnum(protocolSchema, ["$defs", "operation", "oneOf", 1, "properties", "expectedBlock"]), [...BLOCK_IDS]);
  assert.deepEqual(readEnum(protocolSchema, ["$defs", "welcome", "properties", "snapshot", "properties", "blocks", "items"]), [...BLOCK_IDS, null]);

  for (const blockId of BLOCK_IDS) {
    assert.equal(validateJsonSchema({ protocolVersion: 1, type: "intent", worldId: "w", clientId: "c", seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId } }), true, `JSON Schema rejected catalog block ${blockId}`);
  }
  const catalogSnapshot = { ...snapshot, blocks: [...BLOCK_IDS, ...Array<null>(WORLD_CELL_COUNT - BLOCK_IDS.length).fill(null)] };
  assert.equal(validateJsonSchema({ ...welcome, snapshot: catalogSnapshot }), true, "a snapshot may contain every catalog block id");
});

