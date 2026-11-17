import test from "node:test";
import assert from "node:assert/strict";
import { validateClientIntent } from "@fangcun/protocol";
import { createSeedWorld } from "@fangcun/voxel-core";
import { buildStarterHomePlan, findHomeCandidates, type HashCanonicalDiff } from "@fangcun/companion-runtime";
import type { CompanionInstance, HomePlotGrant } from "@fangcun/companion-schema";
import { WorldAuthority } from "../../../packages/worldd/src/index.ts";

const hash: HashCanonicalDiff = async () => `sha256:${"a".repeat(64)}`;
const owner = "owner-1";
const nowMs = Date.parse("2026-11-16T12:01:00.000Z");
const companion: CompanionInstance = { schemaVersion: 1, companionId: "fish-1", ownerUserId: owner, worldId: "w-race", personaId: "p-1", state: "idle", autonomyEnabled: true, createdAt: "2026-11-16T12:00:00.000Z" };
const grant: HomePlotGrant = { schemaVersion: 1, grantId: "grant-race", grantRev: 1, plotId: "plot-race", worldId: "w-race", ownerUserId: owner, approvedByUserId: owner, companionId: companion.companionId, bounds: { min: { x: 0, y: 4, z: 0 }, maxExclusive: { x: 4, y: 12, z: 4 } }, allowedBlockIds: ["planks", "glass"], maxBlocksPerPlan: 32, maxBlocksPerDay: 128, createdAt: "2026-11-16T12:00:00.000Z", expiresAt: "2026-11-23T12:00:00.000Z" };
const actor = { authenticatedOwnerUserId: owner } as const;

async function createAuthority(hashCanonicalDiff = hash) {
  const authority = new WorldAuthority({ initialWorld: createSeedWorld("w-race"), idFactory: () => "race-tx", ownerUserId: owner, homeGrantIssuerUserIds: [owner], clock: () => nowMs, hashCanonicalDiff });
  assert.equal(authority.registerCompanion(companion), true);
  const candidate = findHomeCandidates(authority.snapshot, { width: 4, depth: 4, height: 8 })[0];
  assert.ok(candidate);
  if (!candidate) throw new Error("expected a home plot candidate");
  const approvedGrant = { ...grant, bounds: candidate.bounds };
  assert.equal(authority.approveHomePlot(approvedGrant, candidate, actor), true);
  const plan = await buildStarterHomePlan(authority.snapshot, approvedGrant, new Date(nowMs), hash);
  assert.ok(plan);
  if (!plan) throw new Error("expected a starter plan");
  return { authority, plan };
}

test("grant revoked while asynchronous hash validation is pending cannot commit", async () => {
  let signalStarted!: () => void;
  let resolveHash!: (value: string) => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const delayedHash: HashCanonicalDiff = async () => {
    signalStarted();
    return new Promise<string>((resolve) => { resolveHash = resolve; });
  };
  const { authority, plan } = await createAuthority(delayedHash);
  const pending = authority.commitHomePlan(plan, actor, { trackingReady: true });
  await started;
  assert.equal(authority.revokeHomeGrant(grant.plotId, actor, "2026-11-16T12:01:00.000Z"), true);
  resolveHash(`sha256:${"a".repeat(64)}`);
  const result = await pending;
  assert.equal(result.accepted, false);
  assert.equal(authority.snapshot.rev, 0);
});

test("concurrent player edit while hash validation is pending makes the home plan stale", async () => {
  let signalStarted!: () => void;
  let resolveHash!: (value: string) => void;
  const started = new Promise<void>((resolve) => { signalStarted = resolve; });
  const delayedHash: HashCanonicalDiff = async () => {
    signalStarted();
    return new Promise<string>((resolve) => { resolveHash = resolve; });
  };
  const { authority, plan } = await createAuthority(delayedHash);
  const pending = authority.commitHomePlan(plan, actor, { trackingReady: true });
  await started;
  const intent = validateClientIntent({ protocolVersion: 1, type: "intent", worldId: "w-race", clientId: "phone", seq: 1, baseRev: 0, operation: { type: "place", at: { x: -8, y: 4, z: -8 }, blockId: "planks" } });
  assert.equal(intent.ok, true);
  if (!intent.ok) return;
  assert.equal(authority.handleIntent(intent.value).ack.accepted, true);
  resolveHash(`sha256:${"a".repeat(64)}`);
  const result = await pending;
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "stale_revision");
  assert.equal(authority.snapshot.rev, 1);
});

