import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { applyTransaction, createSeedWorld, getBlock } from "@fangcun/voxel-core";
import { COMPANION_ACTION_IDS, validateCompanionActionMessage } from "@fangcun/protocol";
import { FangcunHost } from "../src/index.ts";
import { addItemToCompanion } from "../src/items.ts";
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
type CoreMethod = "GET" | "POST" | "PATCH";

async function coreJson<T>(
  address: CoreAddress,
  path: string,
  body?: unknown,
  method?: CoreMethod,
): Promise<{ status: number; body: T }> {
  const resolvedMethod = method ?? (body === undefined ? "GET" : "POST");
  const init: RequestInit = resolvedMethod === "GET"
    ? { method: "GET" }
    : { method: resolvedMethod, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) };
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

type PetState = Readonly<{
  name: string;
  personaId: string;
  scale: number;
  actions: Array<{ id: string; displayName: string }>;
  activeAction: string;
  homeGrantActive: boolean;
  companionId: string;
}>;

test("pet profile round-trips defaults, a partial patch and survives a Host restart", async () => {
  const db = tempDb();
  try {
    const first = new FangcunHost({ worldId: "pet-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const address = await first.start();
    try {
      const initial = await coreJson<PetState>(address, "/pet");
      assert.equal(initial.status, 200);
      assert.equal(initial.body.companionId, "fish-1");
      assert.equal(initial.body.personaId, "playful-fish");
      assert.equal(initial.body.name, "小鱼");
      assert.equal(initial.body.scale, 1);
      assert.equal(initial.body.activeAction, "stand");
      assert.equal(initial.body.homeGrantActive, false);
      assert.deepEqual(
        initial.body.actions.map((action) => action.id),
        [...COMPANION_ACTION_IDS],
        "the GET action list is exactly the protocol contract, not a second hardcoded list",
      );
      for (const action of initial.body.actions) assert.ok(action.displayName.length > 0);

      const patched = await coreJson<PetState>(address, "/pet", { name: " 小蓝 ", scale: 1.75, action: "wave" }, "PATCH");
      assert.equal(patched.status, 200);
      assert.equal(patched.body.name, "小蓝", "the name is trimmed before it is stored");
      assert.equal(patched.body.scale, 1.75);
      assert.equal(patched.body.activeAction, "wave");

      // POST is an accepted synonym for PATCH so a form-style client can use it too.
      const postPatch = await coreJson<PetState>(address, "/pet", { personaId: "playful-fish-2" }, "POST");
      assert.equal(postPatch.status, 200);
      assert.equal(postPatch.body.personaId, "playful-fish-2");
      assert.equal(postPatch.body.name, "小蓝", "a partial patch leaves the other fields untouched");

      const reverified = await coreJson<PetState>(address, "/pet");
      assert.equal(reverified.body.name, "小蓝");
      assert.equal(reverified.body.scale, 1.75);
      assert.equal(reverified.body.activeAction, "wave");
      assert.equal(reverified.body.homeGrantActive, false, "pet configuration never grants a home plot");
    } finally {
      await first.stop();
    }

    const second = new FangcunHost({ worldId: "pet-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const secondAddress = await second.start();
    try {
      const restored = await coreJson<PetState>(secondAddress, "/pet");
      assert.equal(restored.body.name, "小蓝", "the renamed pet survives a Host restart");
      assert.equal(restored.body.scale, 1.75, "the scale survives a Host restart");
      assert.equal(restored.body.activeAction, "wave", "the active action survives a Host restart");
      assert.equal(restored.body.personaId, "playful-fish-2");
    } finally {
      await second.stop();
    }
  } finally {
    db.cleanup();
  }
});

test("pet profile rejects unknown actions, oversized names, bad scale and unknown fields", async () => {
  const host = new FangcunHost({ worldId: "pet-invalid-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
  const address = await host.start();
  try {
    const rejected: Array<{ body: unknown; error: string }> = [
      { body: { action: "dance" }, error: "unknown_pet_action" },
      { body: { action: 42 }, error: "unknown_pet_action" },
      { body: { name: "字".repeat(25) }, error: "invalid_pet_name" },
      { body: { name: "   " }, error: "invalid_pet_name" },
      { body: { name: 7 }, error: "invalid_pet_name" },
      { body: { scale: 0.4 }, error: "invalid_pet_scale" },
      { body: { scale: 3.1 }, error: "invalid_pet_scale" },
      { body: { scale: "1" }, error: "invalid_pet_scale" },
      { body: { name: "ok", extra: true }, error: "unknown_pet_field" },
      { body: { personaId: "" }, error: "invalid_pet_persona" },
      { body: [], error: "invalid_pet_request" },
    ];
    for (const { body, error } of rejected) {
      const response = await coreJson<{ error: string }>(address, "/pet", body, "PATCH");
      assert.equal(response.status, 400, `${JSON.stringify(body)} must be rejected`);
      assert.equal(response.body.error, error);
    }
    const unchanged = await coreJson<PetState>(address, "/pet");
    assert.equal(unchanged.body.name, "小鱼", "a rejected patch never mutates the profile");
    assert.equal(unchanged.body.scale, 1);
    assert.equal(unchanged.body.activeAction, "stand");

    // A subset of zero fields is a valid no-op, not an error.
    const noop = await coreJson<PetState>(address, "/pet", {}, "PATCH");
    assert.equal(noop.status, 200);
    assert.equal(noop.body.name, "小鱼");
  } finally {
    await host.stop();
  }
});

test("pet configuration broadcasts companion_state and companion_action to WebSocket clients", async () => {
  const host = new FangcunHost({ worldId: "pet-ws-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
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
      socket.send(JSON.stringify({ protocolVersion: 1, type: "hello", worldId: "pet-ws-world", clientId: "tablet-1", credential: pairing.token, lastAppliedRev: 0 }));
      assert.equal((await read()).type, "welcome");
      assert.equal((await read()).type, "companion_state");

      const renamed = await coreJson<PetState>(address, "/pet", { name: "小蓝", scale: 2 }, "PATCH");
      assert.equal(renamed.status, 200);
      const stateNotice = await read();
      assert.equal(stateNotice.type, "companion_state", "name/scale changes re-announce the companion state");
      assert.equal(stateNotice.companionId, "fish-1");

      const triggered = await coreJson<PetState>(address, "/pet", { action: "jump" }, "POST");
      assert.equal(triggered.status, 200);
      assert.equal(triggered.body.activeAction, "jump");
      const trigger = await read();
      assert.equal(trigger.type, "companion_action");
      assert.equal(trigger.worldId, "pet-ws-world");
      assert.equal(trigger.companionId, "fish-1");
      assert.equal(trigger.actionId, "jump");
      assert.ok(Number.isSafeInteger(trigger.expiresAtMs) && (trigger.expiresAtMs as number) > Date.now(), "the action carries a future expiry");
      // The broadcast is the same shape the protocol validator (and the tablet) accepts.
      assert.equal(validateCompanionActionMessage(trigger).ok, true);
    } finally {
      socket.close();
    }
  } finally {
    await host.stop();
  }
});

type CompanionViewBody = Readonly<{
  companionId: string;
  name: string;
  ownerUserId: string;
  personaId: string;
  personality: string;
  avatarModelId: string;
  avatarImage: string | null;
  state: string;
  activeAction: string;
  items: string[];
  isMine: boolean;
}>;

type InventoryBody = Readonly<{ items: Array<{ itemId: string; count: number }> }>;
type ChatBody = Readonly<{ messages: Array<{ role: "user" | "companion"; text: string; atMs: number }>; companionId: string }>;

test("companions list seeds the owner pet and one local demo friend with derived ownership", async () => {
  const host = new FangcunHost({ worldId: "social-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
  const address = await host.start();
  try {
    const list = await coreJson<{ companions: CompanionViewBody[] }>(address, "/companions");
    assert.equal(list.status, 200);
    assert.equal(list.body.companions.length, 2, "v0 seeds the owner pet plus exactly one demo friend");
    const primary = list.body.companions[0]!;
    const friend = list.body.companions[1]!;
    assert.equal(primary.companionId, "fish-1");
    assert.equal(primary.ownerUserId, "owner-1");
    assert.equal(primary.isMine, true, "isMine is derived from the Host owner, not stored");
    assert.equal(primary.name, "小鱼");
    assert.equal(primary.personaId, "playful-fish");
    assert.equal(primary.activeAction, "stand");
    assert.equal(primary.state, "idle");
    assert.deepEqual(primary.items, []);
    assert.ok(primary.personality.length >= 1 && primary.personality.length <= 60, "personality is a short Chinese string");
    assert.ok(primary.avatarModelId.length > 0);
    assert.equal(primary.avatarImage, null, "the seeded companion has no avatar image");
    assert.equal(friend.companionId, "fish-friend-1");
    assert.equal(friend.ownerUserId, "friend-demo");
    assert.equal(friend.isMine, false, "the demo friend is a local fixture, not the owner");
    assert.equal(friend.personality, "慢热，喜欢收集石头");
    assert.equal(friend.avatarImage, null);
    assert.deepEqual(friend.items, []);

    const single = await coreJson<CompanionViewBody>(address, "/companions/fish-friend-1");
    assert.equal(single.status, 200);
    assert.equal(single.body.companionId, "fish-friend-1");
    assert.equal(single.body.isMine, false);
    assert.equal((await coreJson<{ error: string }>(address, "/companions/missing-1")).status, 404);

    // GET /api/core/pet keeps working and describes the same primary companion.
    const pet = await coreJson<{ name: string; companionId: string }>(address, "/pet");
    assert.equal(pet.body.companionId, primary.companionId);
    assert.equal(pet.body.name, primary.name);
  } finally {
    await host.stop();
  }
});

test("companion PATCH enforces ownership, strict fields and survives a restart", async () => {
  const db = tempDb();
  try {
    const first = new FangcunHost({ worldId: "social-patch-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const address = await first.start();
    try {
      for (const body of [{ personality: "改成我的" }, { name: "抢来的" }]) {
        const rejected = await coreJson<{ error: string }>(address, "/companions/fish-friend-1", body, "PATCH");
        assert.equal(rejected.status, 403, "the demo friend is write-protected");
        assert.equal(rejected.body.error, "not_owner");
      }

      const patched = await coreJson<CompanionViewBody>(address, "/companions/fish-1", {
        name: "小蓝",
        personality: " 很粘人，爱撒娇 ",
        personaId: "playful-fish-2",
      }, "PATCH");
      assert.equal(patched.status, 200);
      assert.equal(patched.body.name, "小蓝");
      assert.equal(patched.body.personality, "很粘人，爱撒娇", "personality is trimmed");
      assert.equal(patched.body.personaId, "playful-fish-2");
      assert.equal(patched.body.isMine, true);

      const pet = await coreJson<{ name: string; personaId: string }>(address, "/pet");
      assert.equal(pet.body.name, "小蓝", "the companion profile is the single source for the pet view");
      assert.equal(pet.body.personaId, "playful-fish-2");

      const rejects: Array<{ id: string; body: unknown; status: number; error: string }> = [
        { id: "fish-1", body: { name: "字".repeat(25) }, status: 400, error: "invalid_companion_name" },
        { id: "fish-1", body: { name: "   " }, status: 400, error: "invalid_companion_name" },
        { id: "fish-1", body: { personality: "字".repeat(61) }, status: 400, error: "invalid_companion_personality" },
        { id: "fish-1", body: { personality: "  " }, status: 400, error: "invalid_companion_personality" },
        { id: "fish-1", body: { personaId: "" }, status: 400, error: "invalid_companion_persona" },
        { id: "fish-1", body: { name: "ok", extra: true }, status: 400, error: "unknown_companion_field" },
        { id: "fish-1", body: [], status: 400, error: "invalid_companion_request" },
        { id: "missing-1", body: { name: "x" }, status: 404, error: "companion_not_found" },
      ];
      for (const { id, body, status, error } of rejects) {
        const response = await coreJson<{ error: string }>(address, `/companions/${id}`, body, "PATCH");
        assert.equal(response.status, status, `${JSON.stringify(body)} must be rejected with ${status}`);
        assert.equal(response.body.error, error);
      }
    } finally {
      await first.stop();
    }

    const second = new FangcunHost({ worldId: "social-patch-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const secondAddress = await second.start();
    try {
      const restored = await coreJson<CompanionViewBody>(secondAddress, "/companions/fish-1");
      assert.equal(restored.body.name, "小蓝", "the companion rename survives a Host restart");
      assert.equal(restored.body.personality, "很粘人，爱撒娇");
      assert.equal(restored.body.personaId, "playful-fish-2");
      const list = await coreJson<{ companions: CompanionViewBody[] }>(secondAddress, "/companions");
      assert.equal(list.body.companions.length, 2, "the seeded friend list survives a Host restart");
      assert.equal(list.body.companions[1]!.isMine, false);
      assert.equal(list.body.companions[1]!.personality, "慢热，喜欢收集石头");
    } finally {
      await second.stop();
    }
  } finally {
    db.cleanup();
  }
});

test("chat is per companion while the legacy no-argument form still targets the primary", async () => {
  const host = new FangcunHost({ worldId: "social-chat-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
  const address = await host.start();
  try {
    const friendReply = await coreJson<{ reply: string; state: string; companionId: string }>(address, "/chat", {
      companionId: "fish-friend-1",
      text: "你好呀",
    });
    assert.equal(friendReply.status, 200);
    assert.match(friendReply.body.reply, /[\u4e00-\u9fff]/);
    assert.equal(friendReply.body.companionId, "fish-friend-1");

    const friendLog = await coreJson<ChatBody>(address, "/chat?companionId=fish-friend-1");
    assert.equal(friendLog.body.companionId, "fish-friend-1");
    assert.deepEqual(friendLog.body.messages.map((message) => message.role), ["user", "companion"]);
    assert.equal(friendLog.body.messages[0]!.text, "你好呀");

    const primaryBefore = await coreJson<ChatBody>(address, "/chat");
    assert.equal(primaryBefore.body.companionId, "fish-1", "the legacy GET defaults to the primary companion");
    assert.deepEqual(primaryBefore.body.messages, [], "friend chat never leaks into the primary log");

    const legacy = await coreJson<{ reply: string; companionId: string }>(address, "/chat", { text: "在吗" });
    assert.equal(legacy.status, 200);
    assert.equal(legacy.body.companionId, "fish-1");
    const primaryAfter = await coreJson<ChatBody>(address, "/chat");
    assert.deepEqual(primaryAfter.body.messages.map((message) => message.role), ["user", "companion"]);
    assert.equal(primaryAfter.body.messages[0]!.text, "在吗");
    assert.equal((await coreJson<ChatBody>(address, "/chat?companionId=fish-friend-1")).body.messages.length, 2, "the friend log is unchanged");

    assert.equal((await coreJson<{ error: string }>(address, "/chat", { companionId: "ghost-1", text: "hi" })).status, 404);
    assert.equal((await coreJson<{ error: string }>(address, "/chat?companionId=ghost-1")).status, 404);
    assert.equal((await coreJson<{ error: string }>(address, "/chat", { text: "hi", extra: 1 })).status, 400, "chat bodies reject unknown fields");
    assert.equal(host.revision, 0, "chat never mutates the world");
  } finally {
    await host.stop();
  }
});

test("per-companion chat broadcasts companion_say with that companion id", async () => {
  const host = new FangcunHost({ worldId: "social-chat-ws-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
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
      socket.send(JSON.stringify({ protocolVersion: 1, type: "hello", worldId: "social-chat-ws-world", clientId: "tablet-1", credential: pairing.token, lastAppliedRev: 0 }));
      assert.equal((await read()).type, "welcome");
      assert.equal((await read()).type, "companion_state");
      const chat = await coreJson<{ reply: string }>(address, "/chat", { companionId: "fish-friend-1", text: "谢谢你的石头" });
      assert.equal(chat.status, 200);
      const say = await read();
      assert.equal(say.type, "companion_say");
      assert.equal(say.companionId, "fish-friend-1", "the reply is attributed to the chatted companion");
      assert.equal(say.text, chat.body.reply);
    } finally {
      socket.close();
    }
  } finally {
    await host.stop();
  }
});

test("inventory seeds three demo items, gives them to an owned companion and rejects a full bag", async () => {
  const db = tempDb();
  try {
    const first = new FangcunHost({ worldId: "social-inventory-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const address = await first.start();
    try {
      const catalog = await coreJson<{ items: Array<{ itemId: string; displayName: string; description: string; icon: string }> }>(address, "/items");
      assert.equal(catalog.status, 200);
      assert.deepEqual(
        catalog.body.items.map((item) => item.itemId),
        ["v0-iron-basin", "v0-wood-cup", "v0-stone-bell"],
        "the basin stays first and the two drag-and-drop demo items follow",
      );
      assert.equal(catalog.body.items[0]!.displayName, "v0体验版小铁盆");
      assert.equal(catalog.body.items[1]!.displayName, "v0体验版小木杯");
      assert.equal(catalog.body.items[2]!.displayName, "v0体验版小石铃");
      assert.deepEqual(catalog.body.items.map((item) => item.icon), ["basin", "cup", "bell"]);
      for (const item of catalog.body.items) assert.ok(item.description.length > 0);

      // Fresh demo seed: 1x each of the three items, in catalog order.
      assert.deepEqual((await coreJson<InventoryBody>(address, "/inventory")).body.items, [
        { itemId: "v0-iron-basin", count: 1 },
        { itemId: "v0-wood-cup", count: 1 },
        { itemId: "v0-stone-bell", count: 1 },
      ]);

      const rejects: Array<{ body: unknown; status: number; error: string }> = [
        { body: { companionId: "fish-friend-1", itemId: "v0-iron-basin" }, status: 403, error: "not_owner" },
        { body: { companionId: "fish-1", itemId: "v0-gold" }, status: 400, error: "unknown_item" },
        { body: { companionId: "ghost-1", itemId: "v0-iron-basin" }, status: 404, error: "companion_not_found" },
        { body: { companionId: "fish-1", itemId: "v0-iron-basin", extra: true }, status: 400, error: "invalid_give_request" },
        { body: { companionId: "fish-1" }, status: 400, error: "invalid_give_request" },
        { body: [], status: 400, error: "invalid_give_request" },
      ];
      for (const { body, status, error } of rejects) {
        const response = await coreJson<{ error: string }>(address, "/inventory/give", body);
        assert.equal(response.status, status, `${JSON.stringify(body)} must be rejected with ${status}`);
        assert.equal(response.body.error, error);
      }
      assert.equal((await coreJson<InventoryBody>(address, "/inventory")).body.items.length, 3, "rejections never spend an item");

      // Happy path: fill both slots with two different items.
      const firstGive = await coreJson<{ companion: CompanionViewBody; inventory: InventoryBody }>(address, "/inventory/give", {
        companionId: "fish-1",
        itemId: "v0-iron-basin",
      });
      assert.equal(firstGive.status, 200);
      assert.deepEqual(firstGive.body.companion.items, ["v0-iron-basin"]);
      const secondGive = await coreJson<{ companion: CompanionViewBody; inventory: InventoryBody }>(address, "/inventory/give", {
        companionId: "fish-1",
        itemId: "v0-wood-cup",
      });
      assert.equal(secondGive.status, 200);
      assert.deepEqual(secondGive.body.companion.items, ["v0-iron-basin", "v0-wood-cup"]);
      assert.deepEqual(secondGive.body.inventory.items, [{ itemId: "v0-stone-bell", count: 1 }]);
      assert.deepEqual(
        (await coreJson<InventoryBody>(address, "/inventory")).body.items,
        [{ itemId: "v0-stone-bell", count: 1 }],
        "each transfer decrements exactly one stack",
      );

      // Third give: the bag has two different items, so it is genuinely full now.
      const full = await coreJson<{ error: string }>(address, "/inventory/give", { companionId: "fish-1", itemId: "v0-stone-bell" });
      assert.equal(full.status, 409);
      assert.equal(full.body.error, "companion_inventory_full", "two different items fill the v0 bag");
      assert.deepEqual(
        (await coreJson<InventoryBody>(address, "/inventory")).body.items,
        [{ itemId: "v0-stone-bell", count: 1 }],
        "a full-bag rejection does not spend the item",
      );

      const noItem = await coreJson<{ error: string }>(address, "/inventory/give", { companionId: "fish-1", itemId: "v0-iron-basin" });
      assert.equal(noItem.status, 409);
      assert.equal(noItem.body.error, "item_not_owned", "the basin already left the warehouse");
    } finally {
      await first.stop();
    }

    const second = new FangcunHost({ worldId: "social-inventory-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const secondAddress = await second.start();
    try {
      const restored = await coreJson<CompanionViewBody>(secondAddress, "/companions/fish-1");
      assert.deepEqual(restored.body.items, ["v0-iron-basin", "v0-wood-cup"], "the companion bag survives a Host restart");
      assert.deepEqual(
        (await coreJson<InventoryBody>(secondAddress, "/inventory")).body.items,
        [{ itemId: "v0-stone-bell", count: 1 }],
        "the transferred-away stacks stay gone after restart",
      );
    } finally {
      await second.stop();
    }
  } finally {
    db.cleanup();
  }
});

test("companion item rules enforce the two-slot cap and the v0 no-duplicates decision", () => {
  const full = addItemToCompanion(["v0-iron-basin", "v0-wood-cup"], "v0-stone-bell");
  assert.equal(full.ok, false);
  if (!full.ok) assert.equal(full.error, "companion_inventory_full", "two distinct items fill the v0 bag");
  const duplicate = addItemToCompanion(["v0-iron-basin"], "v0-iron-basin");
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.error, "item_already_held", "v0 keeps companion bags duplicate-free");
  const added = addItemToCompanion([], "v0-iron-basin");
  assert.equal(added.ok, true);
  if (added.ok) assert.deepEqual(added.items, ["v0-iron-basin"]);
});

test("a fresh warehouse seeds all three demo items and a legacy warehouse is topped up once", async () => {
  const db = tempDb();
  try {
    // Simulate a store written by the previous build: empty warehouse (basin spent on a
    // companion), no seed-version key, and profiles without the avatarImage field.
    const first = new FangcunHost({ worldId: "warehouse-upgrade-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    await first.start();
    await first.stop();
    const raw = new DatabaseSync(db.path);
    const profileRow = raw.prepare("SELECT value FROM meta WHERE key = 'companionProfiles'").get() as { value: string };
    const document = JSON.parse(profileRow.value) as { schemaVersion: number; companions: Array<Record<string, unknown>> };
    for (const profile of document.companions) delete profile.avatarImage;
    raw.prepare("UPDATE meta SET value = ? WHERE key = 'companionProfiles'").run(JSON.stringify(document));
    raw.prepare("UPDATE meta SET value = ? WHERE key = 'userInventory'").run(JSON.stringify({ schemaVersion: 1, items: [] }));
    raw.prepare("DELETE FROM meta WHERE key = 'warehouseSeedVersion'").run();
    raw.close();

    const second = new FangcunHost({ worldId: "warehouse-upgrade-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const address = await second.start();
    try {
      assert.deepEqual(
        (await coreJson<InventoryBody>(address, "/inventory")).body.items,
        [{ itemId: "v0-wood-cup", count: 1 }, { itemId: "v0-stone-bell", count: 1 }],
        "the upgrade grants only the new demo items; the spent basin is not re-granted",
      );
      const companions = await coreJson<{ companions: CompanionViewBody[] }>(address, "/companions");
      assert.equal(companions.body.companions[0]!.avatarImage, null, "profiles stored without avatarImage read as null");
    } finally {
      await second.stop();
    }

    // The top-up is one-time: a third start must not grant the demo items again.
    const third = new FangcunHost({ worldId: "warehouse-upgrade-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const thirdAddress = await third.start();
    try {
      assert.deepEqual(
        (await coreJson<InventoryBody>(thirdAddress, "/inventory")).body.items,
        [{ itemId: "v0-wood-cup", count: 1 }, { itemId: "v0-stone-bell", count: 1 }],
        "the demo top-up is applied exactly once",
      );
    } finally {
      await third.stop();
    }
  } finally {
    db.cleanup();
  }
});

const TINY_PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const MAX_SIZE_JPEG_DATA_URL = `data:image/jpeg;base64,${Buffer.alloc(64 * 1024).toString("base64")}`;
const OVERSIZE_PNG_DATA_URL = `data:image/png;base64,${Buffer.alloc(64 * 1024 + 1).toString("base64")}`;

test("companion avatar images are owner-only, bounded data URLs that survive a restart", async () => {
  const db = tempDb();
  try {
    const first = new FangcunHost({ worldId: "social-avatar-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const address = await first.start();
    try {
      const initial = await coreJson<{ companions: CompanionViewBody[] }>(address, "/companions");
      assert.equal(initial.body.companions[0]!.avatarImage, null, "avatarImage is null by default");

      const patched = await coreJson<CompanionViewBody>(address, "/companions/fish-1", { avatarImage: TINY_PNG_DATA_URL }, "PATCH");
      assert.equal(patched.status, 200);
      assert.equal(patched.body.avatarImage, TINY_PNG_DATA_URL);
      assert.equal((await coreJson<CompanionViewBody>(address, "/companions/fish-1")).body.avatarImage, TINY_PNG_DATA_URL);

      // Exactly 64 KiB decoded is accepted (boundary).
      const maxSized = await coreJson<CompanionViewBody>(address, "/companions/fish-1", { avatarImage: MAX_SIZE_JPEG_DATA_URL }, "PATCH");
      assert.equal(maxSized.status, 200);
      assert.equal(maxSized.body.avatarImage, MAX_SIZE_JPEG_DATA_URL);

      const friendPatch = await coreJson<{ error: string }>(address, "/companions/fish-friend-1", { avatarImage: TINY_PNG_DATA_URL }, "PATCH");
      assert.equal(friendPatch.status, 403, "only owned companions accept avatar changes");
      assert.equal(friendPatch.body.error, "not_owner");

      const malformed: unknown[] = [
        "https://evil.example/pet.png",
        "data:image/gif;base64,AAAA",
        "data:image/svg+xml;base64,AAAA",
        "data:image/png;base64,%%%",
        "data:image/png;base64,",
        "data:image/png;base64,AAAAA",
        42,
      ];
      for (const avatarImage of malformed) {
        const response = await coreJson<{ error: string }>(address, "/companions/fish-1", { avatarImage }, "PATCH");
        assert.equal(response.status, 400, `malformed avatar ${String(avatarImage).slice(0, 24)} must be rejected`);
        assert.equal(response.body.error, "invalid_avatar");
      }
      const tooLarge = await coreJson<{ error: string }>(address, "/companions/fish-1", { avatarImage: OVERSIZE_PNG_DATA_URL }, "PATCH");
      assert.equal(tooLarge.status, 413);
      assert.equal(tooLarge.body.error, "avatar_too_large");
      assert.equal(
        (await coreJson<CompanionViewBody>(address, "/companions/fish-1")).body.avatarImage,
        MAX_SIZE_JPEG_DATA_URL,
        "rejected avatar patches leave the stored image untouched",
      );

      const cleared = await coreJson<CompanionViewBody>(address, "/companions/fish-1", { avatarImage: null }, "PATCH");
      assert.equal(cleared.body.avatarImage, null, "null clears the avatar");
      await coreJson(address, "/companions/fish-1", { avatarImage: TINY_PNG_DATA_URL }, "PATCH");
    } finally {
      await first.stop();
    }

    const second = new FangcunHost({ worldId: "social-avatar-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const secondAddress = await second.start();
    try {
      const restored = await coreJson<CompanionViewBody>(secondAddress, "/companions/fish-1");
      assert.equal(restored.body.avatarImage, TINY_PNG_DATA_URL, "the avatar image survives a Host restart");
      const list = await coreJson<{ companions: CompanionViewBody[] }>(secondAddress, "/companions");
      assert.equal(list.body.companions[0]!.avatarImage, TINY_PNG_DATA_URL, "the list view also returns the avatar image");
      assert.equal(list.body.companions[1]!.avatarImage, null);
    } finally {
      await second.stop();
    }
  } finally {
    db.cleanup();
  }
});

test("inventory transfer broadcasts companion_state so open panels refresh", async () => {
  const host = new FangcunHost({ worldId: "social-broadcast-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
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
      socket.send(JSON.stringify({ protocolVersion: 1, type: "hello", worldId: "social-broadcast-world", clientId: "tablet-1", credential: pairing.token, lastAppliedRev: 0 }));
      assert.equal((await read()).type, "welcome");
      assert.equal((await read()).type, "companion_state");
      const given = await coreJson<{ companion: CompanionViewBody }>(address, "/inventory/give", { companionId: "fish-1", itemId: "v0-iron-basin" });
      assert.equal(given.status, 200);
      const notice = await read();
      assert.equal(notice.type, "companion_state", "the transfer re-uses companion_state as the refresh signal");
      assert.equal(notice.companionId, "fish-1");
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

