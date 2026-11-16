import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createSeedWorld } from "@fangcun/voxel-core";
import { WorldAuthority } from "@fangcun/worldd";

const ownerUserId = "local-user";
const worldId = "fangcun-local";
const companion = Object.freeze({
  schemaVersion: 1,
  companionId: "fish-1",
  ownerUserId,
  worldId,
  personaId: "playful-fish",
  state: "idle",
  autonomyEnabled: true,
  createdAt: new Date().toISOString(),
});
const authority = new WorldAuthority({
  initialWorld: createSeedWorld(worldId),
  ownerUserId,
  homeGrantIssuerUserIds: [ownerUserId],
});

if (!authority.registerCompanion(companion)) throw new Error("Could not register the local companion");
const actor = Object.freeze({ authenticatedOwnerUserId: ownerUserId });
const firstTick = await authority.runCompanionTick(actor, { trackingReady: true });
if (firstTick.status !== "home_approval_required" || !firstTick.candidate) {
  console.error(`Companion did not propose a home plot: ${firstTick.reason ?? firstTick.status}`);
  process.exitCode = 1;
} else {
  const { min, maxExclusive } = firstTick.candidate.bounds;
  console.log(`The companion proposes a home plot at x=${min.x}..${maxExclusive.x - 1}, z=${min.z}..${maxExclusive.z - 1}.`);
  const terminal = createInterface({ input: stdin, output: stdout });
  const answer = await terminal.question("Approve this home plot? [y/N] ");
  terminal.close();

  if (!/^y(es)?$/i.test(answer.trim())) {
    console.log("Home proposal declined. The world is unchanged.");
  } else {
    const now = new Date();
    const grant = Object.freeze({
      schemaVersion: 1,
      grantId: "grant-local-home-1",
      grantRev: 1,
      plotId: "home-local-fish-1",
      worldId,
      ownerUserId,
      approvedByUserId: ownerUserId,
      companionId: companion.companionId,
      bounds: firstTick.candidate.bounds,
      allowedBlockIds: Object.freeze(["planks", "glass"]),
      maxBlocksPerPlan: 32,
      maxBlocksPerDay: 128,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    if (!authority.approveHomePlot(grant, firstTick.candidate, actor)) {
      console.error("WorldAuthority rejected the approved home plot.");
      process.exitCode = 1;
    } else {
      const buildTick = await authority.runCompanionTick(actor, { trackingReady: true });
      if (buildTick.status !== "committed" || !buildTick.commit) {
        console.error(`Companion build was rejected: ${buildTick.reason ?? buildTick.status}`);
        process.exitCode = 1;
      } else {
        console.log(`Companion committed ${buildTick.commit.operations.length} blocks at revision ${buildTick.commit.rev}.`);
        console.log(`World ${authority.snapshot.worldId} now contains ${authority.snapshot.blocks.filter(Boolean).length} blocks.`);
      }
    }
  }
}
