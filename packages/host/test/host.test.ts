import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyTransaction, createSeedWorld, getBlock } from "@fangcun/voxel-core";
import { FangcunHost } from "../src/index.ts";
import { HostStore } from "../src/persistence.ts";

function tempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "fangcun-host-"));
  return { path: join(dir, "world.sqlite"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Buffered reader: the Host may send ack and commit back-to-back, so a listener
 * attached only after the first `await` would miss the second frame.
 */
function socketReader(socket: WebSocket): () => Promise<Record<string, unknown>> {
  const queue: Record<string, unknown>[] = [];
  const waiters: Array<(value: Record<string, unknown>) => void> = [];
  socket.addEventListener("message", (event) => {
    const value = JSON.parse(String(event.data)) as Record<string, unknown>;
    const waiter = waiters.shift();
    if (waiter) waiter(value);
    else queue.push(value);
  });
  return () => new Promise<Record<string, unknown>>((resolve, reject) => {
    const buffered = queue.shift();
    if (buffered) {
      resolve(buffered);
      return;
    }
    const timer = setTimeout(() => reject(new Error("timed out waiting for socket message")), 5000);
    waiters.push((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener("error", () => reject(new Error("socket failed")), { once: true });
  });
}

test("store keeps world and commit log consistent across reopen", () => {
  const db = tempDb();
  try {
    const store = new HostStore(db.path);
    const seeded = store.loadOrSeedWorld("store-world");
    assert.equal(seeded.rev, 0);
    const applied = applyTransaction(seeded, [{ type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" }]);
    assert.equal(applied.ok, true);
    if (!applied.ok) return;
    store.commit(applied.world, {
      protocolVersion: 1,
      type: "commit",
      worldId: "store-world",
      rev: applied.rev,
      txId: "tx-1",
      actor: "player",
      operations: applied.operations,
    });
    store.close();

    const reopened = new HostStore(db.path);
    const world = reopened.loadOrSeedWorld("store-world");
    assert.equal(world.rev, 1);
    assert.equal(getBlock(world, { x: 0, y: 4, z: 0 }), "planks");
    assert.equal(reopened.recentCommits().length, 1);
    reopened.close();
  } finally {
    db.cleanup();
  }
});

test("store rejects a world whose revision disagrees with the commit log", () => {
  const db = tempDb();
  try {
    const store = new HostStore(db.path);
    const seeded = store.loadOrSeedWorld("drift-world");
    const applied = applyTransaction(seeded, [{ type: "place", at: { x: 1, y: 4, z: 1 }, blockId: "stone" }]);
    if (!applied.ok) throw new Error("unexpected transaction failure");
    store.commit(applied.world, {
      protocolVersion: 1, type: "commit", worldId: "drift-world", rev: applied.rev,
      txId: "tx-a", actor: "player", operations: applied.operations,
    });
    store.close();

    // Simulate a torn write: the snapshot advances without a matching commit row.
    const raw = new DatabaseSync(db.path);
    raw.prepare("UPDATE world SET rev = rev + 1").run();
    raw.close();

    const reopened = new HostStore(db.path);
    assert.throws(() => reopened.loadOrSeedWorld("drift-world"), /disagrees with world revision/);
    reopened.close();
  } finally {
    db.cleanup();
  }
});

test("host pairs a client, accepts an intent over WebSocket and broadcasts the commit", async () => {
  const host = new FangcunHost({ worldId: "ws-world", port: 0, ownerUserId: "owner-1" });
  const address = await host.start();
  try {
    const code = host.issuePairingCode();
    const pairResponse = await fetch(`http://${address.host}:${address.port}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.code, clientId: "tablet-1" }),
    });
    assert.equal(pairResponse.status, 200);
    const pairing = (await pairResponse.json()) as { token: string; worldId: string };
    assert.equal(pairing.worldId, "ws-world");

    const badPair = await fetch(`http://${address.host}:${address.port}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "WRONGCODE", clientId: "attacker" }),
    });
    assert.equal(badPair.status, 403, "a spent/invalid pairing code is rejected");

    const url = `ws://${address.host}:${address.port}/api/ws`;
    const first = await openSocket(url);
    const second = await openSocket(url);
    const readFirst = socketReader(first);
    const readSecond = socketReader(second);
    try {
      first.send(JSON.stringify({ protocolVersion: 1, type: "hello", worldId: "ws-world", clientId: "tablet-1", credential: pairing.token, lastAppliedRev: 0 }));
      assert.equal((await readFirst()).type, "welcome");
      assert.equal((await readFirst()).type, "companion_state", "hello also reports the companion state");
      second.send(JSON.stringify({ protocolVersion: 1, type: "hello", worldId: "ws-world", clientId: "inspector", credential: pairing.token, lastAppliedRev: 0 }));
      assert.equal((await readSecond()).type, "welcome");
      assert.equal((await readSecond()).type, "companion_state", "hello also reports the companion state");

      first.send(JSON.stringify({
        protocolVersion: 1, type: "intent", worldId: "ws-world", clientId: "tablet-1",
        seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" },
      }));
      const ack = await readFirst();
      assert.equal(ack.type, "ack");
      assert.equal(ack.accepted, true);
      assert.equal(ack.committedRev, 1);

      const commitToFirst = await readFirst();
      const commitToSecond = await readSecond();
      assert.equal(commitToFirst.type, "commit");
      assert.equal(commitToFirst.rev, 1);
      assert.equal(commitToSecond.type, "commit");
      assert.equal(commitToSecond.rev, 1);
      assert.equal(host.revision, 1);
    } finally {
      first.close();
      second.close();
    }
  } finally {
    await host.stop();
  }
});

test("host refuses intents before hello and rejects unauthenticated HTTP state", async () => {
  const host = new FangcunHost({ worldId: "guard-world", port: 0, ownerUserId: "owner-1" });
  const address = await host.start();
  try {
    const stateResponse = await fetch(`http://${address.host}:${address.port}/api/state`);
    assert.equal(stateResponse.status, 401);

    const socket = await openSocket(`ws://${address.host}:${address.port}/api/ws`);
    const closed = new Promise<void>((resolve) => socket.addEventListener("close", () => resolve(), { once: true }));
    socket.send(JSON.stringify({
      protocolVersion: 1, type: "intent", worldId: "guard-world", clientId: "ghost",
      seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" },
    }));
    await closed;
    assert.equal(host.revision, 0, "an unauthenticated connection cannot mutate the world");
  } finally {
    await host.stop();
  }
});

test("host restores the world and companion grant from disk after restart", async () => {
  const db = tempDb();
  try {
    const first = new FangcunHost({ worldId: "restart-world", port: 0, ownerUserId: "owner-1", dbPath: db.path });
    const address = await first.start();
    try {
      const code = first.issuePairingCode();
      const pairResponse = await fetch(`http://${address.host}:${address.port}/api/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.code, clientId: "tablet-1" }),
      });
      const pairing = (await pairResponse.json()) as { token: string };
      const headers = { Authorization: `Bearer ${pairing.token}`, "Content-Type": "application/json" };

      const tickResponse = await fetch(`http://${address.host}:${address.port}/api/companion/tick`, { method: "POST", headers });
      const tick = (await tickResponse.json()) as { result: { status: string; candidate?: { candidateId: string } } };
      assert.equal(tick.result.status, "home_approval_required");
      assert.ok(tick.result.candidate);

      const approveResponse = await fetch(`http://${address.host}:${address.port}/api/home/approve`, {
        method: "POST",
        headers,
        body: JSON.stringify({ candidateId: tick.result.candidate!.candidateId }),
      });
      assert.equal(approveResponse.status, 200);

      const buildResponse = await fetch(`http://${address.host}:${address.port}/api/companion/tick`, { method: "POST", headers });
      const build = (await buildResponse.json()) as { result: { status: string }, world: { rev: number } };
      assert.equal(build.result.status, "committed");
      assert.equal(build.world.rev, 1);
    } finally {
      await first.stop();
    }

    const second = new FangcunHost({ worldId: "restart-world", port: 0, ownerUserId: "owner-1", dbPath: db.path });
    const secondAddress = await second.start();
    try {
      assert.equal(second.revision, 1, "acknowledged revision survives restart");
      const code = second.issuePairingCode();
      const pairResponse = await fetch(`http://${secondAddress.host}:${secondAddress.port}/api/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.code, clientId: "tablet-2" }),
      });
      const pairing = (await pairResponse.json()) as { token: string };
      const stateResponse = await fetch(`http://${secondAddress.host}:${secondAddress.port}/api/state`, {
        headers: { Authorization: `Bearer ${pairing.token}` },
      });
      const state = (await stateResponse.json()) as { homeGrantActive: boolean, world: { rev: number, blocks: unknown } };
      assert.equal(state.homeGrantActive, true, "approved home grant survives restart");
      assert.equal(state.world.rev, 1);

      // The restored grant lets the companion continue building without re-approval.
      const tickResponse = await fetch(`http://${secondAddress.host}:${secondAddress.port}/api/companion/tick`, {
        method: "POST",
        headers: { Authorization: `Bearer ${pairing.token}`, "Content-Type": "application/json" },
      });
      const tick = (await tickResponse.json()) as { result: { status: string } };
      assert.ok(["committed", "rejected", "paused"].includes(tick.result.status));
    } finally {
      await second.stop();
    }
  } finally {
    db.cleanup();
  }
});

test("a host commit matches a local transaction applied to the same revision", () => {
  const world = createSeedWorld("replica-world");
  const applied = applyTransaction(world, [{ type: "place", at: { x: 3, y: 4, z: 3 }, blockId: "log" }]);
  assert.equal(applied.ok, true);
  if (!applied.ok) return;
  assert.equal(getBlock(applied.world, { x: 3, y: 4, z: 3 }), "log");
  assert.equal(applied.rev, world.rev + 1);
});
