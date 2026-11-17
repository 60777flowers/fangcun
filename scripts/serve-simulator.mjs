import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateClientIntent } from "@fangcun/protocol";
import { createSeedWorld } from "@fangcun/voxel-core";
import { findHomeCandidates } from "@fangcun/companion-runtime";
import { WorldAuthority } from "@fangcun/worldd";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rootReal = await realpath(root);
const port = Number(process.env.PORT ?? 4173);
const host = "127.0.0.1";
const allowedPaths = new Set([
  "/apps/simulator/index.html",
  "/apps/simulator/app.js",
  "/apps/simulator/styles.css",
  "/packages/protocol/dist/index.js",
  "/packages/voxel-core/dist/index.js",
  "/packages/world-schema/dist/index.js",
  "/packages/companion-schema/dist/index.js",
  "/packages/companion-runtime/dist/index.js",
  "/packages/worldd/dist/index.js",
]);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new TypeError("PORT must be an integer from 1 to 65535");
}

const coreOwner = "simulator-owner";
const coreWorldId = "shared-core-demo";
const coreCompanion = Object.freeze({
  schemaVersion: 1,
  companionId: "simulator-fish",
  ownerUserId: coreOwner,
  worldId: coreWorldId,
  personaId: "playful-fish",
  state: "idle",
  autonomyEnabled: true,
  createdAt: "2026-11-16T12:00:00.000Z",
});
const coreAuthority = new WorldAuthority({
  initialWorld: createSeedWorld(coreWorldId),
  ownerUserId: coreOwner,
  homeGrantIssuerUserIds: [coreOwner],
});
if (!coreAuthority.registerCompanion(coreCompanion)) throw new Error("Failed to initialize demo companion");
const coreActor = Object.freeze({ authenticatedOwnerUserId: coreOwner });
const coreClientSeq = new Map();
const MAX_API_BODY_BYTES = 8 * 1024;
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { ...jsonHeaders, "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

let coreHomeApproved = false;

function currentCoreCandidate() {
  return findHomeCandidates(coreAuthority.snapshot)[0];
}

function validateCoreHost(request, response, requireOrigin) {
  if (request.headers.host !== `${host}:${port}`) {
    sendJson(response, 400, { error: "host_rejected" });
    return false;
  }
  const origin = request.headers.origin;
  if (requireOrigin && origin !== `http://${host}:${port}`) {
    sendJson(response, 403, { error: "origin_rejected" });
    return false;
  }
  if (request.headers["sec-fetch-site"] === "cross-site") {
    sendJson(response, 403, { error: "origin_rejected" });
    return false;
  }
  return true;
}

async function readJsonBody(request) {
  const contentType = request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return { ok: false, status: 415, error: "content_type_required" };
  const declared = request.headers["content-length"];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > MAX_API_BODY_BYTES)) {
    request.resume();
    return { ok: false, status: 413, error: "payload_too_large" };
  }
  const chunks = [];
  let bytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_API_BODY_BYTES) tooLarge = true;
    else if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) return { ok: false, status: 413, error: "payload_too_large" };
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, status: 400, error: "invalid_json_shape" };
    return { ok: true, value };
  } catch {
    return { ok: false, status: 400, error: "invalid_json" };
  }
}

async function handleCoreApi(request, response, url) {
  if (!validateCoreHost(request, response, request.method !== "GET" && request.method !== "HEAD")) return;
  const knownPath = url.pathname === "/api/core/state" || url.pathname === "/api/core/intent"
    || url.pathname === "/api/core/companion/tick" || url.pathname === "/api/core/home/approve";
  if (!knownPath) return sendJson(response, 404, { error: "not_found" });
  if (request.method === "GET" && url.pathname === "/api/core/state") {
    const grantActive = coreHomeApproved;
    const candidate = grantActive ? undefined : currentCoreCandidate();
    return sendJson(response, 200, {
      world: coreAuthority.snapshot,
      ownerUserId: coreOwner,
      companion: coreCompanion,
      candidate,
      homeGrantActive: grantActive,
    });
  }
  if (url.pathname !== "/api/core/intent" && url.pathname !== "/api/core/companion/tick" && url.pathname !== "/api/core/home/approve") {
    return sendJson(response, 404, { error: "not_found" });
  }
  if (request.method !== "POST") return sendJson(response, 405, { error: "method_not_allowed" });
  const isDemoTick = url.pathname === "/api/core/companion/tick";
  const body = isDemoTick ? { ok: true, value: {} } : await readJsonBody(request);
  if (!body.ok) return sendJson(response, body.status, { error: body.error });

  if (url.pathname === "/api/core/intent") {
    const input = body.value;
    if (Object.keys(input).sort().join(",") !== "baseRev,clientId,operation,seq") return sendJson(response, 400, { error: "invalid_intent_shape" });
    const intent = validateClientIntent({
      protocolVersion: 1,
      type: "intent",
      worldId: coreWorldId,
      clientId: input.clientId,
      seq: input.seq,
      baseRev: input.baseRev,
      operation: input.operation,
    });
    if (!intent.ok) return sendJson(response, 400, { error: intent.error });
    const nextSeq = (coreClientSeq.get(input.clientId) ?? 0) + 1;
    if (input.seq > nextSeq) return sendJson(response, 409, { error: "sequence_gap" });
    const decision = coreAuthority.handleIntent(intent.value);
    if (decision.ack.reason !== "sequence_gap" && decision.ack.reason !== "sequence_reuse_with_different_payload") coreClientSeq.set(input.clientId, input.seq);
    return sendJson(response, 200, { decision, world: coreAuthority.snapshot });
  }

  if (url.pathname === "/api/core/companion/tick") {
    if (Object.keys(body.value).length !== 0) return sendJson(response, 400, { error: "invalid_tick" });
    // Demo-only simulated tracking readiness. Production must bind this to a fresh authenticated device lease.
    const result = await coreAuthority.runCompanionTick(coreActor, { trackingReady: true });
    if (result.status === "committed") coreHomeApproved = true;
    return sendJson(response, 200, { result, world: coreAuthority.snapshot });
  }

  if (url.pathname === "/api/core/home/approve") {
    if (Object.keys(body.value).sort().join(",") !== "candidateId" || typeof body.value.candidateId !== "string") return sendJson(response, 400, { error: "invalid_home_approval" });
    const candidate = currentCoreCandidate();
    if (!candidate || candidate.candidateId !== body.value.candidateId) return sendJson(response, 409, { error: "candidate_stale" });
    const now = new Date();
    const grant = Object.freeze({
      schemaVersion: 1,
      grantId: "simulator-home-grant-1",
      grantRev: 1,
      plotId: "simulator-home-1",
      worldId: coreWorldId,
      ownerUserId: coreOwner,
      approvedByUserId: coreOwner,
      companionId: coreCompanion.companionId,
      bounds: candidate.bounds,
      allowedBlockIds: Object.freeze(["planks", "glass"]),
      maxBlocksPerPlan: 32,
      maxBlocksPerDay: 128,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const approved = coreAuthority.approveHomePlot(grant, candidate, coreActor);
    if (approved) coreHomeApproved = true;
    return sendJson(response, approved ? 200 : 409, { approved, world: coreAuthority.snapshot });
  }
}

const HOST_ORIGIN = process.env.FANGCUN_HOST_ORIGIN ?? "http://127.0.0.1:8765";

/**
 * Forwards the PC inspector's core API calls to the durable Host so the browser preview
 * and the AR device edit the same authoritative world. Same-origin checks still run here;
 * the Host core API is loopback-only by socket binding.
 */
async function proxyToHost(request, response, url) {
  if (!validateCoreHost(request, response, request.method === "POST")) return;
  const rest = url.pathname.slice("/api/host/".length);
  const target = `${HOST_ORIGIN}/api/core/${rest}${url.search}`;
  const init = { method: request.method, headers: {} };
  if (request.method === "POST") {
    const body = await readJsonBody(request);
    if (!body.ok) return sendJson(response, body.status, { error: body.error });
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body.value);
  }
  const upstream = await fetch(target, init);
  const text = await upstream.text();
  response.writeHead(upstream.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(text),
    "Cache-Control": "no-store",
  });
  response.end(text);
}

const server = createServer(async (request, response) => {
  let apiUrl;
  try {
    apiUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }
  if (apiUrl.pathname.startsWith("/api/host/")) {
    try {
      await proxyToHost(request, response, apiUrl);
    } catch {
      if (!response.headersSent) sendJson(response, 502, { error: "host_unreachable" });
      else response.destroy();
    }
    return;
  }
  if (apiUrl.pathname.startsWith("/api/core/")) {
    try {
      await handleCoreApi(request, response, apiUrl);
    } catch {
      if (!response.headersSent) sendJson(response, 500, { error: "internal_error" });
      else response.destroy();
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }

  let pathname;
  let requestUrl;
  try {
    requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname.includes("\\") || pathname.includes("\0")) {
    response.writeHead(400).end("Bad request");
    return;
  }

  const routePath = pathname === "/" ? "/apps/simulator/index.html" : pathname;
  if (!allowedPaths.has(routePath)) {
    response.writeHead(404).end("Not found");
    return;
  }
  const filePath = resolve(rootReal, routePath.slice(1));
  if (filePath !== rootReal && !filePath.startsWith(`${rootReal}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const fileReal = await realpath(filePath);
    if (fileReal !== rootReal && !fileReal.startsWith(`${rootReal}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const fileStat = await stat(fileReal);
    if (!fileStat.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(fileReal).toLowerCase()) ?? "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(fileReal).on("error", () => response.destroy()).pipe(response);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Voxel sandbox: http://${host}:${port}/`);
  console.log("Press Ctrl+C to stop.");
});
