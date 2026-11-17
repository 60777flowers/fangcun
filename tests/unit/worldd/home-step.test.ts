import test from "node:test";
import assert from "node:assert/strict";
import { createSeedWorld } from "@fangcun/voxel-core";
import { buildHousePlan, findHomeCandidates } from "@fangcun/companion-runtime";
import type { CompanionInstance, HomePlotGrant } from "@fangcun/companion-schema";
import { WorldAuthority } from "../../../packages/worldd/src/index.ts";

const NOW = Date.parse("2026-11-16T12:01:00.000Z");
const companion: CompanionInstance = {
  schemaVersion: 1, companionId: "fish-1", ownerUserId: "local-user", worldId: "step-world",
  personaId: "playful-fish", state: "idle", autonomyEnabled: true, createdAt: "2026-11-16T12:00:00.000Z",
};
const baseGrant: HomePlotGrant = {
  schemaVersion: 1, grantId: "grant-step-1", grantRev: 1, plotId: "home-step-1", worldId: "step-world",
  ownerUserId: "local-user", approvedByUserId: "local-user", companionId: "fish-1",
  bounds: { min: { x: 0, y: 1, z: 0 }, maxExclusive: { x: 4, y: 5, z: 4 } },
  allowedBlockIds: ["planks", "glass", "stairs"], maxBlocksPerPlan: 32, maxBlocksPerDay: 128,
  createdAt: "2026-11-16T12:00:00.000Z", expiresAt: "2026-11-23T12:00:00.000Z",
};

async function setup(options: Readonly<{ maxBlocksPerDay?: number }> = {}): Promise<{
  authority: WorldAuthority;
  grant: HomePlotGrant;
}> {
  const authority = new WorldAuthority({
    initialWorld: createSeedWorld("step-world"), idFactory: () => `step-tx-${Math.random().toString(16).slice(2)}`,
    ownerUserId: "local-user", homeGrantIssuerUserIds: ["local-user"], clock: () => NOW,
  });
  assert.equal(authority.registerCompanion(companion), true);
  const candidate = findHomeCandidates(authority.snapshot, { width: 4, depth: 4, height: 4 })[0];
  assert.ok(candidate);
  const budget = options.maxBlocksPerDay ?? 128;
  const grant: HomePlotGrant = { ...baseGrant, bounds: candidate!.bounds, maxBlocksPerPlan: Math.min(32, budget), maxBlocksPerDay: budget };
  assert.equal(authority.approveHomePlot(grant, candidate!, { authenticatedOwnerUserId: "local-user" }), true);
  return { authority, grant };
}

test("commitHomeStep commits exactly one allowed block per call", async () => {
  const { authority, grant } = await setup();
  const plan = buildHousePlan(grant);
  assert.ok(plan);
  if (!plan) return;
  const first = plan.operations[0]!;
  const step = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev,
    baseRev: authority.snapshot.rev, operation: first,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(step.accepted, true);
  assert.equal(step.commit?.operations.length, 1);
  assert.equal(step.commit?.actor, "ai");
  assert.equal(authority.snapshot.rev, 1);

  const second = plan.operations[1]!;
  const next = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev,
    baseRev: authority.snapshot.rev, operation: second,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(next.accepted, true);
  assert.equal(authority.snapshot.rev, 2);
});

test("commitHomeStep fails closed on stale revision, wrong grant, out-of-plot and forbidden blocks", async () => {
  const { authority, grant } = await setup();
  const plan = buildHousePlan(grant);
  assert.ok(plan);
  if (!plan) return;
  const op = plan.operations[0]!;
  const stale = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: 99, operation: op,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, "stale_revision");

  const rotated = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev + 1, baseRev: authority.snapshot.rev, operation: op,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(rotated.reason, "grant_revoked");

  const outside = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: authority.snapshot.rev,
    operation: { type: "place", at: { x: 7, y: 2, z: 7 }, blockId: "planks" },
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(outside.accepted, false);
  assert.equal(outside.reason, "outside_plot");

  const forbidden = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: authority.snapshot.rev,
    operation: { type: "place", at: op.at, blockId: "stone" },
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(forbidden.reason, "block_not_allowed");

  const untracked = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: authority.snapshot.rev, operation: op,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: false });
  assert.equal(untracked.reason, "tracking_unready");

  const wrongOwner = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: authority.snapshot.rev, operation: op,
  }, { authenticatedOwnerUserId: "attacker" }, { trackingReady: true });
  assert.equal(wrongOwner.reason, "grant_missing");

  // Occupancy: commit the same cell twice with the updated revision.
  const first = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: authority.snapshot.rev, operation: op,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(first.accepted, true);
  const occupied = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: authority.snapshot.rev, operation: op,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(occupied.accepted, false);
  assert.equal(occupied.reason, "occupied");
});

test("commitHomeStep stops on the daily budget and a revoked grant", async () => {
  const { authority, grant } = await setup({ maxBlocksPerDay: 1 });
  const plan = buildHousePlan(grant);
  assert.ok(plan);
  if (!plan) return;
  const first = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: authority.snapshot.rev, operation: plan.operations[0]!,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(first.accepted, true);
  const overBudget = authority.commitHomeStep({
    plotId: grant.plotId, companionId: grant.companionId, grantRev: grant.grantRev, baseRev: authority.snapshot.rev, operation: plan.operations[1]!,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(overBudget.reason, "daily_budget");

  const { authority: revokedAuthority, grant: revokedGrant } = await setup();
  assert.equal(revokedAuthority.revokeHomeGrant(revokedGrant.plotId, { authenticatedOwnerUserId: "local-user" }), true);
  const revoked = revokedAuthority.commitHomeStep({
    plotId: revokedGrant.plotId, companionId: revokedGrant.companionId, grantRev: revokedGrant.grantRev,
    baseRev: revokedAuthority.snapshot.rev, operation: buildHousePlan(revokedGrant)!.operations[0]!,
  }, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(revoked.accepted, false);
  assert.equal(revoked.reason, "grant_revoked");
});
