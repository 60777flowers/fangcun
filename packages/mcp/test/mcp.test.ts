import test from "node:test";
import assert from "node:assert/strict";
import { BLOCK_IDS, WORLD_CELL_COUNT, WORLD_SPEC, type BlockId, type Coord } from "@fangcun/world-schema";
import {
  DEFAULT_HOST_URL,
  JSON_RPC_ERROR_CODES,
  MCP_PROTOCOL_VERSION,
  McpServer,
  TOOL_DEFINITIONS,
  resolveHostUrl,
} from "../src/index.ts";

type StubRequest = Readonly<{ url: string; method: string; body: unknown }>;
type StubReply = Readonly<{ status: number; body: unknown }>;

// Fixtures follow WorldSpec instead of hardcoding 4; terrain thickness is a world-schema knob.
const TERRAIN_TOP = WORLD_SPEC.terrainTopY;
const BUILD_Y = TERRAIN_TOP;
const BUILD_Y_HIGH = TERRAIN_TOP + 1;

/** Fetch stub: records every call so assertions can verify the exact Host traffic. */
function createStubFetch(handler: (request: StubRequest) => StubReply): { fetch: typeof fetch; requests: StubRequest[] } {
  const requests: StubRequest[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const rawBody = typeof init?.body === "string" ? init.body : undefined;
    const request: StubRequest = {
      url,
      method: init?.method ?? "GET",
      body: rawBody === undefined ? undefined : JSON.parse(rawBody),
    };
    requests.push(request);
    const reply = handler(request);
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

function createServer(stub: { fetch: typeof fetch }): McpServer {
  return new McpServer({ hostUrl: "http://127.0.0.1:8765", fetch: stub.fetch });
}

async function rpc(server: McpServer, message: unknown): Promise<Record<string, unknown>> {
  const line = await server.handleLine(JSON.stringify(message));
  assert.ok(line !== null, "expected a JSON-RPC response line");
  return JSON.parse(line) as Record<string, unknown>;
}

async function callToolRpc(server: McpServer, name: string, args?: unknown): Promise<Record<string, unknown>> {
  return rpc(server, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, ...(args === undefined ? {} : { arguments: args }) } });
}

function toolText(response: Record<string, unknown>): string {
  const result = response.result as { content?: Array<{ type?: string; text?: string }> } | undefined;
  const first = result?.content?.[0];
  assert.equal(first?.type, "text", "tool results must contain a text content block");
  assert.equal(typeof first?.text, "string");
  return first!.text!;
}

function toolJson(response: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(toolText(response)) as Record<string, unknown>;
}

function toolErrorText(response: Record<string, unknown>): string {
  const result = response.result as { isError?: boolean } | undefined;
  assert.equal(result?.isError, true, "domain failures must be isError tool results");
  return toolText(response);
}

function rpcError(response: Record<string, unknown>): { code: number; message: string } {
  assert.ok(response.error, "expected a JSON-RPC error");
  return response.error as { code: number; message: string };
}

function indexOf(x: number, y: number, z: number): number {
  const { origin, size } = WORLD_SPEC;
  return ((y - origin.y) * size.z + (z - origin.z)) * size.x + (x - origin.x);
}

function buildBlocks(entries: readonly Readonly<{ at: Coord; blockId: BlockId }>[]): Array<BlockId | null> {
  const blocks = Array<BlockId | null>(WORLD_CELL_COUNT).fill(null);
  for (const entry of entries) blocks[indexOf(entry.at.x, entry.at.y, entry.at.z)] = entry.blockId;
  return blocks;
}

function stateBody(options: {
  rev?: number;
  entries?: readonly Readonly<{ at: Coord; blockId: BlockId }>[];
  candidate?: unknown;
  homeGrantActive?: boolean;
} = {}): Record<string, unknown> {
  return {
    world: { schemaVersion: 1, worldId: "fangcun-local", rev: options.rev ?? 0, blocks: buildBlocks(options.entries ?? []) },
    ownerUserId: "local-user",
    companion: { schemaVersion: 1, companionId: "fish-1", state: "idle" },
    ...(options.candidate === undefined ? {} : { candidate: options.candidate }),
    homeGrantActive: options.homeGrantActive ?? false,
  };
}

function intentAccepted(rev: number): StubReply {
  return { status: 200, body: { decision: { ack: { accepted: true, committedRev: rev } }, world: {} } };
}

test("tools/list exposes exactly the seven v0 tools with strict, bounded schemas", async () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), [
    "world_observe", "home_candidates", "home_claim", "build_tick", "place_block", "break_block", "companion_say",
  ]);
  for (const tool of TOOL_DEFINITIONS) {
    assert.equal(tool.inputSchema.type, "object", `${tool.name} input must be an object`);
    assert.equal(tool.inputSchema.additionalProperties, false, `${tool.name} must reject unknown arguments`);
    const sentences = tool.description.split(/(?<=\.)\s+/).filter((sentence) => sentence.length > 0);
    assert.ok(sentences.length >= 1 && sentences.length <= 3, `${tool.name} description must be 1-3 sentences, got ${sentences.length}`);
  }

  const place = TOOL_DEFINITIONS.find((tool) => tool.name === "place_block");
  assert.ok(place);
  const properties = place.inputSchema.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.x, { type: "integer", minimum: -8, maximum: 7, description: "World cell x." });
  assert.deepEqual(properties.y, { type: "integer", minimum: 0, maximum: 15, description: "World cell y; values below terrainTopY are protected terrain." });
  assert.deepEqual(properties.z, { type: "integer", minimum: -8, maximum: 7, description: "World cell z." });
  assert.deepEqual(properties.blockId?.enum, [...BLOCK_IDS]);
  assert.deepEqual(place.inputSchema.required, ["x", "y", "z", "blockId"]);

  const breakTool = TOOL_DEFINITIONS.find((tool) => tool.name === "break_block");
  assert.ok(breakTool);
  assert.deepEqual(breakTool.inputSchema.required, ["x", "y", "z"]);

  const say = TOOL_DEFINITIONS.find((tool) => tool.name === "companion_say");
  assert.ok(say);
  const sayText = (say.inputSchema.properties as Record<string, Record<string, unknown>>).text;
  assert.equal(sayText?.maxLength, 80);
  assert.equal(sayText?.minLength, 1);

  for (const name of ["world_observe", "home_candidates", "build_tick"]) {
    const tool = TOOL_DEFINITIONS.find((entry) => entry.name === name);
    assert.ok(tool);
    assert.deepEqual(tool.inputSchema.properties, {}, `${name} takes no arguments`);
    assert.equal(Object.hasOwn(tool.inputSchema, "required"), false, `${name} has no required arguments`);
  }
});

test("every catalog block id round-trips through place_block", async () => {
  let rev = 0;
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/state")) return { status: 200, body: stateBody({ rev }) };
    if (request.url.endsWith("/api/core/intent")) {
      rev += 1;
      return intentAccepted(rev);
    }
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);
  // Derived from BLOCK_IDS so a catalog addition is covered without a new case here.
  for (const blockId of BLOCK_IDS) {
    const response = await callToolRpc(server, "place_block", { x: 0, y: BUILD_Y, z: 0, blockId });
    assert.deepEqual(toolJson(response).placed, blockId, `place_block rejected catalog block ${blockId}`);
  }
  assert.equal(stub.requests.filter((request) => request.url.endsWith("/api/core/intent")).length, BLOCK_IDS.length);
});

test("initialize, notifications/initialized, ping and unknown methods follow JSON-RPC framing", async () => {
  const stub = createStubFetch(() => ({ status: 500, body: { error: "unused" } }));
  const server = createServer(stub);

  const initialize = await rpc(server, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-client", version: "0.0.1" } },
  });
  assert.ok(initialize);
  assert.equal(initialize.jsonrpc, "2.0");
  assert.equal(initialize.id, 1);
  const result = initialize.result as Record<string, unknown>;
  assert.equal(result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(Object.keys(result.capabilities as object), ["tools"], "only the tools capability may be advertised");
  assert.equal((result.serverInfo as Record<string, unknown>).name, "fangcun-mcp");
  assert.equal(stub.requests.length, 0, "initialize must not touch the Host");

  assert.equal(await server.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })), null);

  const ping = await rpc(server, { jsonrpc: "2.0", id: "ping-1", method: "ping" });
  assert.deepEqual(ping, { jsonrpc: "2.0", id: "ping-1", result: {} });

  const unknown = await rpc(server, { jsonrpc: "2.0", id: 2, method: "resources/list" });
  assert.equal(rpcError(unknown).code, JSON_RPC_ERROR_CODES.methodNotFound);
  assert.match(rpcError(unknown).message, /Method not found: resources\/list/);

  const unknownNotification = await server.handleLine(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled" }));
  assert.equal(unknownNotification, null, "unknown notifications must not produce a response");
  assert.equal(await server.handleLine("   "), null, "blank framing lines are ignored");
});

test("tools/list is served over the JSON-RPC framing with the same public definitions", async () => {
  const stub = createStubFetch(() => ({ status: 500, body: { error: "unused" } }));
  const server = createServer(stub);
  const response = await rpc(server, { jsonrpc: "2.0", id: 7, method: "tools/list" });
  assert.ok(response);
  assert.equal(response.id, 7);
  const tools = (response.result as Record<string, unknown>).tools;
  assert.ok(Array.isArray(tools));
  assert.deepEqual(tools.map((tool: { name: string }) => tool.name), TOOL_DEFINITIONS.map((tool) => tool.name));
});

test("parse errors, invalid requests and invalid tools/call params use JSON-RPC error codes", async () => {
  const stub = createStubFetch(() => ({ status: 500, body: { error: "unused" } }));
  const server = createServer(stub);

  const parseError = JSON.parse((await server.handleLine("{ not json"))!) as Record<string, unknown>;
  assert.equal(parseError.id, null);
  assert.equal(rpcError(parseError).code, JSON_RPC_ERROR_CODES.parseError);

  const invalidRequest = await rpc(server, { jsonrpc: "2.0", id: 3 });
  assert.equal(rpcError(invalidRequest).code, JSON_RPC_ERROR_CODES.invalidRequest);

  const missingName = await rpc(server, { jsonrpc: "2.0", id: 4, method: "tools/call", params: {} });
  assert.equal(rpcError(missingName).code, JSON_RPC_ERROR_CODES.invalidParams);

  const badArguments = await rpc(server, { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "world_observe", arguments: [] } });
  assert.equal(rpcError(badArguments).code, JSON_RPC_ERROR_CODES.invalidParams);

  const unknownTool = await callToolRpc(server, "lava_tool");
  assert.match(toolErrorText(unknownTool), /Unknown tool: lava_tool/);
  assert.equal(stub.requests.length, 0);
});

test("world_observe summarizes revision, blocks above terrain, grant and candidate", async () => {
  const candidate = {
    candidateId: "candidate:abc12345",
    worldId: "fangcun-local",
    observedRev: 0,
    origin: { x: -4, y: BUILD_Y, z: -4 },
    bounds: { min: { x: -4, y: BUILD_Y, z: -4 }, maxExclusive: { x: 0, y: BUILD_Y + 4, z: 0 } },
    score: 1.5,
    reason: "clear-supported-and-near-center",
  };
  const terrainEntry = TERRAIN_TOP > 0
    ? [{ at: { x: 0, y: TERRAIN_TOP - 1, z: 0 }, blockId: "stone" as const }]
    : [];
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/state")) {
      return {
        status: 200,
        body: stateBody({
          rev: 6,
          homeGrantActive: true,
          candidate,
          entries: [
            ...terrainEntry,
            { at: { x: 1, y: BUILD_Y, z: 1 }, blockId: "planks" },
            { at: { x: 2, y: BUILD_Y_HIGH, z: 1 }, blockId: "glass" },
          ],
        }),
      };
    }
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);
  const response = await callToolRpc(server, "world_observe");
  const payload = toolJson(response);

  assert.deepEqual(payload, {
    worldId: "fangcun-local",
    rev: 6,
    blockCount: terrainEntry.length + 2,
    terrainTopY: TERRAIN_TOP,
    blocksAboveTerrain: [
      { x: 1, y: BUILD_Y, z: 1, blockId: "planks" },
      { x: 2, y: BUILD_Y_HIGH, z: 1, blockId: "glass" },
    ],
    blocksAboveTerrainTruncated: false,
    homeGrantActive: true,
    candidateId: "candidate:abc12345",
  });
  assert.equal(stub.requests.length, 1);
  assert.equal(stub.requests[0]?.method, "GET");
  assert.match(stub.requests[0]!.url, /\/api\/core\/state$/);
});

test("place_block reads a fresh baseRev and keeps an in-process monotonic intent sequence", async () => {
  let rev = 7;
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/state")) return { status: 200, body: stateBody({ rev }) };
    if (request.url.endsWith("/api/core/intent")) {
      rev += 1;
      return intentAccepted(rev);
    }
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);

  const first = await callToolRpc(server, "place_block", { x: 1, y: BUILD_Y, z: 1, blockId: "planks" });
  assert.deepEqual(toolJson(first), { accepted: true, placed: "planks", at: { x: 1, y: BUILD_Y, z: 1 }, rev: 8 });

  const second = await callToolRpc(server, "place_block", { x: -2, y: BUILD_Y_HIGH, z: 3, blockId: "glass" });
  assert.deepEqual(toolJson(second), { accepted: true, placed: "glass", at: { x: -2, y: BUILD_Y_HIGH, z: 3 }, rev: 9 });

  const intents = stub.requests.filter((request) => request.url.endsWith("/api/core/intent"));
  assert.equal(intents.length, 2);
  assert.deepEqual(intents[0]?.body, {
    clientId: "mcp-agent",
    seq: 1,
    baseRev: 7,
    operation: { type: "place", at: { x: 1, y: BUILD_Y, z: 1 }, blockId: "planks" },
  });
  assert.deepEqual(intents[1]?.body, {
    clientId: "mcp-agent",
    seq: 2,
    baseRev: 8,
    operation: { type: "place", at: { x: -2, y: BUILD_Y_HIGH, z: 3 }, blockId: "glass" },
  });
});

test("place_block surfaces a Host rejection as an isError tool result", async () => {
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/state")) return { status: 200, body: stateBody({ rev: 2 }) };
    if (request.url.endsWith("/api/core/intent")) {
      return { status: 200, body: { decision: { ack: { accepted: false, reason: "occupied", committedRev: 2 } }, world: {} } };
    }
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);
  const response = await callToolRpc(server, "place_block", { x: 1, y: BUILD_Y, z: 1, blockId: "planks" });
  assert.match(toolErrorText(response), /Host rejected place_block: occupied/);
});

test("break_block reads expectedBlock from state and refuses empty or protected cells", async () => {
  const terrainEntry = TERRAIN_TOP > 0
    ? [{ at: { x: 0, y: TERRAIN_TOP - 1, z: 0 }, blockId: "dirt" as const }]
    : [];
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/state")) {
      return {
        status: 200,
        body: stateBody({
          rev: 3,
          entries: [
            ...terrainEntry,
            { at: { x: 1, y: BUILD_Y, z: 1 }, blockId: "planks" },
          ],
        }),
      };
    }
    if (request.url.endsWith("/api/core/intent")) return intentAccepted(4);
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);

  const broken = await callToolRpc(server, "break_block", { x: 1, y: BUILD_Y, z: 1 });
  assert.deepEqual(toolJson(broken), { accepted: true, broke: "planks", at: { x: 1, y: BUILD_Y, z: 1 }, rev: 4 });
  const intents = stub.requests.filter((request) => request.url.endsWith("/api/core/intent"));
  assert.equal(intents.length, 1);
  assert.deepEqual(intents[0]?.body, {
    clientId: "mcp-agent",
    seq: 1,
    baseRev: 3,
    operation: { type: "break", at: { x: 1, y: BUILD_Y, z: 1 }, expectedBlock: "planks" },
  });

  const empty = await callToolRpc(server, "break_block", { x: 5, y: BUILD_Y, z: 5 });
  assert.match(toolErrorText(empty), new RegExp(`No block at \\(5, ${BUILD_Y}, 5\\)`));

  if (TERRAIN_TOP > 0) {
    const terrain = await callToolRpc(server, "break_block", { x: 0, y: TERRAIN_TOP - 1, z: 0 });
    assert.match(toolErrorText(terrain), /terrain layer is protected/);
  }
  assert.equal(stub.requests.filter((request) => request.url.endsWith("/api/core/intent")).length, 1, "rejected breaks must not send intents");
});

test("coordinate and block-id validation rejects bad input before any Host call", async () => {
  const stub = createStubFetch(() => ({ status: 200, body: stateBody() }));
  const server = createServer(stub);
  const terrainCase: Array<{ args: unknown; message: RegExp }> = TERRAIN_TOP > 0
    ? [{ args: { x: 0, y: TERRAIN_TOP - 1, z: 0, blockId: "planks" }, message: /terrain layer is protected/ }]
    : [];
  const cases: Array<{ args: unknown; message: RegExp }> = [
    { args: { x: 8, y: BUILD_Y, z: 0, blockId: "planks" }, message: /x must be between -8 and 7/ },
    { args: { x: -9, y: BUILD_Y, z: 0, blockId: "planks" }, message: /x must be between -8 and 7/ },
    { args: { x: 0, y: BUILD_Y, z: 8, blockId: "planks" }, message: /z must be between -8 and 7/ },
    { args: { x: 0, y: 16, z: 0, blockId: "planks" }, message: /y must be between 0 and 15/ },
    { args: { x: 0, y: -1, z: 0, blockId: "planks" }, message: /y must be between 0 and 15/ },
    { args: { x: 1.5, y: BUILD_Y, z: 0, blockId: "planks" }, message: /x must be an integer/ },
    { args: { x: 0, y: BUILD_Y, z: 0, blockId: "lava" }, message: /blockId must be one of: grass, dirt/ },
    { args: { x: 0, y: BUILD_Y, z: 0, blockId: "planks", extra: true }, message: /Unexpected argument: extra/ },
    ...terrainCase,
    { args: { x: 0, y: BUILD_Y }, message: /Missing required argument: z/ },
  ];
  for (const testCase of cases) {
    const response = await callToolRpc(server, "place_block", testCase.args);
    assert.match(toolErrorText(response), testCase.message, `expected rejection for ${JSON.stringify(testCase.args)}`);
  }

  const breakOutOfBounds = await callToolRpc(server, "break_block", { x: 0, y: BUILD_Y, z: 8 });
  assert.match(toolErrorText(breakOutOfBounds), /z must be between -8 and 7/);

  const observeWithArgument = await callToolRpc(server, "world_observe", { radius: 4 });
  assert.match(toolErrorText(observeWithArgument), /Unexpected argument: radius/);

  const missingClaim = await callToolRpc(server, "home_claim", {});
  assert.match(toolErrorText(missingClaim), /Missing required argument: candidateId/);

  const longSay = await callToolRpc(server, "companion_say", { text: "x".repeat(81) });
  assert.match(toolErrorText(longSay), /text must be 1-80 characters/);

  const multilineSay = await callToolRpc(server, "companion_say", { text: "hello\nworld" });
  assert.match(toolErrorText(multilineSay), /without control characters/);

  const blankSay = await callToolRpc(server, "companion_say", { text: "   " });
  assert.match(toolErrorText(blankSay), /text must not be blank/);

  assert.equal(stub.requests.length, 0, "invalid input must not reach the Host");
});

test("coordinate bounds are half-open: x/z -8 and y 15 are accepted", async () => {
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/state")) return { status: 200, body: stateBody({ rev: 0 }) };
    if (request.url.endsWith("/api/core/intent")) return intentAccepted(1);
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);
  const response = await callToolRpc(server, "place_block", { x: -8, y: 15, z: 7, blockId: "stone" });
  assert.deepEqual(toolJson(response), { accepted: true, placed: "stone", at: { x: -8, y: 15, z: 7 }, rev: 1 });
});

test("home_candidates lists the pending candidate and home_claim approves it", async () => {
  const candidate = {
    candidateId: "candidate:deadbeef",
    bounds: { min: { x: -4, y: BUILD_Y, z: -4 }, maxExclusive: { x: 0, y: BUILD_Y + 4, z: 0 } },
    score: 2,
  };
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/state")) return { status: 200, body: stateBody({ rev: 1, candidate }) };
    if (request.url.endsWith("/api/core/home/approve")) return { status: 200, body: { approved: true, world: { rev: 2 } } };
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);

  const listed = await callToolRpc(server, "home_candidates");
  assert.deepEqual(toolJson(listed), { candidates: [candidate] });

  const claimed = await callToolRpc(server, "home_claim", { candidateId: "candidate:deadbeef" });
  assert.deepEqual(toolJson(claimed), { approved: true, rev: 2 });
  const approvals = stub.requests.filter((request) => request.url.endsWith("/api/core/home/approve"));
  assert.deepEqual(approvals[0]?.body, { candidateId: "candidate:deadbeef" });
});

test("home_candidates is empty without a pending candidate and home_claim reports a Host rejection", async () => {
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/state")) return { status: 200, body: stateBody({ rev: 1 }) };
    if (request.url.endsWith("/api/core/home/approve")) {
      return { status: 409, body: { approved: false, error: "candidate_stale", world: { rev: 1 } } };
    }
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);

  const listed = await callToolRpc(server, "home_candidates");
  assert.deepEqual(toolJson(listed), { candidates: [] });

  const claimed = await callToolRpc(server, "home_claim", { candidateId: "candidate:stale" });
  assert.match(toolErrorText(claimed), /Home candidate was not approved/);
});

test("build_tick reports status, committed operation count and revision", async () => {
  let tickCount = 0;
  const stub = createStubFetch((request) => {
    if (!request.url.endsWith("/api/core/companion/tick")) return { status: 404, body: { error: "not_found" } };
    tickCount += 1;
    return tickCount === 1
      ? { status: 200, body: { result: { status: "committed", commit: { operations: [{}, {}, {}] } }, world: { rev: 10 } } }
      : { status: 200, body: { result: { status: "home_approval_required", candidate: { candidateId: "candidate:x" } }, world: { rev: 10 } } };
  });
  const server = createServer(stub);

  const committed = await callToolRpc(server, "build_tick");
  assert.deepEqual(toolJson(committed), { status: "committed", committedOperations: 3, rev: 10 });

  const proposed = await callToolRpc(server, "build_tick");
  assert.deepEqual(toolJson(proposed), { status: "home_approval_required", committedOperations: 0, rev: 10 });
  assert.equal(stub.requests[0]?.method, "POST");
});

test("companion_say posts the line and reports a missing Host endpoint as isError", async () => {
  const stub = createStubFetch((request) => {
    if (request.url.endsWith("/api/core/companion/say")) return { status: 200, body: { ok: true } };
    return { status: 404, body: { error: "not_found" } };
  });
  const server = createServer(stub);
  const said = await callToolRpc(server, "companion_say", { text: "这块地归我啦！" });
  assert.deepEqual(toolJson(said), { said: "这块地归我啦！" });
  assert.deepEqual(stub.requests[0]?.body, { text: "这块地归我啦！" });

  const missingEndpoint = createServer(createStubFetch(() => ({ status: 404, body: { error: "not_found" } })));
  const failed = await callToolRpc(missingEndpoint, "companion_say", { text: "hello" });
  assert.match(toolErrorText(failed), /companion_say failed with HTTP 404/);
});

test("Host failures become short isError results instead of crashes", async () => {
  const unreachable = createServer({ fetch: (async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:8765"); }) as unknown as typeof fetch });
  const unreachableResult = await callToolRpc(unreachable, "world_observe");
  assert.match(toolErrorText(unreachableResult), /Cannot reach the Fangcun Host at http:\/\/127\.0\.0\.1:8765/);

  const failingHost = createServer(createStubFetch(() => ({ status: 500, body: { error: "internal" } })));
  const failure = await callToolRpc(failingHost, "world_observe");
  assert.match(toolErrorText(failure), /Host state request failed with HTTP 500/);

  const invalidState = createServer(createStubFetch(() => ({ status: 200, body: { world: { worldId: "w", rev: 0, blocks: [] } } })));
  const invalid = await callToolRpc(invalidState, "world_observe");
  assert.match(toolErrorText(invalid), /invalid world snapshot/);
});

test("resolveHostUrl defaults to loopback and rejects unusable values", () => {
  const previous = process.env.FANGCUN_HOST;
  try {
    delete process.env.FANGCUN_HOST;
    assert.equal(resolveHostUrl(), DEFAULT_HOST_URL);
    process.env.FANGCUN_HOST = "http://127.0.0.1:9999/";
    assert.equal(resolveHostUrl(), "http://127.0.0.1:9999");
    assert.equal(resolveHostUrl("http://127.0.0.1:8765/base/"), "http://127.0.0.1:8765/base");
    assert.throws(() => resolveHostUrl("ftp://127.0.0.1"), /must use http or https/);
    assert.throws(() => resolveHostUrl("not a url"), /not a valid URL/);
  } finally {
    if (previous === undefined) delete process.env.FANGCUN_HOST;
    else process.env.FANGCUN_HOST = previous;
  }
});
