import test from "node:test";
import assert from "node:assert/strict";
import { isInsidePlot, validateCompanionInstance, validateHomePlotGrant, validatePersonaCard, validateVisitEvent, validateVisitInvitation } from "../src/index.ts";

const persona = { schemaVersion: 1, personaId: "playful-fish", version: 1, displayName: "大肥鱼", personaText: "调皮、温暖。", toneTags: ["playful"], allowedEmotes: ["wave", "happy"], memoryPolicy: "session-only" };
const instance = { schemaVersion: 1, companionId: "fish-1", ownerUserId: "local-user", worldId: "world-1", personaId: "playful-fish", state: "idle", autonomyEnabled: true, createdAt: "2026-11-16T12:00:00.000Z" };
const plot = { schemaVersion: 1, plotId: "home-1", worldId: "world-1", ownerUserId: "local-user", companionId: "fish-1", bounds: { min: { x: 0, y: 4, z: 0 }, max: { x: 4, y: 12, z: 4 } }, allowedBlockIds: ["planks", "glass", "leaves"], maxBlocksPerPlan: 32, maxBlocksPerDay: 128, createdAt: "2026-11-16T12:00:00.000Z" };

test("persona cards are style-only data and reject capability-shaped extras", () => {
  assert.equal(validatePersonaCard(persona).ok, true);
  assert.equal(validatePersonaCard({ ...persona, shell: true }).ok, false);
  assert.equal(validatePersonaCard({ ...persona, memoryPolicy: "persistent-files" }).ok, false);
});

test("companion instances carry isolated owner/world/persona identities", () => {
  assert.equal(validateCompanionInstance(instance).ok, true);
  assert.equal(validateCompanionInstance({ ...instance, autonomyEnabled: "yes" }).ok, false);
});

test("home plot grants are bounded, budgeted, owner-bound and half-open", () => {
  const valid = validateHomePlotGrant(plot);
  assert.equal(valid.ok, true);
  if (valid.ok) {
    assert.equal(isInsidePlot(valid.value, { x: 0, y: 4, z: 0 }), true);
    assert.equal(isInsidePlot(valid.value, { x: 4, y: 4, z: 0 }), false);
  }
  assert.equal(validateHomePlotGrant({ ...plot, bounds: { min: { x: 0, y: 3, z: 0 }, max: { x: 4, y: 12, z: 4 } } }).ok, false);
  assert.equal(validateHomePlotGrant({ ...plot, allowedBlockIds: ["command_block"] }).ok, false);
  assert.equal(validateHomePlotGrant({ ...plot, maxBlocksPerDay: 31 }).ok, false);
});

test("future visit contracts support scoped async messages but never write grants", () => {
  const invitation = { schemaVersion: 1, visitId: "visit-1", hostWorldId: "host-world", hostUserId: "host", hostCompanionId: "host-fish", guestUserId: "guest", guestCompanionId: "guest-fish", scope: "send-greeting", createdAt: "2026-11-16T12:00:00.000Z", expiresAt: "2026-11-17T12:00:00.000Z", status: "pending" };
  assert.equal(validateVisitInvitation(invitation).ok, true);
  assert.equal(validateVisitInvitation({ ...invitation, scope: "build" }).ok, false);
  const event = { schemaVersion: 1, visitId: "visit-1", eventId: "event-1", actorCompanionId: "guest-fish", kind: "greeting", payload: { text: "你好，串门来看看！" }, createdAt: "2026-11-16T12:30:00.000Z" };
  assert.equal(validateVisitEvent(event).ok, true);
  assert.equal(validateVisitEvent({ ...event, payload: { text: "x".repeat(281) } }).ok, false);
  assert.equal(validateVisitEvent({ ...event, approvalId: "write-token" }).ok, false);
});
