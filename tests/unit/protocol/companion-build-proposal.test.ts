import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCompanionBuildProposalMessage,
  validateServerMessage,
} from "../../../packages/protocol/src/index.ts";
import { decodeServerMessageFrame, encodeServerMessageFrame } from "../../../packages/protocol/src/codec.ts";

const proposal = {
  protocolVersion: 1,
  type: "companion_build_proposal",
  worldId: "w-1",
  companionId: "fish-1",
  proposalId: "house:proposal-1",
  bounds: { min: { x: 0, y: 1, z: 0 }, maxExclusive: { x: 3, y: 4, z: 3 } },
  blockCount: 24,
  expiresAtMs: 1_760_000_120_000,
} as const;

test("companion_build_proposal validates and round-trips through the server frame codec", () => {
  const validated = validateCompanionBuildProposalMessage(proposal);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.deepEqual(validated.value, proposal);
  assert.equal(validated.value.blockCount, 24, "the proposal frame carries a non-zero block count");
  assert.equal(validated.value.bounds.maxExclusive.x - validated.value.bounds.min.x, 3);
  assert.equal(validateServerMessage(proposal).ok, true, "companion_build_proposal is a server message");
  const encoded = encodeServerMessageFrame(proposal);
  assert.equal(encoded.ok, true);
  if (!encoded.ok) return;
  const decoded = decodeServerMessageFrame(encoded.value);
  assert.equal(decoded.ok, true);
  if (decoded.ok) assert.deepEqual(decoded.value, proposal);
});

test("build proposals reject malformed bounds, counters and unknown fields", () => {
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, extra: true }).ok, false, "unknown fields are rejected");
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, proposalId: "" }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, worldId: "" }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, companionId: "" }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, blockCount: 0 }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, blockCount: 65 }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, blockCount: 1.5 }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, expiresAtMs: -1 }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, protocolVersion: 2 }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, bounds: { min: { x: 0, y: 1, z: 0 }, maxExclusive: { x: 0, y: 1, z: 0 } } }).ok, false, "empty AABB is invalid");
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, bounds: { min: { x: 0, y: 1, z: 0 }, maxExclusive: { x: 3, y: 4 } } }).ok, false);
  assert.equal(validateCompanionBuildProposalMessage({ ...proposal, bounds: { min: { x: 99, y: 1, z: 0 }, maxExclusive: { x: 102, y: 4, z: 3 } } }).ok, false, "min must be a world cell");
});
