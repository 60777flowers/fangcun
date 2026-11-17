import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPANION_ACTION_IDS,
  isCompanionActionId,
  validateCompanionActionMessage,
  validateServerMessage,
} from "../../../packages/protocol/src/index.ts";
import { decodeServerMessageFrame, encodeServerMessageFrame } from "../../../packages/protocol/src/codec.ts";

const action = {
  protocolVersion: 1,
  type: "companion_action",
  worldId: "w-1",
  companionId: "fish-1",
  actionId: "wave",
  expiresAtMs: 1_234,
} as const;

test("companion_action validates and round-trips through the server frame codec", () => {
  const validated = validateCompanionActionMessage(action);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.deepEqual(validated.value, action);
  assert.equal(validateServerMessage(action).ok, true, "companion_action is a server message");
  const encoded = encodeServerMessageFrame(action);
  assert.equal(encoded.ok, true);
  if (!encoded.ok) return;
  const decoded = decodeServerMessageFrame(encoded.value);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.value, action);
});

test("every declared companion action id is accepted and unknown ids are rejected", () => {
  for (const actionId of COMPANION_ACTION_IDS) {
    assert.equal(isCompanionActionId(actionId), true);
    assert.equal(validateCompanionActionMessage({ ...action, actionId }).ok, true, actionId);
  }
  assert.equal(validateCompanionActionMessage({ ...action, actionId: "dance" }).ok, false);
  assert.equal(validateCompanionActionMessage({ ...action, actionId: "" }).ok, false);
  assert.equal(validateCompanionActionMessage({ ...action, actionId: 42 }).ok, false);
  assert.equal(isCompanionActionId("dance"), false);
  assert.equal(isCompanionActionId(null), false);
});

test("companion_action rejects unknown fields and malformed envelopes", () => {
  assert.equal(validateCompanionActionMessage({ ...action, extra: true }).ok, false, "unknown fields are rejected");
  assert.equal(validateCompanionActionMessage({ ...action, worldId: "" }).ok, false);
  assert.equal(validateCompanionActionMessage({ ...action, companionId: "" }).ok, false);
  assert.equal(validateCompanionActionMessage({ ...action, expiresAtMs: -1 }).ok, false);
  assert.equal(validateCompanionActionMessage({ ...action, expiresAtMs: 1.5 }).ok, false);
  assert.equal(validateCompanionActionMessage({ ...action, protocolVersion: 2 }).ok, false);
  assert.equal(encodeServerMessageFrame({ ...action, actionId: "dance" } as never).ok, false, "the codec refuses an unknown action id");
});

