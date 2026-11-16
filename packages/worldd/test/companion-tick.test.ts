import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSeedWorld } from "@fangcun/voxel-core";
import type { CompanionInstance, HomePlotGrant } from "@fangcun/companion-schema";
import { WorldAuthority } from "../src/index.ts";

const ownerUserId = "tick-owner";
const nowMs = Date.parse("2026-11-17T00:00:00.000Z");
const actor = { authenticatedOwnerUserId: ownerUserId } as const;
const companion: CompanionInstance = {
  schemaVersion: 1,
  companionId: "tick-fish",
  ownerUserId,
  worldId: "tick-world",
  personaId: "playful-fish",
  state: "idle",
  autonomyEnabled: true,
  createdAt: "2026-11-16T12:00:00.000Z",
};

function makeAuthority() {
  const authority = new WorldAuthority({
    initialWorld: createSeedWorld(companion.worldId),
    ownerUserId,
    homeGrantIssuerUserIds: [ownerUserId],
    idFactory: () => "tick-tx-1",
    clock: () => nowMs,
    hashCanonicalDiff: async (canonical) => `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
  });
  assert.equal(authority.registerCompanion(companion), true);
  return authority;
}

test("companion tick proposes a home, waits for owner approval, then commits a safe starter home", async () => {
  const authority = makeAuthority();
  const first = await authority.runCompanionTick(actor, { trackingReady: true });
  assert.equal(first.status, "home_approval_required");
  assert.ok(first.candidate);
  assert.equal(authority.snapshot.rev, 0);
  if (!first.candidate) return;

  const grant: HomePlotGrant = {
    schemaVersion: 1,
    grantId: "tick-grant-1",
    grantRev: 1,
    plotId: "tick-home-1",
    worldId: companion.worldId,
    ownerUserId,
    approvedByUserId: ownerUserId,
    companionId: companion.companionId,
    bounds: first.candidate.bounds,
    allowedBlockIds: ["planks", "glass"],
    maxBlocksPerPlan: 32,
    maxBlocksPerDay: 128,
    createdAt: "2026-11-16T12:00:00.000Z",
    expiresAt: "2026-11-24T00:00:00.000Z",
  };
  assert.equal(authority.approveHomePlot(grant, first.candidate, actor), true);

  const second = await authority.runCompanionTick(actor, { trackingReady: true });
  assert.equal(second.status, "committed");
  assert.equal(second.commit?.actor, "ai");
  assert.equal(second.commit?.rev, 1);
  assert.equal(second.commit?.operations.length, 12);
  assert.equal(authority.snapshot.rev, 1);
  assert.equal(authority.snapshot.blocks.filter(Boolean).length, 796);

  const replay = await authority.runCompanionTick(actor, { trackingReady: true });
  assert.equal(replay.status, "rejected");
  assert.equal(replay.reason, "rate_limited");
  assert.equal(authority.snapshot.rev, 1);
});

test("companion tick is inert when tracking or owner binding is missing", async () => {
  const authority = makeAuthority();
  const lost = await authority.runCompanionTick(actor, { trackingReady: false });
  assert.equal(lost.status, "paused");
  assert.equal(authority.snapshot.rev, 0);
  const attacker = await authority.runCompanionTick({ authenticatedOwnerUserId: "attacker" }, { trackingReady: true });
  assert.equal(attacker.status, "rejected");
  assert.equal(attacker.reason, "owner_mismatch");
});
