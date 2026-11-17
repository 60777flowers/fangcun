import test from "node:test";
import assert from "node:assert/strict";
import { WORLD_SPEC } from "@fangcun/world-schema";
import { applyTransaction, createEmptyWorld, createSeedWorld, getBlock } from "@fangcun/voxel-core";
import { findHomeCandidates, findHomeCandidate, buildStarterHomePlan, checkHomeAutoCommitEligibility, isEligibleForHomeAutoCommit, nextCompanionTick, type HashCanonicalDiff } from "../../../packages/companion-runtime/src/index.ts";
import type { CompanionInstance, HomePlotGrant } from "@fangcun/companion-schema";

const companion: CompanionInstance = { schemaVersion: 1, companionId: "fish-1", ownerUserId: "local-user", worldId: "world-1", personaId: "playful-fish", state: "idle", autonomyEnabled: true, createdAt: "2026-11-16T12:00:00.000Z" };
const testHash: HashCanonicalDiff = async () => `sha256:${"a".repeat(64)}`;
const grant: HomePlotGrant = { schemaVersion: 1, grantId: "grant-1", grantRev: 1, plotId: "home-1", worldId: "world-1", ownerUserId: "local-user", approvedByUserId: "local-user", companionId: "fish-1", bounds: { min: { x: 0, y: 4, z: 0 }, maxExclusive: { x: 4, y: 12, z: 4 } }, allowedBlockIds: ["planks", "glass"], maxBlocksPerPlan: 32, maxBlocksPerDay: 128, createdAt: "2026-11-16T12:00:00.000Z", expiresAt: "2026-11-23T12:00:00.000Z" };

test("autonomy asks the user to select/grant a home before construction", () => {
  const world = createEmptyWorld("world-1");
  const decision = nextCompanionTick(companion, world);
  assert.equal(decision.reason, "plot-not-granted");
  assert.equal(decision.waitingForUser, true);
  assert.equal(decision.intents[0]?.kind, "choose_home");
});

test("home-site planner chooses deterministic clear candidates and skips occupied areas", async () => {
  let world = createSeedWorld("world-1");
  const candidate = findHomeCandidate(world);
  assert.ok(candidate);
  assert.equal(candidate.origin.x, -2);
  assert.equal(candidate.origin.z, -2);
  assert.equal(candidate.origin.y, WORLD_SPEC.terrainTopY, "candidate plots start at the first buildable layer");
  assert.notEqual(getBlock(world, { x: candidate.origin.x, y: candidate.origin.y - 1, z: candidate.origin.z }), null, "the plot floor must rest on terrain");
  const placed = applyTransaction(world, [{ type: "place", at: candidate!.origin, blockId: "planks" }]);
  assert.equal(placed.ok, true);
  if (placed.ok) world = placed.world;
  const next = findHomeCandidates(world, { width: 4, depth: 4, maxResults: 1 })[0];
  assert.ok(next);
  assert.notEqual(`${next.origin.x},${next.origin.z}`, "0,0");
});

test("starter home plan places only allowlisted empty cells in assigned plot", async () => {
  const world = createEmptyWorld("world-1");
  const plan = await buildStarterHomePlan(world, grant, new Date("2026-11-16T12:00:00.000Z"), testHash);
  assert.ok(plan);
  if (!plan) return;
  assert.equal(plan.scope, "home_plot");
  assert.ok(plan.ops.length <= grant.maxBlocksPerPlan);
  assert.ok(plan.ops.every((op) => op.type === "place" && op.at.x >= 0 && op.at.x < 4 && op.at.y >= 4 && op.at.y < 12 && op.at.z >= 0 && op.at.z < 4));
  assert.equal(await isEligibleForHomeAutoCommit(world, companion, grant, plan, 0, Date.parse("2026-11-16T12:01:00.000Z"), testHash), true);
  assert.equal(await isEligibleForHomeAutoCommit(world, companion, { ...grant, companionId: "other" }, plan, 0, Date.parse("2026-11-16T12:01:00.000Z"), testHash), false);
  assert.equal(await isEligibleForHomeAutoCommit(world, companion, grant, plan, 120, Date.parse("2026-11-16T12:01:00.000Z"), testHash), false);
});

test("plans fail closed after concurrent edits or revocation and are no longer eligible", async () => {
  const world = createEmptyWorld("world-1");
  const plan = await buildStarterHomePlan(world, grant, new Date("2026-11-16T12:00:00.000Z"), testHash);
  assert.ok(plan);
  if (!plan) return;
  const { applyTransaction } = await import("@fangcun/voxel-core");
  const first = plan.ops[0]!;
  const edited = applyTransaction(world, [{ type: "place", at: first.at, blockId: "planks" }]);
  assert.equal(edited.ok, true);
  if (edited.ok) {
    assert.equal(await isEligibleForHomeAutoCommit(edited.world, companion, grant, plan, 0, Date.parse("2026-11-16T12:01:00.000Z"), testHash), false);
    assert.equal(getBlock(edited.world, first.at), "planks");
  }
  assert.equal(await isEligibleForHomeAutoCommit(world, companion, { ...grant, revokedAt: "2026-11-16T12:01:00.000Z" }, plan, 0, Date.parse("2026-11-16T12:01:00.000Z"), testHash), false);
});

test("paused companion emits no construction; a granted empty plot receives one bounded build intent", () => {
  const world = createEmptyWorld("world-1");
  assert.equal(nextCompanionTick({ ...companion, state: "paused" }, world, grant).reason, "paused");
  const decision = nextCompanionTick(companion, world, grant);
  assert.equal(decision.reason, "home-empty");
  assert.equal(decision.intents.length, 1);
  assert.equal(decision.intents[0]?.kind, "build_home");
  assert.equal(nextCompanionTick(companion, world, grant, true).reason, "already-active");
});

