import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
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

type CoreAddress = Readonly<{ host: string; port: number }>;

async function coreJson<T>(address: CoreAddress, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const init: RequestInit = body === undefined
    ? { method: "GET" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const response = await fetch(`http://${address.host}:${address.port}/api/core${path}`, init);
  return { status: response.status, body: (await response.json()) as T };
}

/** Companion tick takes no body, so POST it without the JSON content type. */
async function coreTick<T>(address: CoreAddress): Promise<{ status: number; body: T }> {
  const response = await fetch(`http://${address.host}:${address.port}/api/core/companion/tick`, { method: "POST" });
  return { status: response.status, body: (await response.json()) as T };
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

type ChatHistory = Readonly<{ messages: Array<{ role: "user" | "companion"; text: string; atMs: number }> }>;

test("core chat round-trips through the in-memory log and caps history at 30", async () => {
  const host = new FangcunHost({ worldId: "chat-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
  const address = await host.start();
  try {
    const reply = await coreJson<{ reply: string; state: string }>(address, "/chat", { text: "你好呀" });
    assert.equal(reply.status, 200);
    assert.match(reply.body.reply, /[\u4e00-\u9fff]/, "the persona always answers in Chinese");
    assert.ok(reply.body.reply.length <= 80, "the reply fits a companion_say bubble");
    assert.equal(typeof reply.body.state, "string");

    const first = await coreJson<ChatHistory>(address, "/chat");
    assert.deepEqual(first.body.messages.map((message) => message.role), ["user", "companion"]);
    assert.equal(first.body.messages[0]!.text, "你好呀");
    assert.equal(first.body.messages[1]!.text, reply.body.reply);
    for (const message of first.body.messages) assert.ok(Number.isSafeInteger(message.atMs));

    // The MCP/agent hook speaks without inventing a user turn.
    assert.deepEqual((await coreJson(address, "/companion/say", { text: "我先去数云啦" })).body, { ok: true });
    const afterSay = await coreJson<ChatHistory>(address, "/chat");
    assert.equal(afterSay.body.messages.at(-1)?.role, "companion");
    assert.equal(afterSay.body.messages.at(-1)?.text, "我先去数云啦");

    for (let index = 0; index < 16; index += 1) {
      await coreJson(address, "/chat", { text: `第 ${index} 句` });
    }
    const capped = await coreJson<ChatHistory>(address, "/chat");
    assert.equal(capped.body.messages.length, 30, "history keeps the newest 30 messages");
    assert.equal(capped.body.messages.at(-1)?.role, "companion");
    assert.equal(capped.body.messages.at(-2)?.role, "user");

    assert.equal((await coreJson(address, "/chat", { text: "字".repeat(201) })).status, 400, "200-char cap is enforced");
    assert.equal((await coreJson(address, "/chat", { text: "   " })).status, 400, "blank chat text is rejected");
    assert.equal((await coreJson(address, "/companion/say", { text: "字".repeat(81) })).status, 400, "80-char say cap is enforced");
    assert.equal(host.revision, 0, "chat never mutates the world");
  } finally {
    await host.stop();
  }
});

test("chat broadcasts the companion reply as companion_say", async () => {
  const host = new FangcunHost({ worldId: "chat-ws-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
  const address = await host.start();
  try {
    const code = host.issuePairingCode();
    const pairResponse = await fetch(`http://${address.host}:${address.port}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.code, clientId: "tablet-1" }),
    });
    const pairing = (await pairResponse.json()) as { token: string };
    const socket = await openSocket(`ws://${address.host}:${address.port}/api/ws`);
    const read = socketReader(socket);
    try {
      socket.send(JSON.stringify({ protocolVersion: 1, type: "hello", worldId: "chat-ws-world", clientId: "tablet-1", credential: pairing.token, lastAppliedRev: 0 }));
      assert.equal((await read()).type, "welcome");
      assert.equal((await read()).type, "companion_state");

      const chat = await coreJson<{ reply: string }>(address, "/chat", { text: "谢谢你的小屋" });
      const say = await read();
      assert.equal(say.type, "companion_say");
      assert.equal(say.text, chat.body.reply);
    } finally {
      socket.close();
    }
  } finally {
    await host.stop();
  }
});

test("autonomy endpoint toggles the self-driving loop and reports its interval", async () => {
  const host = new FangcunHost({ worldId: "autonomy-toggle-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 60_000 });
  const address = await host.start();
  try {
    const initial = await coreJson<{ enabled: boolean; intervalMs: number; lastRunAtMs: number | null }>(address, "/autonomy");
    assert.equal(initial.status, 200);
    assert.equal(initial.body.enabled, true);
    assert.equal(initial.body.intervalMs, 60_000);
    assert.equal(initial.body.lastRunAtMs, null);

    const off = await coreJson<{ enabled: boolean }>(address, "/autonomy", { enabled: false });
    assert.equal(off.status, 200);
    assert.equal(off.body.enabled, false);
    assert.equal((await coreJson<{ enabled: boolean }>(address, "/autonomy")).body.enabled, false);

    const on = await coreJson<{ enabled: boolean }>(address, "/autonomy", { enabled: true });
    assert.equal(on.body.enabled, true);

    assert.equal((await coreJson(address, "/autonomy", { enabled: "yes" })).status, 400, "the toggle requires a boolean");
    assert.equal(host.revision, 0, "toggling autonomy never mutates the world");
  } finally {
    await host.stop();
  }
});

test("FANGCUN_AUTONOMY_MS=0 disables the loop from configuration", async () => {
  const previous = process.env.FANGCUN_AUTONOMY_MS;
  process.env.FANGCUN_AUTONOMY_MS = "0";
  let host: FangcunHost;
  try {
    host = new FangcunHost({ worldId: "autonomy-env-world", port: 0, ownerUserId: "owner-1" });
  } finally {
    if (previous === undefined) delete process.env.FANGCUN_AUTONOMY_MS;
    else process.env.FANGCUN_AUTONOMY_MS = previous;
  }
  const address = await host.start();
  try {
    const status = await coreJson<{ enabled: boolean; intervalMs: number }>(address, "/autonomy");
    assert.equal(status.body.enabled, false);
    assert.equal(status.body.intervalMs, 0);
    assert.equal((await coreJson(address, "/autonomy", { enabled: true })).status, 409, "a zero interval cannot be toggled on");
  } finally {
    await host.stop();
  }
});

test("disabled autonomy never mutates the world", async () => {
  const host = new FangcunHost({ worldId: "autonomy-off-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40 });
  const address = await host.start();
  try {
    assert.equal((await coreJson(address, "/autonomy", { enabled: false })).status, 200);
    // Grant a home manually: only the scheduler is off, so nothing may build on its own.
    const tick = await coreTick<{ result: { status: string; candidate?: { candidateId: string } } }>(address);
    assert.equal(tick.body.result.status, "home_approval_required");
    const candidateId = tick.body.result.candidate?.candidateId;
    assert.ok(candidateId);
    assert.equal((await coreJson(address, "/home/approve", { candidateId })).status, 200);
    await delay(220);
    assert.equal(host.revision, 0, "a disabled scheduler must not commit a build");
  } finally {
    await host.stop();
  }
});

test("autonomy never runs two companion ticks at once or double-commits", async () => {
  const host = new FangcunHost({ worldId: "autonomy-serial-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40 });
  const address = await host.start();
  try {
    const tick = await coreTick<{ result: { candidate?: { candidateId: string } } }>(address);
    const candidateId = tick.body.result.candidate?.candidateId;
    assert.ok(candidateId);
    assert.equal((await coreJson(address, "/home/approve", { candidateId })).status, 200);
    await delay(250);
    assert.equal(host.revision, 1, "many intervals produce exactly one commit");
    const status = await coreJson<{ lastRunAtMs: number | null }>(address, "/autonomy");
    assert.ok(typeof status.body.lastRunAtMs === "number" && status.body.lastRunAtMs > 0, "the scheduler actually ran");

    // Concurrent manual ticks serialize behind the same chain; the world authority
    // rejects the second build, so the revision cannot jump twice.
    const [first, second] = await Promise.all([coreTick<{ result: { status: string } }>(address), coreTick<{ result: { status: string } }>(address)]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(host.revision, 1, "concurrent ticks cannot double-commit");
  } finally {
    await host.stop();
  }
});

test("autonomy respects tracking readiness by delegating to the world authority", async () => {
  let trackingReady = true;
  const host = new FangcunHost({ worldId: "autonomy-tracking-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40, trackingReady: () => trackingReady });
  const address = await host.start();
  try {
    // A ready lease first lets the Host propose a candidate and the owner grant it.
    const tick = await coreTick<{ result: { candidate?: { candidateId: string } } }>(address);
    const candidateId = tick.body.result.candidate?.candidateId;
    assert.ok(candidateId);
    trackingReady = false;
    assert.equal((await coreJson(address, "/home/approve", { candidateId })).status, 200);
    await delay(200);
    assert.equal(host.revision, 0, "the authority pauses the tick while tracking is unready");
    const pausedTick = await coreTick<{ result: { status: string; reason?: string } }>(address);
    assert.equal(pausedTick.body.result.status, "paused");
  } finally {
    await host.stop();
  }
});

