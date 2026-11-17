import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const port = 4175;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["scripts/serve-simulator.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: "ignore",
  windowsHide: true,
});

async function json(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: {
      Origin: origin,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  return { response, body: await response.json() };
}

function rawRequest(path, { method = "POST", hostHeader = `127.0.0.1:${port}`, headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${origin}${path}`, { method, headers: { Host: hostHeader, ...headers } }, (response) => {
      const body = [];
      response.on("data", (chunk) => body.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(body).toString("utf8") }));
    });
    request.on("error", reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin);
      ready = response.ok;
      if (ready) break;
    } catch {}
    await delay(100);
  }
  assert.equal(ready, true, "simulator API server starts");

  const initial = await json("/api/core/state");
  assert.equal(initial.response.status, 200);
  assert.equal(initial.body.world.rev, 0);
  assert.equal(initial.body.world.blocks.filter(Boolean).length, 196);
  assert.ok(initial.body.candidate);

  const badOrigin = await fetch(`${origin}/api/core/home/approve`, {
    method: "POST",
    headers: { Origin: "http://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ candidateId: initial.body.candidate.candidateId }),
  });
  assert.equal(badOrigin.status, 403);
  assert.equal((await json("/api/core/state")).body.world.rev, 0, "hostile origin has no mutation effect");

  const invalid = await json("/api/core/intent", { method: "POST", body: JSON.stringify({ nope: true }) });
  assert.equal(invalid.response.status, 400);
  assert.equal((await json("/api/core/state")).body.world.rev, 0, "invalid request has no mutation effect");

  const chunkedOversize = await rawRequest("/api/core/intent", {
    headers: { Origin: origin, "Content-Type": "application/json" },
    chunks: [JSON.stringify({ padding: "x".repeat(5000) }), JSON.stringify({ padding: "x".repeat(5000) })],
  });
  assert.equal(chunkedOversize.status, 413, "chunked body limit is enforced while reading");
  assert.equal((await json("/api/core/state")).body.world.rev, 0, "oversized request has no mutation effect");

  const wrongOriginMissing = await rawRequest("/api/core/intent", {
    headers: { "Content-Type": "application/json" },
    chunks: [JSON.stringify({ clientId: "bad-origin", seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" } })],
  });
  assert.equal(wrongOriginMissing.status, 403, "mutations require a same-origin browser request");

  const hostileHost = await rawRequest("/api/core/state", { method: "GET", hostHeader: "attacker.example", headers: { Origin: origin } });
  assert.equal(hostileHost.status, 400);

  const intent = await json("/api/core/intent", {
    method: "POST",
    body: JSON.stringify({ clientId: "smoke-client", seq: 1, baseRev: 0, operation: { type: "place", at: { x: 0, y: 4, z: 0 }, blockId: "planks" } }),
  });
  assert.equal(intent.response.status, 200);
  assert.equal(intent.body.decision.ack.accepted, true);
  assert.equal(intent.body.world.rev, 1);

  const staleRetry = await json("/api/core/intent", {
    method: "POST",
    body: JSON.stringify({ clientId: "smoke-client", seq: 2, baseRev: 0, operation: { type: "place", at: { x: 1, y: 4, z: 0 }, blockId: "planks" } }),
  });
  assert.equal(staleRetry.body.decision.ack.accepted, false);
  assert.equal(staleRetry.body.decision.ack.reason, "stale_revision");
  assert.equal(staleRetry.body.world.rev, 1);

  const afterRejection = await json("/api/core/intent", {
    method: "POST",
    body: JSON.stringify({ clientId: "smoke-client", seq: 3, baseRev: 1, operation: { type: "place", at: { x: 1, y: 4, z: 0 }, blockId: "planks" } }),
  });
  assert.equal(afterRejection.body.decision.ack.accepted, true, "a definitive stale ACK consumes seq 2; seq 3 remains usable");
  assert.equal(afterRejection.body.world.rev, 2);

  const candidate = (await json("/api/core/state")).body.candidate;
  const approved = await json("/api/core/home/approve", { method: "POST", body: JSON.stringify({ candidateId: candidate.candidateId }) });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.body.approved, true);

  const tick = await json("/api/core/companion/tick", { method: "POST" });
  assert.equal(tick.response.status, 200);
  assert.equal(tick.body.result.status, "committed");
  assert.equal(tick.body.result.commit.operations.length, 12);
  assert.equal(tick.body.world.rev, 3);
  console.log("Core API smoke passed: origin/host/schema guards, player intent, approval, companion commit.");
} finally {
  server.kill();
}
