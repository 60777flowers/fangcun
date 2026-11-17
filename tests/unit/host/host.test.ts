import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { applyTransaction, createSeedWorld, getBlock } from "@fangcun/voxel-core";
import { COMPANION_ACTION_IDS, validateCompanionActionMessage, validateCompanionBuildProposalMessage } from "@fangcun/protocol";
import { HOUSE_PLAN_BLOCK_COUNT } from "@fangcun/companion-runtime";
import { coordToIndex } from "@fangcun/world-schema";
import { FangcunHost } from "../../../packages/host/src/index.ts";
import { addItemToCompanion } from "../../../packages/host/src/items.ts";
import { HostStore } from "../../../packages/host/src/persistence.ts";

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

test("autonomy self-proposes a house instead of instant-building, and manual ticks still serialize", async () => {
  const host = new FangcunHost({ worldId: "autonomy-serial-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40 });
  const address = await host.start();
  try {
    const tick = await coreTick<{ result: { candidate?: { candidateId: string } } }>(address);
    const candidateId = tick.body.result.candidate?.candidateId;
    assert.ok(candidateId);
    assert.equal((await coreJson(address, "/home/approve", { candidateId })).status, 200);
    // The self-driven loop now asks instead of committing an instant 12-block home.
    const proposed = await waitForState(address, (state) => state.houseProposal !== null, "the self-driven house proposal");
    assert.equal(proposed.world.rev, 0, "autonomy asks before any instant generation");
    assert.equal(proposed.companionState, "awaiting_approval");
    const status = await coreJson<{ lastRunAtMs: number | null }>(address, "/autonomy");
    assert.ok(typeof status.body.lastRunAtMs === "number" && status.body.lastRunAtMs > 0, "the scheduler actually ran");

    // Manual ticks keep the legacy instant path and still serialize: the revision can only jump once.
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

// ------------------------------------------------------------------------------------
// House proposal + block-by-block build queue
// ------------------------------------------------------------------------------------

type HomeBounds = Readonly<{
  min: Readonly<{ x: number; y: number; z: number }>;
  maxExclusive: Readonly<{ x: number; y: number; z: number }>;
}>;
type PendingProposalBody = Readonly<{
  proposalId: string;
  companionId: string;
  bounds: HomeBounds;
  planBlockCount: number;
  expiresAtMs: number;
}>;
type BuildSummaryBody = Readonly<{
  inProgress: boolean;
  completedBlocks: number;
  totalBlocks: number;
  intervalMs: number;
  lastError: string | null;
  seatPlaced: boolean;
  seatError: string | null;
}>;
type GrantMigrationBody = Readonly<{
  at: number;
  grantId: string;
  from: HomeBounds;
  to: HomeBounds;
  reason: string;
}>;
type HouseStateBody = Readonly<{
  world: Readonly<{ rev: number; blocks: Array<string | null> }>;
  homeGrantActive: boolean;
  companionState: string;
  houseProposal: PendingProposalBody | null;
  grantMigration: GrantMigrationBody | null;
  build: BuildSummaryBody;
}>;
type CompanionDetailBody = Readonly<{ companionId: string; houseProposal: PendingProposalBody | null }>;
type PlaceOpBody = Readonly<{ type: "place"; at: { x: number; y: number; z: number }; blockId: string }>;

/** Grants a home plot and returns the candidate bounds the grant now covers. */
async function grantHome(address: CoreAddress): Promise<HomeBounds> {
  const tick = await coreTick<{ result: { status: string; candidate?: { candidateId: string; bounds: HomeBounds } } }>(address);
  assert.equal(tick.body.result.status, "home_approval_required");
  const candidate = tick.body.result.candidate;
  assert.ok(candidate, "the tick exposes a home candidate");
  const approved = await coreJson<{ approved: boolean }>(address, "/home/approve", { candidateId: candidate.candidateId });
  assert.equal(approved.body.approved, true);
  return candidate.bounds;
}

async function proposeHouse(address: CoreAddress): Promise<PendingProposalBody> {
  const response = await coreJson<{ proposal: PendingProposalBody }>(address, "/house/propose", undefined, "POST");
  assert.equal(response.status, 200, `propose failed: ${JSON.stringify(response.body)}`);
  return response.body.proposal;
}

async function decideHouse(address: CoreAddress, proposalId: string, approve: boolean): Promise<{ status: number; body: { approved?: boolean; planBlockCount?: number; error?: string } }> {
  return coreJson(address, "/house/decide", { proposalId, approve });
}

async function hostState(address: CoreAddress): Promise<HouseStateBody> {
  return (await coreJson<HouseStateBody>(address, "/state")).body;
}

async function waitForState(
  address: CoreAddress,
  predicate: (state: HouseStateBody) => boolean,
  label: string,
  timeoutMs = 10000,
): Promise<HouseStateBody> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await hostState(address);
    if (predicate(state)) return state;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}: ${JSON.stringify(state.build)}`);
    await delay(5);
  }
}

/** Bounds a completion promise so a product hang fails the test instead of hanging the run. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => { throw new Error(`timed out waiting for ${label}`); }),
  ]);
}

/** Pairs a WebSocket client and drains the hello welcome/companion_state frames. */
async function pairTablet(host: FangcunHost, address: CoreAddress): Promise<{ socket: WebSocket; read: () => Promise<Record<string, unknown>> }> {
  const code = host.issuePairingCode();
  const pairResponse = await fetch(`http://${address.host}:${address.port}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.code, clientId: "house-tablet-1" }),
  });
  const pairing = (await pairResponse.json()) as { token: string };
  const socket = await openSocket(`ws://${address.host}:${address.port}/api/ws`);
  const read = socketReader(socket);
  socket.send(JSON.stringify({ protocolVersion: 1, type: "hello", worldId: host.worldId, clientId: "house-tablet-1", credential: pairing.token, lastAppliedRev: 0 }));
  assert.equal((await read()).type, "welcome");
  assert.equal((await read()).type, "companion_state");
  return { socket, read };
}

/** Reads frames until the expected type arrives (bounded by the socket reader's timeout). */
async function readUntilType(read: () => Promise<Record<string, unknown>>, type: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const frame = await read();
    if (frame.type === type) return frame;
  }
  throw new Error(`no ${type} frame observed`);
}

function blockInState(state: HouseStateBody, at: Readonly<{ x: number; y: number; z: number }>): string | null {
  return state.world.blocks[coordToIndex(at)] ?? null;
}

test("house proposal is rejected without a grant and exposed in state after proposing", async () => {
  const host = new FangcunHost({ worldId: "house-proposal-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0, buildIntervalMs: 0 });
  const address = await host.start();
  try {
    const noGrant = await coreJson<{ error: string }>(address, "/house/propose", undefined, "POST");
    assert.equal(noGrant.status, 409);
    assert.equal(noGrant.body.error, "grant_missing");

    await grantHome(address);
    const startRev = host.revision;
    const proposal = await proposeHouse(address);
    assert.equal(proposal.companionId, "fish-1");
    assert.equal(proposal.planBlockCount, HOUSE_PLAN_BLOCK_COUNT);
    assert.equal(proposal.planBlockCount, 24, "the v0 cottage plan stays inside the 24-block budget");
    assert.equal(proposal.bounds.maxExclusive.x - proposal.bounds.min.x, 3);
    assert.equal(proposal.bounds.maxExclusive.y - proposal.bounds.min.y, 3);
    assert.equal(proposal.bounds.maxExclusive.z - proposal.bounds.min.z, 3);
    assert.ok(proposal.expiresAtMs > Date.now(), "the proposal carries a future TTL");
    assert.equal(host.revision, startRev, "proposing never mutates the world");

    const state = await hostState(address);
    assert.deepEqual(state.houseProposal, proposal);
    assert.equal(state.build.inProgress, false);
    const detail = (await coreJson<CompanionDetailBody>(address, "/companions/fish-1")).body;
    assert.deepEqual(detail.houseProposal, proposal);
    assert.equal((await coreJson<CompanionDetailBody>(address, "/companions/fish-friend-1")).body.houseProposal, null);

    const duplicate = await coreJson<{ error: string }>(address, "/house/propose", undefined, "POST");
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, "proposal_pending");

    const rejected = await decideHouse(address, proposal.proposalId, false);
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.approved, false);
    assert.equal(host.revision, startRev, "rejecting a proposal leaves the world untouched");
    assert.equal((await hostState(address)).houseProposal, null);
    assert.equal((await coreJson<CompanionDetailBody>(address, "/companions/fish-1")).body.houseProposal, null);
    assert.equal((await decideHouse(address, proposal.proposalId, true)).status, 404, "a decided proposal id is not found again");
    assert.equal((await decideHouse(address, "missing-proposal", true)).status, 404);
    assert.equal((await coreJson(address, "/house/decide", { proposalId: "x", approve: "yes" })).status, 400);
    assert.equal((await coreJson(address, "/house/decide", { proposalId: "x", approve: true, extra: 1 })).status, 400);
  } finally {
    await host.stop();
  }
});

test("house proposal searches the plot when the origin is occupied and builds on the chosen footprint", async () => {
  const host = new FangcunHost({ worldId: "house-search-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0, buildIntervalMs: 0 });
  const address = await host.start();
  try {
    const bounds = await grantHome(address);
    const occupiedAt = { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z };
    const blocked = await coreJson<{ decision: { ack: { accepted: boolean } } }>(address, "/intent", {
      clientId: "house-blocker",
      seq: 1,
      baseRev: host.revision,
      operation: { type: "place", at: occupiedAt, blockId: "stone" },
    });
    assert.equal(blocked.body.decision.ack.accepted, true);
    const revBeforePropose = host.revision;

    // All four 3x3 origins inside the 4x4 grant tie on distance to the plot centre; the
    // deterministic z-then-x tie-break skips the occupied (0,0) origin and picks (1,0).
    const proposal = await proposeHouse(address);
    assert.deepEqual(proposal.bounds.min, { x: bounds.min.x + 1, y: bounds.min.y, z: bounds.min.z }, "the proposal points at the next clear footprint");
    assert.deepEqual(proposal.bounds.maxExclusive, { x: bounds.min.x + 4, y: bounds.min.y + 3, z: bounds.min.z + 3 });
    assert.equal(proposal.planBlockCount, 24);
    assert.equal(host.revision, revBeforePropose, "searching for a footprint never mutates the world");

    // The whole queue (and the seat) is generated relative to the chosen footprint.
    await decideHouse(address, proposal.proposalId, true);
    const done = await withTimeout(host.waitForBuildIdle(), 10000, "build on the searched footprint");
    assert.equal(done.completedBlocks, HOUSE_PLAN_BLOCK_COUNT);
    assert.equal(done.seatPlaced, true);
    const state = await hostState(address);
    const min = proposal.bounds.min;
    assert.equal(blockInState(state, { x: min.x, y: min.y, z: min.z }), "planks", "floor follows the chosen footprint");
    assert.equal(blockInState(state, { x: min.x + 1, y: min.y + 1, z: min.z + 1 }), "stairs", "seat is the chosen footprint's centre");
    assert.equal(blockInState(state, occupiedAt), "stone", "the pre-existing block at the origin is untouched");
  } finally {
    await host.stop();
  }
});

test("house proposal returns plot_not_clear only when no 3x3 area is clear anywhere", async () => {
  const host = new FangcunHost({ worldId: "house-blocked-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0, buildIntervalMs: 0 });
  const address = await host.start();
  try {
    const bounds = await grantHome(address);
    // Fill every ground cell of the (at most 6x6) grant; every 3x3 footprint now has an
    // occupied floor, so the proposal has nowhere to go.
    let seq = 0;
    for (let z = bounds.min.z; z < bounds.maxExclusive.z; z += 1) {
      for (let x = bounds.min.x; x < bounds.maxExclusive.x; x += 1) {
        seq += 1;
        const placed = await coreJson<{ decision: { ack: { accepted: boolean } } }>(address, "/intent", {
          clientId: "house-filler",
          seq,
          baseRev: host.revision,
          operation: { type: "place", at: { x, y: bounds.min.y, z }, blockId: "stone" },
        });
        assert.equal(placed.body.decision.ack.accepted, true, `filler placement ${seq} succeeded`);
      }
    }
    const propose = await coreJson<{ error: string }>(address, "/house/propose", undefined, "POST");
    assert.equal(propose.status, 409);
    assert.equal(propose.body.error, "plot_not_clear");
    assert.equal(host.revision, seq, "a blocked proposal performs no world write");
  } finally {
    await host.stop();
  }
});

test("a cramped legacy grant is widened once (max 6x6) so a cottage can still be proposed", async () => {
  const db = tempDb();
  try {
    const first = new FangcunHost({ worldId: "grant-widen-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const address = await first.start();
    let bounds: HomeBounds;
    try {
      bounds = await grantHome(address);
      // Simulate the legacy starter home at the grant origin: its 2x2 floor overlaps
      // every 3x3 footprint a 4x4 grant could offer, so plain origin scanning fails.
      let seq = 0;
      for (let dz = 0; dz < 2; dz += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          seq += 1;
          const placed = await coreJson<{ decision: { ack: { accepted: boolean } } }>(address, "/intent", {
            clientId: "grant-widen-filler",
            seq,
            baseRev: first.revision,
            operation: { type: "place", at: { x: bounds.min.x + dx, y: bounds.min.y, z: bounds.min.z + dz }, blockId: "planks" },
          });
          assert.equal(placed.body.decision.ack.accepted, true);
        }
      }
      assert.equal(
        (await coreJson<{ error: string }>(address, "/house/propose", undefined, "POST")).status,
        409,
        "the legacy starter home blocks every 3x3 inside the 4x4 grant",
      );
    } finally {
      await first.stop();
    }

    const second = new FangcunHost({ worldId: "grant-widen-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0, buildIntervalMs: 0, demoRelocateGrant: true });
    const secondAddress = await second.start();
    try {
      const state = await hostState(secondAddress);
      assert.equal(state.homeGrantActive, true);
      assert.ok(state.grantMigration, "the opt-in demo migration is exposed in state");
      assert.equal(state.grantMigration!.reason, "widened_for_clear_footprint");
      assert.equal(state.grantMigration!.grantId, "grant-local-home-1");
      assert.deepEqual(state.grantMigration!.from, bounds);
      const proposed = await coreJson<{ proposal: PendingProposalBody }>(secondAddress, "/house/propose", undefined, "POST");
      assert.equal(proposed.status, 200, `widened grant should propose: ${JSON.stringify(proposed.body)}`);
      const proposal = proposed.body.proposal;
      assert.equal(proposal.planBlockCount, HOUSE_PLAN_BLOCK_COUNT);
      assert.equal(proposal.bounds.maxExclusive.x - proposal.bounds.min.x, 3);
      // The widened grant (≤6x6) is persisted for the next start.
      const raw = new DatabaseSync(db.path);
      const rows = raw.prepare("SELECT json FROM grant").all() as Array<{ json: string }>;
      raw.close();
      assert.equal(rows.length, 1);
      const stored = JSON.parse(rows[0]!.json) as { bounds: HomeBounds };
      assert.equal(stored.bounds.maxExclusive.x - stored.bounds.min.x, 6, "the demo grant grew to the 6x6 schema maximum");
      assert.equal(stored.bounds.maxExclusive.z - stored.bounds.min.z, 6);
      assert.deepEqual(state.grantMigration!.to, stored.bounds, "the migration record matches the persisted grant");
    } finally {
      await second.stop();
    }
  } finally {
    db.cleanup();
  }
});

test("the demo grant migration is opt-in: without the flag a blocked grant stays plot_not_clear", async () => {
  const db = tempDb();
  try {
    const first = new FangcunHost({ worldId: "grant-opt-in-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const address = await first.start();
    let bounds: HomeBounds;
    try {
      bounds = await grantHome(address);
      let seq = 0;
      for (let dz = 0; dz < 2; dz += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          seq += 1;
          const placed = await coreJson<{ decision: { ack: { accepted: boolean } } }>(address, "/intent", {
            clientId: "grant-opt-in-filler",
            seq,
            baseRev: first.revision,
            operation: { type: "place", at: { x: bounds.min.x + dx, y: bounds.min.y, z: bounds.min.z + dz }, blockId: "planks" },
          });
          assert.equal(placed.body.decision.ack.accepted, true);
        }
      }
    } finally {
      await first.stop();
    }

    // No flag (and no option): the startup migration must not run at all.
    const second = new FangcunHost({ worldId: "grant-opt-in-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0, buildIntervalMs: 0 });
    const secondAddress = await second.start();
    try {
      const state = await hostState(secondAddress);
      assert.equal(state.grantMigration, null, "no migration happens without the demo flag");
      const rejected = await coreJson<{ error: string }>(secondAddress, "/house/propose", undefined, "POST");
      assert.equal(rejected.status, 409);
      assert.equal(rejected.body.error, "plot_not_clear");
      const raw = new DatabaseSync(db.path);
      const rows = raw.prepare("SELECT json FROM grant").all() as Array<{ json: string }>;
      raw.close();
      const stored = JSON.parse(rows[0]!.json) as { bounds: HomeBounds };
      assert.deepEqual(stored.bounds, bounds, "the grant is untouched when the demo flag is off");
    } finally {
      await second.stop();
    }
  } finally {
    db.cleanup();
  }
});

test("a legacy grant with no room even after widening is relocated once to a clear build site", async () => {
  const db = tempDb();
  try {
    const first = new FangcunHost({ worldId: "grant-relocate-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0 });
    const address = await first.start();
    let oldBounds: HomeBounds;
    try {
      oldBounds = await grantHome(address);
      // Fill the entire 4x4 grant floor: no 3x3 fits in the original plot or any 6x6
      // expansion of it, but the rest of the island stays clear.
      let seq = 0;
      for (let z = oldBounds.min.z; z < oldBounds.maxExclusive.z; z += 1) {
        for (let x = oldBounds.min.x; x < oldBounds.maxExclusive.x; x += 1) {
          seq += 1;
          const placed = await coreJson<{ decision: { ack: { accepted: boolean } } }>(address, "/intent", {
            clientId: "grant-relocate-filler",
            seq,
            baseRev: first.revision,
            operation: { type: "place", at: { x, y: oldBounds.min.y, z }, blockId: "stone" },
          });
          assert.equal(placed.body.decision.ack.accepted, true);
        }
      }
      assert.equal((await coreJson<{ error: string }>(address, "/house/propose", undefined, "POST")).status, 409);
    } finally {
      await first.stop();
    }

    // The demo migration is opt-in via the env flag; default is off (see previous test).
    const previousFlag = process.env.FANGCUN_DEMO_RELOCATE_GRANT;
    process.env.FANGCUN_DEMO_RELOCATE_GRANT = "1";
    let second: FangcunHost;
    try {
      second = new FangcunHost({ worldId: "grant-relocate-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0, buildIntervalMs: 0 });
    } finally {
      if (previousFlag === undefined) delete process.env.FANGCUN_DEMO_RELOCATE_GRANT;
      else process.env.FANGCUN_DEMO_RELOCATE_GRANT = previousFlag;
    }
    const secondAddress = await second.start();
    let migratedBounds: HomeBounds;
    try {
      const state = await hostState(secondAddress);
      assert.ok(state.grantMigration, "the opt-in demo migration is exposed in state");
      assert.equal(state.grantMigration!.reason, "relocated_to_clear_site");
      assert.equal(state.grantMigration!.grantId, "grant-local-home-1");
      assert.deepEqual(state.grantMigration!.from, oldBounds);
      const raw = new DatabaseSync(db.path);
      const rows = raw.prepare("SELECT json FROM grant").all() as Array<{ json: string }>;
      raw.close();
      const stored = JSON.parse(rows[0]!.json) as { bounds: HomeBounds };
      migratedBounds = stored.bounds;
      assert.deepEqual(state.grantMigration!.to, stored.bounds, "the migration record matches the persisted grant");
      assert.notDeepEqual(stored.bounds.min, oldBounds.min, "the demo grant moved to a clear site");
      assert.notDeepEqual(stored.bounds.maxExclusive, oldBounds.maxExclusive);
      const proposed = await coreJson<{ proposal: PendingProposalBody }>(secondAddress, "/house/propose", undefined, "POST");
      assert.equal(proposed.status, 200, `relocated grant should propose: ${JSON.stringify(proposed.body)}`);
      assert.equal(proposed.body.proposal.planBlockCount, HOUSE_PLAN_BLOCK_COUNT);
      assert.equal(blockInState(state, { x: oldBounds.min.x, y: oldBounds.min.y, z: oldBounds.min.z }), "stone", "the old blocks are untouched");
    } finally {
      await second.stop();
    }

    // Idempotent: another restart with the flag on must not migrate again.
    const third = new FangcunHost({ worldId: "grant-relocate-world", port: 0, ownerUserId: "owner-1", dbPath: db.path, autonomyIntervalMs: 0, buildIntervalMs: 0, demoRelocateGrant: true });
    const thirdAddress = await third.start();
    try {
      const state = await hostState(thirdAddress);
      assert.equal(state.grantMigration, null, "the demo migration never repeats on restart");
      const raw = new DatabaseSync(db.path);
      const rows = raw.prepare("SELECT json FROM grant").all() as Array<{ json: string }>;
      raw.close();
      const stored = JSON.parse(rows[0]!.json) as { bounds: HomeBounds };
      assert.deepEqual(stored.bounds, migratedBounds, "the migrated grant is stable across restarts");
      assert.equal((await coreJson<{ proposal: PendingProposalBody }>(thirdAddress, "/house/propose", undefined, "POST")).status, 200);
    } finally {
      await third.stop();
    }
  } finally {
    db.cleanup();
  }
});

test("an approved house builds one block per commit in floor→walls→roof order and seats the companion", async () => {
  // Manual scheduler: the queue advances only when the test pumps it, so the commit
  // sequence cannot be squeezed by other test files running concurrently.
  const pendingSteps: Array<() => void> = [];
  const host = new FangcunHost({
    worldId: "house-build-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0, buildIntervalMs: 0,
    buildStepScheduler: (run) => { pendingSteps.push(run); return () => undefined; },
  });
  const address = await host.start();
  let socket: WebSocket | undefined;
  try {
    const bounds = await grantHome(address);
    const startRev = host.revision;
    const paired = await pairTablet(host, address);
    socket = paired.socket;
    const proposal = await proposeHouse(address);

    const proposalFrame = await paired.read();
    assert.equal(proposalFrame.type, "companion_build_proposal");
    const validatedFrame = validateCompanionBuildProposalMessage(proposalFrame);
    assert.equal(validatedFrame.ok, true);
    if (validatedFrame.ok) {
      assert.equal(validatedFrame.value.proposalId, proposal.proposalId);
      assert.equal(validatedFrame.value.blockCount, HOUSE_PLAN_BLOCK_COUNT);
      assert.deepEqual(validatedFrame.value.bounds, proposal.bounds);
    }
    const awaiting = await paired.read();
    assert.equal(awaiting.type, "companion_state");
    assert.equal(awaiting.state, "awaiting_approval");
    const proposalSay = await paired.read();
    assert.equal(proposalSay.type, "companion_say");
    assert.match(String(proposalSay.text), /小房子/);

    const decided = await decideHouse(address, proposal.proposalId, true);
    assert.equal(decided.status, 200);
    assert.equal(decided.body.approved, true);
    assert.equal(decided.body.planBlockCount, HOUSE_PLAN_BLOCK_COUNT);

    // Pump the manual scheduler to completion (24 block steps + 1 completion step).
    let pumped = 0;
    while (pendingSteps.length > 0 && pumped < 100) {
      const step = pendingSteps.shift()!;
      step();
      pumped += 1;
    }
    assert.equal(pumped, HOUSE_PLAN_BLOCK_COUNT + 1, "the queue takes one step per block plus a completion step");
    const summary = await withTimeout(host.waitForBuildIdle(), 2000, "manual build completion");
    assert.equal(summary.inProgress, false);
    assert.equal(summary.completedBlocks, HOUSE_PLAN_BLOCK_COUNT);
    assert.equal(summary.intervalMs, 0);
    assert.equal(summary.lastError, null);
    assert.equal(summary.seatPlaced, true);

    // All frames were broadcast synchronously while pumping; read the buffered stream.
    const frames: Array<Record<string, unknown>> = [];
    for (let index = 0; index < HOUSE_PLAN_BLOCK_COUNT + 6; index += 1) frames.push(await paired.read());
    const building = frames[0]!;
    assert.equal(building.type, "companion_state");
    assert.equal(building.state, "building");
    const startSay = frames[1]!;
    assert.equal(startSay.type, "companion_say");
    assert.match(String(startSay.text), /开工/);

    // 24 plan commits, then the single seat placement.
    const planCommits = frames.slice(2, 2 + HOUSE_PLAN_BLOCK_COUNT) as unknown as Array<{ rev: number; actor: string; operations: PlaceOpBody[] }>;
    for (const [index, frame] of frames.slice(2, 2 + HOUSE_PLAN_BLOCK_COUNT).entries()) {
      assert.equal(frame.type, "commit", `frame ${index} is a build commit`);
    }
    const seatFrame = frames[2 + HOUSE_PLAN_BLOCK_COUNT]!;
    assert.equal(seatFrame.type, "commit");
    const seatCommit = seatFrame as unknown as { rev: number; operations: PlaceOpBody[] };
    assert.equal(seatCommit.operations.length, 1);
    assert.equal(seatCommit.operations[0]!.blockId, "stairs");
    assert.deepEqual(seatCommit.operations[0]!.at, { x: bounds.min.x + 1, y: bounds.min.y + 1, z: bounds.min.z + 1 });

    const idle = frames[3 + HOUSE_PLAN_BLOCK_COUNT]!;
    assert.equal(idle.type, "companion_state");
    assert.equal(idle.state, "idle");
    const doneSay = frames[4 + HOUSE_PLAN_BLOCK_COUNT]!;
    assert.equal(doneSay.type, "companion_say");
    assert.match(String(doneSay.text), /房子盖好/);
    const sitAction = frames[5 + HOUSE_PLAN_BLOCK_COUNT]!;
    assert.equal(sitAction.type, "companion_action");
    assert.equal(sitAction.actionId, "sit", "the seat expression reuses companion_action");

    // Exactly one place op per commit, ai actor, strictly increasing rev.
    assert.equal(planCommits.length, 24);
    planCommits.forEach((commit, index) => {
      assert.equal(commit.actor, "ai");
      assert.equal(commit.operations.length, 1, `commit ${index} has exactly one operation`);
      assert.equal(commit.rev, startRev + index + 1);
    });
    assert.equal(seatCommit.rev, startRev + HOUSE_PLAN_BLOCK_COUNT + 1, "the seat is a separate final commit");

    // Build order: floor (9) → walls (7) → roof (8), bottom-up.
    const baseY = bounds.min.y;
    const heights = planCommits.map((commit) => commit.operations[0]!.at.y - baseY);
    assert.deepEqual(heights.slice(0, 9), Array(9).fill(0), "floor is built first at the base layer");
    assert.deepEqual(heights.slice(9, 16), Array(7).fill(1), "walls follow one layer up");
    assert.deepEqual(heights.slice(16), Array(8).fill(2), "the roof is built last");
    const planBlockIds = planCommits.map((commit) => commit.operations[0]!.blockId);
    assert.deepEqual(planBlockIds.slice(0, 9), Array(9).fill("planks"), "floor is planks");
    assert.equal(planBlockIds.slice(9, 16).filter((id) => id === "glass").length, 1, "one glass window in the walls");
    assert.equal(planBlockIds.slice(9, 16).filter((id) => id === "planks").length, 6);
    assert.deepEqual(planBlockIds.slice(16), Array(8).fill("planks"), "roof is planks");
    const cells = new Set(planCommits.map((commit) => {
      const at = commit.operations[0]!.at;
      return `${at.x},${at.y},${at.z}`;
    }));
    assert.equal(cells.size, HOUSE_PLAN_BLOCK_COUNT, "every planned cell is placed exactly once");

    const finalState = await hostState(address);
    assert.equal(finalState.build.lastError, null);
    assert.equal(finalState.build.totalBlocks, HOUSE_PLAN_BLOCK_COUNT);
    assert.equal(finalState.build.seatPlaced, true);
    assert.equal(finalState.build.seatError, null);
    assert.equal(finalState.houseProposal, null);
    assert.equal(finalState.world.rev, startRev + HOUSE_PLAN_BLOCK_COUNT + 1);

    const centre = { x: bounds.min.x + 1, y: bounds.min.y, z: bounds.min.z + 1 };
    assert.equal(blockInState(finalState, { x: bounds.min.x, y: baseY, z: bounds.min.z }), "planks", "floor corner");
    assert.equal(blockInState(finalState, { x: bounds.min.x, y: baseY + 1, z: bounds.min.z }), "planks", "wall corner");
    assert.equal(blockInState(finalState, { x: bounds.min.x + 1, y: baseY + 1, z: bounds.min.z }), null, "front door gap stays empty");
    assert.equal(blockInState(finalState, { x: bounds.min.x + 2, y: baseY + 1, z: bounds.min.z + 1 }), "glass", "window is glass");
    assert.equal(blockInState(finalState, { x: bounds.min.x, y: baseY + 2, z: bounds.min.z }), "planks", "roof layer");
    assert.equal(blockInState(finalState, { x: bounds.min.x, y: baseY + 2, z: bounds.min.z + 2 }), null, "skylight corner stays open");
    assert.equal(blockInState(finalState, { x: centre.x, y: centre.y + 1, z: centre.z }), "stairs", "companion places and sits on the seat block");
    const pet = await coreJson<{ activeAction: string }>(address, "/pet");
    assert.equal(pet.body.activeAction, "sit", "the resting action is reflected in the pet view");
  } finally {
    socket?.close();
    await host.stop();
  }
});

test("a paced build rejects a second proposal and can still be stopped cleanly", async () => {
  const host = new FangcunHost({ worldId: "house-paced-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0, buildIntervalMs: 25 });
  const address = await host.start();
  try {
    await grantHome(address);
    const proposal = await proposeHouse(address);
    await decideHouse(address, proposal.proposalId, true);
    const running = await waitForState(address, (state) => state.build.inProgress && state.build.completedBlocks >= 2, "a running paced build");
    assert.ok(running.build.completedBlocks < HOUSE_PLAN_BLOCK_COUNT, "the queue is paced, not instant");
    const second = await coreJson<{ error: string }>(address, "/house/propose", undefined, "POST");
    assert.equal(second.status, 409);
    assert.equal(second.body.error, "build_in_progress");
    assert.equal((await decideHouse(address, proposal.proposalId, true)).status, 404, "the approved proposal is consumed");
    // Await the queue's completion signal instead of sleeping for the paced duration.
    const summary = await withTimeout(host.waitForBuildIdle(), 15000, "paced build completion");
    assert.equal(summary.inProgress, false);
    assert.equal(summary.completedBlocks, HOUSE_PLAN_BLOCK_COUNT);
    assert.equal(summary.intervalMs, 25);
    assert.equal(summary.lastError, null);
    assert.equal(summary.seatPlaced, true);
  } finally {
    await host.stop();
  }
});

test("a player edit stops the block-by-block queue with stale_revision", async () => {
  const host = new FangcunHost({ worldId: "house-stop-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0, buildIntervalMs: 25 });
  const address = await host.start();
  try {
    await grantHome(address);
    const proposal = await proposeHouse(address);
    await decideHouse(address, proposal.proposalId, true);
    await waitForState(address, (state) => state.build.inProgress && state.build.completedBlocks >= 2, "a running build");
    // Retry the player edit if a paced build step lands between reading the revision
    // and posting the intent (that would be rejected with stale_revision by design).
    let accepted = false;
    let seq = 0;
    let revBeforeEdit = host.revision;
    while (!accepted && seq < 20) {
      seq += 1;
      revBeforeEdit = host.revision;
      const edit = await coreJson<{ decision: { ack: { accepted: boolean; reason?: string } } }>(address, "/intent", {
        clientId: "house-editor",
        seq,
        baseRev: revBeforeEdit,
        operation: { type: "place", at: { x: 6, y: 1, z: 6 }, blockId: "stone" },
      });
      accepted = edit.body.decision.ack.accepted;
      if (!accepted) assert.equal(edit.body.decision.ack.reason, "stale_revision", "only a racing build step may reject the edit");
      else await delay(2);
    }
    assert.equal(accepted, true, "the player edit eventually lands between build steps");
    const stopped = await waitForState(address, (state) => !state.build.inProgress && state.build.lastError !== null, "stale-revision stop");
    assert.equal(stopped.build.lastError, "stale_revision");
    assert.ok(stopped.build.completedBlocks < HOUSE_PLAN_BLOCK_COUNT);
    const summary = await withTimeout(host.waitForBuildIdle(), 5000, "stale-revision stop signal");
    assert.equal(summary.lastError, "stale_revision");
    assert.equal(host.revision, revBeforeEdit + 1, "no blocks are committed after the stop");
  } finally {
    await host.stop();
  }
});

test("revoking the home grant stops the running build with grant_revoked", async () => {
  const host = new FangcunHost({ worldId: "house-revoke-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0, buildIntervalMs: 25 });
  const address = await host.start();
  try {
    await grantHome(address);
    const proposal = await proposeHouse(address);
    await decideHouse(address, proposal.proposalId, true);
    await waitForState(address, (state) => state.build.inProgress && state.build.completedBlocks >= 2, "a running build");
    assert.equal(host.revokeHomeGrant(), true);
    const revoked = await waitForState(address, (state) => !state.build.inProgress && state.build.lastError !== null, "grant-revoked stop");
    assert.equal(revoked.build.lastError, "grant_revoked");
    assert.equal(revoked.homeGrantActive, false);
  } finally {
    await host.stop();
  }
});

test("house proposals expire and a decided id cannot be reused", async () => {
  let now = Date.parse("2026-11-16T12:00:00.000Z");
  const host = new FangcunHost({ worldId: "house-expiry-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0, nowMs: () => now });
  const address = await host.start();
  try {
    await grantHome(address);
    const proposal = await proposeHouse(address);
    now += 120_001; // past the 120 s proposal TTL
    const expired = await decideHouse(address, proposal.proposalId, true);
    assert.equal(expired.status, 409);
    assert.equal(expired.body.error, "proposal_expired");
    assert.equal((await decideHouse(address, proposal.proposalId, true)).status, 404, "an expired proposal is cleared");
    assert.equal((await hostState(address)).houseProposal, null);
    // After the expiry a fresh proposal is allowed again.
    const fresh = await proposeHouse(address);
    assert.notEqual(fresh.proposalId, proposal.proposalId);
  } finally {
    await host.stop();
  }
});

test("build pacing defaults to 600 ms and honors FANGCUN_BUILD_INTERVAL_MS", async () => {
  const defaultHost = new FangcunHost({ worldId: "house-pacing-default", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
  const defaultAddress = await defaultHost.start();
  try {
    assert.equal((await hostState(defaultAddress)).build.intervalMs, 600, "the demo builds one block per 600 ms");
  } finally {
    await defaultHost.stop();
  }

  const previous = process.env.FANGCUN_BUILD_INTERVAL_MS;
  process.env.FANGCUN_BUILD_INTERVAL_MS = "0";
  let envHost: FangcunHost;
  try {
    envHost = new FangcunHost({ worldId: "house-pacing-env", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
  } finally {
    if (previous === undefined) delete process.env.FANGCUN_BUILD_INTERVAL_MS;
    else process.env.FANGCUN_BUILD_INTERVAL_MS = previous;
  }
  const envAddress = await envHost.start();
  try {
    assert.equal((await hostState(envAddress)).build.intervalMs, 0, "0 is the fast test/demo override");
  } finally {
    await envHost.stop();
  }

  process.env.FANGCUN_BUILD_INTERVAL_MS = "not-a-number";
  let fallbackHost: FangcunHost;
  try {
    fallbackHost = new FangcunHost({ worldId: "house-pacing-fallback", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 0 });
  } finally {
    if (previous === undefined) delete process.env.FANGCUN_BUILD_INTERVAL_MS;
    else process.env.FANGCUN_BUILD_INTERVAL_MS = previous;
  }
  const fallbackAddress = await fallbackHost.start();
  try {
    assert.equal((await hostState(fallbackAddress)).build.intervalMs, 600, "a malformed env value falls back to the default");
  } finally {
    await fallbackHost.stop();
  }
});

test("host shutdown drops an in-flight build queue without resuming it", async () => {
  const db = tempDb();
  const first = new FangcunHost({
    worldId: "house-shutdown-world", port: 0, ownerUserId: "owner-1", dbPath: db.path,
    autonomyIntervalMs: 0, buildIntervalMs: 30,
  });
  const address = await first.start();
  try {
    await grantHome(address);
    const proposal = await proposeHouse(address);
    await decideHouse(address, proposal.proposalId, true);
    await waitForState(address, (state) => state.build.inProgress && state.build.completedBlocks >= 2, "a running build");
  } finally {
    await first.stop();
  }
  const revAtStop = first.revision;
  assert.ok(revAtStop >= 2, "a partial build was persisted");
  const second = new FangcunHost({
    worldId: "house-shutdown-world", port: 0, ownerUserId: "owner-1", dbPath: db.path,
    autonomyIntervalMs: 0, buildIntervalMs: 0,
  });
  const secondAddress = await second.start();
  try {
    assert.equal(second.revision, revAtStop, "partial blocks survive, the queue does not resume");
    await delay(120);
    assert.equal(second.revision, revAtStop, "no build step runs after restart");
    const state = await hostState(secondAddress);
    assert.equal(state.build.inProgress, false);
    assert.equal(state.houseProposal, null);
  } finally {
    await second.stop();
    db.cleanup();
  }
});





// ------------------------------------------------------------------------------------
// Self-driven house proposal loop (autonomy asks on its own)
// ------------------------------------------------------------------------------------

type AutonomyBody = Readonly<{
  enabled: boolean;
  intervalMs: number;
  lastRunAtMs: number | null;
  autoHousePropose: boolean;
  lastHouseProposalAtMs: number | null;
  houseProposalCooldownUntilMs: number;
}>;

test("self-driven autonomy proposes a house once and broadcasts the ask", async () => {
  const host = new FangcunHost({ worldId: "autonomy-house-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40, buildIntervalMs: 0 });
  const address = await host.start();
  let socket: WebSocket | undefined;
  try {
    await grantHome(address);
    const paired = await pairTablet(host, address);
    socket = paired.socket;
    const proposalFrame = await readUntilType(paired.read, "companion_build_proposal");
    const validated = validateCompanionBuildProposalMessage(proposalFrame);
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    assert.equal(validated.value.companionId, "fish-1");
    assert.equal(validated.value.blockCount, HOUSE_PLAN_BLOCK_COUNT);
    assert.equal(validated.value.bounds.maxExclusive.x - validated.value.bounds.min.x, 3);

    const state = await waitForState(address, (current) => current.houseProposal !== null, "self-driven proposal in state");
    assert.equal(state.houseProposal!.proposalId, validated.value.proposalId);
    assert.equal(state.companionState, "awaiting_approval");
    const say = await readUntilType(paired.read, "companion_say");
    assert.match(String(say.text), /小房子/);

    const firstAutonomy = (await coreJson<AutonomyBody>(address, "/autonomy")).body;
    assert.equal(firstAutonomy.autoHousePropose, true);
    assert.equal(typeof firstAutonomy.lastHouseProposalAtMs, "number");
    assert.equal(firstAutonomy.houseProposalCooldownUntilMs, 0);

    await delay(220); // several autonomy intervals
    assert.equal((await hostState(address)).houseProposal!.proposalId, validated.value.proposalId, "no re-ask while a proposal is pending");
    const laterAutonomy = (await coreJson<AutonomyBody>(address, "/autonomy")).body;
    assert.equal(laterAutonomy.lastHouseProposalAtMs, firstAutonomy.lastHouseProposalAtMs, "only one proposal attempt was made");
  } finally {
    socket?.close();
    await host.stop();
  }
});

test("self-driven autonomy searches for a clear footprint when the origin is occupied", async () => {
  const host = new FangcunHost({ worldId: "autonomy-search-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40, buildIntervalMs: 0 });
  const address = await host.start();
  try {
    await coreJson(address, "/autonomy", { enabled: false }); // hold the timer while preparing
    const bounds = await grantHome(address);
    const blocked = await coreJson<{ decision: { ack: { accepted: boolean } } }>(address, "/intent", {
      clientId: "autonomy-blocker",
      seq: 1,
      baseRev: host.revision,
      operation: { type: "place", at: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z }, blockId: "stone" },
    });
    assert.equal(blocked.body.decision.ack.accepted, true);
    assert.equal((await coreJson(address, "/autonomy", { enabled: true })).status, 200);
    const state = await waitForState(address, (current) => current.houseProposal !== null, "self-driven proposal on the searched footprint");
    assert.deepEqual(state.houseProposal!.bounds.min, { x: bounds.min.x + 1, y: bounds.min.y, z: bounds.min.z });
    assert.equal(state.world.rev, 1, "the search itself never mutates the world");
  } finally {
    await host.stop();
  }
});

test("self-driven autonomy backs off 60 s after the owner rejects and asks again afterwards", async () => {
  let now = Date.parse("2026-11-16T12:00:00.000Z");
  const host = new FangcunHost({ worldId: "autonomy-cooldown-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40, buildIntervalMs: 0, nowMs: () => now });
  const address = await host.start();
  try {
    await grantHome(address);
    const first = await waitForState(address, (current) => current.houseProposal !== null, "first self-driven proposal");
    const rejected = await decideHouse(address, first.houseProposal!.proposalId, false);
    assert.equal(rejected.body.approved, false);
    const rejectedAt = now;
    const autonomy = (await coreJson<AutonomyBody>(address, "/autonomy")).body;
    assert.ok(autonomy.houseProposalCooldownUntilMs >= rejectedAt + 60_000, "reject cooldown is at least 60 s");
    const lastAttemptAfterReject = autonomy.lastHouseProposalAtMs;

    now = rejectedAt + 30_000;
    await delay(220); // several autonomy intervals inside the cooldown
    assert.equal((await hostState(address)).houseProposal, null, "no new ask during the reject cooldown");
    assert.equal((await coreJson<AutonomyBody>(address, "/autonomy")).body.lastHouseProposalAtMs, lastAttemptAfterReject, "no proposal attempt during the cooldown");

    now = rejectedAt + 61_000;
    const second = await waitForState(address, (current) => current.houseProposal !== null, "proposal after the cooldown");
    assert.notEqual(second.houseProposal!.proposalId, first.houseProposal!.proposalId);
  } finally {
    await host.stop();
  }
});

test("self-driven autonomy never proposes a house without a granted plot", async () => {
  const host = new FangcunHost({ worldId: "autonomy-nogrant-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40 });
  const address = await host.start();
  try {
    await delay(250);
    assert.equal((await hostState(address)).houseProposal, null);
    assert.equal((await coreJson<AutonomyBody>(address, "/autonomy")).body.lastHouseProposalAtMs, null);
  } finally {
    await host.stop();
  }
});

test("self-driven proposing is skipped during a build and waits out the post-build cooldown", async () => {
  const host = new FangcunHost({ worldId: "autonomy-build-world", port: 0, ownerUserId: "owner-1", autonomyIntervalMs: 40, buildIntervalMs: 25 });
  const address = await host.start();
  try {
    await grantHome(address);
    const proposed = await waitForState(address, (current) => current.houseProposal !== null, "self-driven proposal");
    const firstAttemptAt = (await coreJson<AutonomyBody>(address, "/autonomy")).body.lastHouseProposalAtMs;
    await decideHouse(address, proposed.houseProposal!.proposalId, true);
    const running = await waitForState(address, (current) => current.build.inProgress && current.build.completedBlocks >= 1, "a running build");
    assert.equal(running.houseProposal, null, "the approved proposal is consumed");
    const during = (await coreJson<AutonomyBody>(address, "/autonomy")).body;
    assert.equal(during.lastHouseProposalAtMs, firstAttemptAt, "no propose attempt while building");

    const done = await withTimeout(host.waitForBuildIdle(), 10000, "self-driven build completion");
    assert.equal(done.completedBlocks, HOUSE_PLAN_BLOCK_COUNT);
    assert.equal(done.seatPlaced, true);
    await delay(220); // several autonomy intervals after completion
    assert.equal((await hostState(address)).houseProposal, null, "post-build cooldown prevents an immediate re-ask");
    const after = (await coreJson<AutonomyBody>(address, "/autonomy")).body;
    assert.equal(after.lastHouseProposalAtMs, firstAttemptAt, "no new proposal attempt after the build");
    assert.ok(after.houseProposalCooldownUntilMs > 0, "the post-build cooldown was armed");
  } finally {
    await host.stop();
  }
});
