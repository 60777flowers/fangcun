import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorld, createSeedWorld } from "@fangcun/voxel-core";
import { buildStarterHomePlan, findHomeCandidates, type HashCanonicalDiff } from "@fangcun/companion-runtime";
import type { CompanionInstance, HomePlotGrant } from "@fangcun/companion-schema";
import { WorldAuthority } from "../../../packages/worldd/src/index.ts";

const hash: HashCanonicalDiff = async () => `sha256:${"a".repeat(64)}`;
const companion: CompanionInstance = { schemaVersion: 1, companionId: "fish-1", ownerUserId: "local-user", worldId: "home-world", personaId: "playful-fish", state: "idle", autonomyEnabled: true, createdAt: "2026-11-16T12:00:00.000Z" };
const grant: HomePlotGrant = { schemaVersion: 1, grantId: "grant-1", grantRev: 1, plotId: "home-1", worldId: "home-world", ownerUserId: "local-user", approvedByUserId: "local-user", companionId: "fish-1", bounds: { min: { x: 0, y: 4, z: 0 }, maxExclusive: { x: 4, y: 12, z: 4 } }, allowedBlockIds: ["planks", "glass"], maxBlocksPerPlan: 32, maxBlocksPerDay: 128, createdAt: "2026-11-16T12:00:00.000Z", expiresAt: "2026-11-23T12:00:00.000Z" };

test("world authority validates and atomically commits a trusted home plan", async () => {
  const authority = new WorldAuthority({ initialWorld: createSeedWorld("home-world"), idFactory: () => "home-tx-1", ownerUserId: "local-user", homeGrantIssuerUserIds: ["local-user"], clock: () => Date.parse("2026-11-16T12:01:00.000Z"), hashCanonicalDiff: hash });
  assert.equal(authority.registerCompanion(companion), true);
  const candidate = findHomeCandidates(authority.snapshot, { width: 4, depth: 4, height: 8 })[0];
  assert.ok(candidate);
  if (!candidate) return;
  const approvedGrant = { ...grant, bounds: candidate.bounds };
  assert.equal(authority.approveHomePlot(approvedGrant, candidate, { authenticatedOwnerUserId: "local-user" }), true);
  const plan = await buildStarterHomePlan(authority.snapshot, approvedGrant, new Date("2026-11-16T12:01:00.000Z"), hash);
  assert.ok(plan);
  if (!plan) return;
  const result = await authority.commitHomePlan(plan, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(result.accepted, true);
  assert.equal(result.commit?.actor, "ai");
  assert.equal(authority.snapshot.rev, 1);
  const replay = await authority.commitHomePlan(plan, { authenticatedOwnerUserId: "local-user" }, { trackingReady: true });
  assert.equal(replay.accepted, false);
  assert.equal(replay.reason, "duplicate_plan");
});

test("world authority rejects untrusted issuer, owner mismatch, stale plan and tracking loss", async () => {
  const authority = new WorldAuthority({ initialWorld: createSeedWorld("home-world"), idFactory: () => "home-tx-2", ownerUserId: "local-user", homeGrantIssuerUserIds: ["local-user"], clock: () => Date.parse("2026-11-16T12:01:00.000Z"), hashCanonicalDiff: hash });
  assert.equal(authority.registerCompanion(companion), true);
  const candidate = findHomeCandidates(authority.snapshot, { width: 4, depth: 4, height: 8 })[0];
  assert.ok(candidate);
  if (!candidate) return;
  assert.equal(authority.approveHomePlot(grant, { ...candidate, bounds: grant.bounds }, { authenticatedOwnerUserId: "attacker" }), false);
  const approvedGrant = { ...grant, bounds: candidate.bounds };
  assert.equal(authority.approveHomePlot(approvedGrant, candidate, { authenticatedOwnerUserId: "local-user" }), true);
  const plan = await buildStarterHomePlan(authority.snapshot, approvedGrant, new Date("2026-11-16T12:01:00.000Z"), hash);
  assert.ok(plan);
  if (!plan) return;
  const lost = await authority.commitHomePlan(plan, { authenticatedOwnerUserId: "local-user" }, { trackingReady: false });
  assert.equal(lost.reason, "tracking_unready");
  const badOwner = await authority.commitHomePlan(plan, { authenticatedOwnerUserId: "attacker" }, { trackingReady: true });
  assert.equal(badOwner.reason, "grant_missing");
});

