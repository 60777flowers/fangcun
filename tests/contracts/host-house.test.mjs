import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * Contract test for the durable Host's house flow: a real `run-host.mjs` process on a
 * throwaway data dir + port. Verifies the proposal endpoints, the block-by-block
 * commit stream (via state polling) and the final world including the seat block.
 * The shared 8765 Host is never touched.
 */

const port = 4300 + Math.floor(Math.random() * 300);
const origin = `http://127.0.0.1:${port}`;

async function startHost(t, dataDir) {
  const host = spawn(process.execPath, ["scripts/run-host.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      FANGCUN_DATA: dataDir,
      FANGCUN_AUTONOMY_MS: "0",
      FANGCUN_BUILD_INTERVAL_MS: "0",
    },
    stdio: "ignore",
    windowsHide: true,
  });
  // Detach from the parent's event loop and force-kill on cleanup: the Host's SIGTERM
  // path awaits server.close(), which can be held open by keep-alive sockets, so a
  // graceful kill could otherwise keep the test worker alive after the assertions.
  host.unref();
  t.after(async () => {
    if (host.exitCode === null) {
      host.kill("SIGKILL");
      await Promise.race([
        new Promise((resolve) => host.once("exit", resolve)),
        delay(2000),
      ]);
    }
    // Windows keeps SQLite WAL handles locked for a moment after the process exits.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        rmSync(dataDir, { recursive: true, force: true });
        return;
      } catch {
        await delay(100);
      }
    }
  });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Host did not become healthy");
}

async function json(path, init) {
  const response = await fetch(`${origin}${path}`, init);
  return { status: response.status, body: await response.json() };
}

function postJson(path, body) {
  return json(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("host house proposal builds block by block and seats the companion", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "fangcun-host-contract-"));
  await startHost(t, dataDir);

  const initial = await json("/api/core/state");
  assert.equal(initial.status, 200);
  assert.equal(initial.body.world.rev, 0);
  assert.equal(initial.body.houseProposal, null);
  assert.equal(initial.body.build.inProgress, false);

  // Grant the home plot (the demo owner approves their own candidate).
  const tick = await json("/api/core/companion/tick", { method: "POST" });
  assert.equal(tick.body.result.status, "home_approval_required");
  const candidate = tick.body.result.candidate;
  assert.ok(candidate);
  const approved = await postJson("/api/core/home/approve", { candidateId: candidate.candidateId });
  assert.equal(approved.status, 200);

  // Propose once and reject it: the world must stay untouched.
  const rejectProposal = (await postJson("/api/core/house/propose", {})).body.proposal;
  const revBeforeReject = initial.body.world.rev;
  const rejected = await postJson("/api/core/house/decide", { proposalId: rejectProposal.proposalId, approve: false });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.approved, false);
  const afterReject = await json("/api/core/state");
  assert.equal(afterReject.body.world.rev, revBeforeReject, "rejecting a proposal is world-neutral");
  assert.equal(afterReject.body.houseProposal, null);

  // Propose again, then approve and watch the block-by-block queue finish.
  const proposed = await postJson("/api/core/house/propose", {});
  assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
  const proposal = proposed.body.proposal;
  assert.equal(proposal.companionId, "fish-1");
  assert.equal(proposal.planBlockCount, 24);
  assert.equal(proposal.bounds.maxExclusive.x - proposal.bounds.min.x, 3);
  const pending = await json("/api/core/state");
  assert.deepEqual(pending.body.houseProposal, proposal);

  const decided = await postJson("/api/core/house/decide", { proposalId: proposal.proposalId, approve: true });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.approved, true);

  let state = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const response = await json("/api/core/state");
    state = response.body;
    if (!state.build.inProgress && state.build.completedBlocks === 24) break;
    await delay(25);
  }
  assert.ok(state, "state was polled");
  assert.equal(state.build.completedBlocks, 24);
  assert.equal(state.build.totalBlocks, 24);
  assert.equal(state.build.lastError, null);
  assert.equal(state.build.seatPlaced, true);
  assert.equal(state.houseProposal, null);
  assert.equal(state.world.rev, 25, "24 plan blocks + 1 seat commit");

  const seat = proposal.bounds.min;
  const seatX = seat.x + 1;
  const seatY = seat.y + 1;
  const seatZ = seat.z + 1;
  const seatIndex = (seatY * 16 + (seatZ + 8)) * 16 + (seatX + 8);
  assert.equal(state.world.blocks[seatIndex], "stairs", "the seat block is placed at the plan centre");

  console.log("Host house contract passed: propose → decide → 24 block commits + stairs seat; reject is world-neutral.");
});
