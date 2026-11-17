import { BLOCK_DEFS, WORLD_SPEC } from "@fangcun/world-schema";
import { applyTransaction, assertWorldState, countBlocks, createSeedWorld, getBlock, worldStateFromObject } from "@fangcun/voxel-core";

const QUERY_MODE = new URLSearchParams(window.location.search).get("mode");
// `core` drives the simulator's own in-memory demo API; `host` drives the durable Host
// through a loopback proxy, so the PC inspector and the tablet share one world.
const HOST_MODE = QUERY_MODE === "host";
const CORE_MODE = QUERY_MODE === "core" || HOST_MODE;
const API_BASE = HOST_MODE ? "/api/host" : "/api/core";

// Isometric face palette: `top` is the lit face, `x` the right face, `z` the left.
// Every catalog block needs an entry so a snapshot with any valid block id renders.
const COLORS = {
  grass: { top: "#819f62", x: "#60794a", z: "#6f8954" },
  dirt: { top: "#8a6444", x: "#644730", z: "#765338" },
  stone: { top: "#9aa39a", x: "#727c74", z: "#838d85" },
  planks: { top: "#bd895b", x: "#875b3d", z: "#a37149" },
  log: { top: "#a9835a", x: "#6d4f35", z: "#8a6543" },
  glass: { top: "#a6ded2", x: "#5d9993", z: "#7cb8ae" },
  leaves: { top: "#91ad5d", x: "#53794a", z: "#6d914c" },
  sand: { top: "#e4d6a8", x: "#b3a276", z: "#cdbd8d" },
  // Decorative set: warm masonry, cool roof tile, two wools, wood/metal accents
  // and a bright pumpkin/flower so builds read apart at iso scale.
  brick: { top: "#b2624a", x: "#7a3f32", z: "#964d3c" },
  tile: { top: "#8ea6b5", x: "#57707e", z: "#6f8898" },
  wool_white: { top: "#ece9e0", x: "#b6b1a4", z: "#d3cec0" },
  wool_red: { top: "#c4554e", x: "#8c3733", z: "#a84743" },
  bookshelf: { top: "#a07a4f", x: "#62432c", z: "#82593a" },
  lantern: { top: "#f2c96b", x: "#9a6a2b", z: "#c2913f" },
  pumpkin: { top: "#e08b3c", x: "#a45a24", z: "#c4722e" },
  flower: { top: "#e3a4b6", x: "#5d7f46", z: "#7d9c5c" },
};
const BUILD_MIN_Y = WORLD_SPEC.terrainTopY;
const BUILD_MAX_Y = WORLD_SPEC.size.y - 1;
const canvas = document.querySelector("#world-canvas");
const ctx = canvas.getContext("2d");
const grid = document.querySelector("#tile-grid");
const placeButton = document.querySelector("#place-button");
const breakButton = document.querySelector("#break-button");
const materialButtons = [...document.querySelectorAll(".material-option")];
// The picker buttons are the curated build palette; derive the id list from them so
// the keyboard shortcuts and the buttons cannot drift apart, and fail loudly if a
// button names an id the catalog does not have.
const MATERIALS = materialButtons.map((button) => button.dataset.material);
for (const material of MATERIALS) {
  if (!BLOCK_DEFS[material]) throw new Error(`Material picker offers an unknown block id: ${material}`);
}
const modeButtons = [...document.querySelectorAll(".mode-button")];
const proposalPanel = document.querySelector("#proposal-panel");
const toast = document.querySelector("#toast");
const status = document.querySelector("#canvas-status");
const localModeButton = document.querySelector("#local-mode");
const sharedModeButton = document.querySelector("#shared-mode");
const runtimeCaption = document.querySelector("#runtime-caption");
const sharedStatus = document.querySelector("#shared-status");
const coreStateLabel = document.querySelector("#core-state");
const coreOwnerLabel = document.querySelector("#core-owner");
const companionStateLabel = document.querySelector("#companion-state");
const runtimeError = document.querySelector("#runtime-error");
const retryCoreButton = document.querySelector("#retry-core");
const demoDisclaimer = document.querySelector("#demo-disclaimer");
const companionSection = document.querySelector("#companion-section");
const companionMessage = document.querySelector("#companion-message");
const candidatePanel = document.querySelector("#candidate-panel");
const candidateSelect = document.querySelector("#candidate-select");
const candidateDescription = document.querySelector("#candidate-description");
const candidateCount = document.querySelector("#candidate-count");
const approveCandidateButton = document.querySelector("#approve-candidate");
const buildTickButton = document.querySelector("#build-tick");
const statsNote = document.querySelector(".stats-note");
const sceneWorldMode = document.querySelector("#scene-world-mode");
const buildZoneLabel = document.querySelector("#build-zone-label");
const worldModeEyebrow = document.querySelector("#world-mode-eyebrow");
const chatSection = document.querySelector("#chat-section");
const chatLog = document.querySelector("#chat-log");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatSendButton = document.querySelector("#chat-send");
const chatStatus = document.querySelector("#chat-status");
const autonomyStateLabel = document.querySelector("#autonomy-state");
const autonomyToggle = document.querySelector("#autonomy-toggle");
const tileWidth = 34;
const tileHeight = 17;
const blockHeight = 16;
const baseX = canvas.width / 2;
const baseY = 362;
const halfWidth = tileWidth / 2;
const halfHeight = tileHeight / 2;
const CHAT_POLL_MS = 1500;

let localWorld = createSeedWorld("local-preview");
let world = localWorld;
let runtimeMode = "local";
let coreConnected = false;
let coreBusy = false;
let pendingIntent = (() => {
  try { return JSON.parse(sessionStorage.getItem("simulator-pending-intent") ?? "null"); } catch { return null; }
})();
let clientSeq = Number(sessionStorage.getItem("simulator-client-seq") ?? 0);
let companion = null;
let candidates = [];
let selectedMaterial = "planks";
let selectedTile = null;
let clickMode = "select";
let proposal = null;
let toastTimer;
let chatPollTimer;
let chatSignature = "";
let chatBusy = false;
let autonomyEnabled = false;
const tileButtons = new Map();

function pointFor(x, y, z) {
  return {
    x: baseX + (x - z) * halfWidth,
    y: baseY + (x + z + 1) * halfHeight - y * blockHeight,
  };
}

function tilePoints(x, y, z) {
  const center = pointFor(x, y, z);
  return [
    { x: center.x, y: center.y - halfHeight },
    { x: center.x + halfWidth, y: center.y },
    { x: center.x, y: center.y + halfHeight },
    { x: center.x - halfWidth, y: center.y },
  ];
}

function fillPolygon(points, fill, stroke = "") {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }
}

function blockAt(x, y, z) {
  return getBlock(world, { x, y, z });
}

function drawCube(x, y, z, blockId, options = {}) {
  const colors = COLORS[blockId] ?? COLORS.stone;
  const points = tilePoints(x, y + 1, z);
  const [top, right, bottom, left] = points;
  const down = (point) => ({ x: point.x, y: point.y + blockHeight });
  const belowRight = down(right);
  const belowBottom = down(bottom);
  const belowLeft = down(left);
  const alpha = options.alpha ?? 1;
  ctx.save();
  ctx.globalAlpha = alpha;

  if (options.ghost) {
    fillPolygon([right, bottom, belowBottom, belowRight], colors.x, "#d7efbb");
    fillPolygon([bottom, left, belowLeft, belowBottom], colors.z, "#d7efbb");
    fillPolygon(points, colors.top, "#e7f5cf");
    ctx.restore();
    return;
  }

  if (!blockAt(x + 1, y, z)) fillPolygon([right, bottom, belowBottom, belowRight], colors.x, "#17241d55");
  if (!blockAt(x, y, z + 1)) fillPolygon([bottom, left, belowLeft, belowBottom], colors.z, "#17241d55");
  if (!blockAt(x, y + 1, z)) fillPolygon(points, colors.top, "#23342a55");
  ctx.restore();
}

function sortedCells() {
  const cells = [];
  const { footprint } = WORLD_SPEC;
  for (let z = footprint.minZ; z < footprint.maxZ; z += 1) {
    for (let x = footprint.minX; x < footprint.maxX; x += 1) {
      for (let y = 0; y < WORLD_SPEC.size.y; y += 1) {
        const blockId = blockAt(x, y, z);
        if (blockId) cells.push({ x, y, z, blockId });
      }
    }
  }
  return cells.sort((a, b) => a.x + a.z - (b.x + b.z) || a.y - b.y || a.x - b.x);
}

function drawGrid() {
  const { footprint } = WORLD_SPEC;
  for (let z = footprint.minZ; z < footprint.maxZ; z += 1) {
    for (let x = footprint.minX; x < footprint.maxX; x += 1) {
      const points = tilePoints(x, BUILD_MIN_Y, z);
      const active = selectedTile?.x === x && selectedTile?.z === z;
      if (active) {
        fillPolygon(points, "#c2ed8290", "#d9f4b7");
        continue;
      }
      if (!blockAt(x, BUILD_MIN_Y, z)) {
        ctx.setLineDash([2, 3]);
        fillPolygon(points, "#b8d59b0a", "#d3e4c81b");
        ctx.setLineDash([]);
      }
    }
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createRadialGradient(baseX, 290, 20, baseX, 290, 360);
  glow.addColorStop(0, "#71936d17");
  glow.addColorStop(1, "#15221e00");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const shadow = ctx.createRadialGradient(baseX, 390, 12, baseX, 390, 260);
  shadow.addColorStop(0, "#06110dcc");
  shadow.addColorStop(1, "#06110d00");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(baseX, 379, 246, 97, 0, 0, Math.PI * 2);
  ctx.fill();

  for (const cell of sortedCells()) drawCube(cell.x, cell.y, cell.z, cell.blockId);
  drawGrid();
  if (proposal?.cells?.length) {
    for (const cell of proposal.cells) drawCube(cell.x, cell.y, cell.z, cell.blockId, { ghost: true, alpha: 0.65 });
  }
  renderGridButtons();
}

function isWithinIsland(x, z) {
  const { footprint } = WORLD_SPEC;
  return x >= footprint.minX && x < footprint.maxX && z >= footprint.minZ && z < footprint.maxZ;
}

function columnTarget(x, z, action = "place") {
  if (action === "break") {
    for (let y = BUILD_MAX_Y; y >= BUILD_MIN_Y; y -= 1) {
      const blockId = blockAt(x, y, z);
      if (blockId) return { x, y, z, blockId };
    }
    return null;
  }
  for (let y = BUILD_MIN_Y; y <= BUILD_MAX_Y; y += 1) {
    if (!blockAt(x, y, z)) return { x, y, z, blockId: null };
  }
  return null;
}

function targetForAction(action) {
  if (!selectedTile) return null;
  return columnTarget(selectedTile.x, selectedTile.z, action);
}

function updateControls() {
  const placement = targetForAction("place");
  const removal = targetForAction("break");
  const editsEnabled = runtimeMode === "local" || (coreConnected && !coreBusy && !pendingIntent);
  placeButton.disabled = !placement || !editsEnabled;
  breakButton.disabled = !removal || !editsEnabled;
  const target = clickMode === "break" ? removal : placement;
  const coordLabel = document.querySelector("#target-coord");
  if (!selectedTile) coordLabel.textContent = "No tile selected";
  else if (!target) coordLabel.textContent = `x ${selectedTile.x}, z ${selectedTile.z} · no build cell`;
  else coordLabel.textContent = `x ${target.x}, y ${target.y}, z ${target.z}`;
  const action = clickMode === "break" ? "break" : "place";
  placeButton.setAttribute("aria-label", placement ? `Place ${BLOCK_DEFS[selectedMaterial].label} at x ${placement.x}, y ${placement.y}, z ${placement.z}` : "No empty build cell in selected column");
  breakButton.setAttribute("aria-label", removal ? `Break ${BLOCK_DEFS[removal.blockId].label} at x ${removal.x}, y ${removal.y}, z ${removal.z}` : "No player block to break in selected column");
  canvas.setAttribute("aria-description", selectedTile ? `Selected column x ${selectedTile.x}, z ${selectedTile.z}. Click mode is ${action}. Build cells start at y ${BUILD_MIN_Y}.` : `Select a tile. Build cells start at y ${BUILD_MIN_Y}.`);
}

function createTileGrid() {
  const { footprint } = WORLD_SPEC;
  for (let z = footprint.minZ; z < footprint.maxZ; z += 1) {
    for (let x = footprint.minX; x < footprint.maxX; x += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile";
      button.dataset.x = String(x);
      button.dataset.z = String(z);
      button.setAttribute("aria-pressed", "false");
      button.tabIndex = x === footprint.minX && z === footprint.minZ ? 0 : -1;
      button.setAttribute("aria-label", `Island column x ${x}, z ${z}`);
      button.addEventListener("focus", () => selectTile(x, z, false));
      button.addEventListener("click", () => handleTileAction(x, z));
      grid.append(button);
      tileButtons.set(`${x},${z}`, button);
    }
  }
}

function renderGridButtons() {
  for (const [key, button] of tileButtons) {
    const [x, z] = key.split(",").map(Number);
    const selected = selectedTile?.x === x && selectedTile?.z === z;
    const top = columnTarget(x, z, "break");
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("aria-label", top ? `Island column x ${x}, z ${z}; top build block ${BLOCK_DEFS[top.blockId].label} at y ${top.y}` : `Island column x ${x}, z ${z}; empty above grass`);
    button.classList.toggle("is-build-zone", !top);
  }
}

function selectTile(x, z, announce = true) {
  if (!isWithinIsland(x, z)) return;
  selectedTile = { x, z };
  for (const [key, button] of tileButtons) button.tabIndex = key === `${x},${z}` ? 0 : -1;
  updateControls();
  render();
  if (announce) status.textContent = `Selected island column x ${x}, z ${z}.`;
}

function toastMessage(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function installWorld(nextWorld) {
  if (nextWorld?.schemaVersion === WORLD_SPEC.version) return worldStateFromObject(nextWorld);
  if (assertWorldState(nextWorld)) return nextWorld;
  throw new Error("Core returned an invalid world snapshot.");
}

function refreshWorldView() {
  proposal = proposal && proposal.baseRev !== world.rev ? proposal : null;
  updateStats();
  updateControls();
  render();
  syncProposalPanel();
}

function setRuntimeNotice(message = "", kind = "error") {
  runtimeError.hidden = !message;
  runtimeError.textContent = message;
  runtimeError.classList.toggle("is-paused", kind === "paused");
  retryCoreButton.hidden = runtimeMode !== "shared" || (coreConnected && !pendingIntent);
}

function setCoreBusy(busy) {
  coreBusy = busy;
  buildTickButton.disabled = busy || !coreConnected;
  approveCandidateButton.disabled = busy || !coreConnected || !candidateSelect.value;
  retryCoreButton.disabled = busy;
  updateControls();
}

async function coreRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Core returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) throw new Error(payload?.error ?? payload?.message ?? `Core request failed (${response.status}).`);
  return payload;
}

function updateCompanionStatus() {
  if (!companion) {
    companionStateLabel.textContent = "Unavailable";
    return;
  }
  const state = companion.state ?? "unknown";
  companionStateLabel.textContent = `${state}${companion.autonomyEnabled === false ? " · autonomy off" : ""}`;
}

// The chat panel and the autonomy toggle are Host-only surfaces: `?mode=core` keeps
// its in-memory sandbox API, which has no companion conversation or scheduler.
function setChatVisible(visible) {
  const open = visible === true;
  chatSection.hidden = !open;
  if (!open) {
    if (chatPollTimer) clearInterval(chatPollTimer);
    chatPollTimer = undefined;
    return;
  }
  void loadChat();
  void loadAutonomy();
  if (!chatPollTimer) chatPollTimer = setInterval(() => void loadChat(), CHAT_POLL_MS);
}

function formatChatTime(atMs) {
  if (!Number.isFinite(atMs)) return "";
  const at = new Date(atMs);
  return `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
}

function renderChat(messages) {
  const signature = JSON.stringify(messages);
  if (signature === chatSignature) return;
  chatSignature = signature;
  chatLog.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "还没有聊天记录，先跟我打个招呼吧";
    chatLog.append(empty);
    return;
  }
  for (const message of messages) {
    if (!message || typeof message.text !== "string") continue;
    const isUser = message.role === "user";
    const row = document.createElement("div");
    row.className = `chat-message is-${isUser ? "user" : "companion"}`;
    const role = document.createElement("span");
    role.className = "chat-role";
    // Host text is untrusted display data: always assign through textContent.
    role.textContent = `${isUser ? "YOU" : "FISH"} · ${formatChatTime(message.atMs)}`;
    const copy = document.createElement("p");
    copy.className = "chat-copy";
    copy.textContent = message.text;
    row.append(role, copy);
    chatLog.append(row);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function loadChat() {
  if (chatSection.hidden) return;
  try {
    const payload = await coreRequest("/chat");
    renderChat(Array.isArray(payload.messages) ? payload.messages : []);
    chatStatus.textContent = "LIVE · HOST";
    chatStatus.classList.remove("is-offline");
  } catch {
    chatStatus.textContent = "OFFLINE";
    chatStatus.classList.add("is-offline");
  }
}

async function sendChat(event) {
  event.preventDefault();
  if (chatBusy) return;
  const text = chatInput.value.trim();
  if (!text) return;
  chatBusy = true;
  chatSendButton.disabled = true;
  try {
    const payload = await coreRequest("/chat", { method: "POST", body: JSON.stringify({ text }) });
    if (typeof payload.reply !== "string") throw new Error("Host returned no chat reply.");
    chatInput.value = "";
    if (typeof payload.state === "string") companionStateLabel.textContent = payload.state;
    await loadChat();
  } catch (error) {
    toastMessage(`Chat failed: ${error.message}`);
  } finally {
    chatBusy = false;
    chatSendButton.disabled = false;
  }
}

function renderAutonomy(payload) {
  const intervalMs = Number(payload?.intervalMs);
  const schedulable = Number.isFinite(intervalMs) && intervalMs > 0;
  autonomyEnabled = payload?.enabled === true;
  const intervalLabel = schedulable ? `every ${Math.max(1, Math.round(intervalMs / 1000))}s` : "interval 0";
  autonomyStateLabel.textContent = autonomyEnabled ? `on · ${intervalLabel}` : "off";
  autonomyToggle.textContent = autonomyEnabled ? "Pause" : "Resume";
  autonomyToggle.setAttribute("aria-pressed", String(autonomyEnabled));
  autonomyToggle.disabled = !schedulable;
}

async function loadAutonomy() {
  if (chatSection.hidden) return;
  try {
    renderAutonomy(await coreRequest("/autonomy"));
  } catch {
    autonomyStateLabel.textContent = "Unavailable";
    autonomyToggle.disabled = true;
  }
}

async function toggleAutonomy() {
  if (autonomyToggle.disabled) return;
  autonomyToggle.disabled = true;
  try {
    const payload = await coreRequest("/autonomy", {
      method: "POST",
      body: JSON.stringify({ enabled: !autonomyEnabled }),
    });
    renderAutonomy(payload);
    toastMessage(payload.enabled === true ? "Autonomy resumed. The companion acts on its own." : "Autonomy paused.");
  } catch (error) {
    toastMessage(`Autonomy toggle failed: ${error.message}`);
    await loadAutonomy();
  }
}

function setCandidates(values) {
  candidates = values.filter((candidate) => candidate && typeof candidate.candidateId === "string");
  candidateSelect.replaceChildren();
  for (const [index, candidate] of candidates.entries()) {
    const option = document.createElement("option");
    option.value = candidate.candidateId;
    const origin = candidate.origin;
    option.textContent = origin ? `Plot ${index + 1} · x${origin.x}, z${origin.z}` : `Plot ${index + 1}`;
    candidateSelect.append(option);
  }
  candidatePanel.hidden = candidates.length === 0;
  candidateCount.textContent = candidates.length ? `${candidates.length} available` : "";
  renderSelectedCandidate();
}

function renderSelectedCandidate() {
  const candidate = candidates.find((item) => item.candidateId === candidateSelect.value) ?? candidates[0];
  if (candidate && candidateSelect.value !== candidate.candidateId) candidateSelect.value = candidate.candidateId;
  const bounds = candidate?.bounds;
  candidateDescription.textContent = candidate
    ? `Observed at revision ${candidate.observedRev}. ${bounds ? `Plot spans x ${bounds.min.x}–${bounds.maxExclusive.x - 1}, z ${bounds.min.z}–${bounds.maxExclusive.z - 1}.` : ""}`
    : "No plot selected.";
  approveCandidateButton.disabled = coreBusy || !coreConnected || !candidate;
}

function applyCoreWorld(nextWorld) {
  world = installWorld(nextWorld);
  refreshWorldView();
}

async function loadCoreState() {
  coreStateLabel.textContent = "Connecting…";
  coreOwnerLabel.textContent = "—";
  coreConnected = false;
  setRuntimeNotice("");
  setCoreBusy(true);
  try {
    const payload = await coreRequest("/state");
    applyCoreWorld(payload.world);
    if (typeof payload.ownerUserId !== "string" || !payload.companion || typeof payload.companion !== "object") {
      throw new Error("Core state is missing ownerUserId or companion.");
    }
    coreOwnerLabel.textContent = payload.ownerUserId;
    companion = payload.companion;
    updateCompanionStatus();
    coreConnected = true;
    coreStateLabel.textContent = "Connected · localhost";
    setRuntimeNotice("");
    setCandidates(payload.candidate ? [payload.candidate] : []);
    if (payload.homeGrantActive === true) companionMessage.textContent = "Home plot active. Run a build tick when ready.";
    if (pendingIntent) {
      coreStateLabel.textContent = "Connected · pending intent";
      retryCoreButton.hidden = false;
      setRuntimeNotice("An intent is awaiting confirmation. Retry it to resolve the result.", "paused");
    }
  } catch (error) {
    coreStateLabel.textContent = "Offline";
    coreConnected = false;
    setRuntimeNotice(error.message);
  } finally {
    setCoreBusy(false);
    // The Host now answers autonomy state; refresh the toggle once the connection is known.
    if (!chatSection.hidden) void loadAutonomy();
  }
}

function setRuntimeMode(mode) {
  if (mode === runtimeMode || coreBusy) return;
  if (runtimeMode === "shared" && pendingIntent && mode === "local") {
    toastMessage("Retry or resolve the pending shared intent before switching modes.");
    return;
  }
  runtimeMode = mode;
  const shared = mode === "shared";
  localModeButton.classList.toggle("is-active", !shared);
  localModeButton.setAttribute("aria-pressed", String(!shared));
  sharedModeButton.classList.toggle("is-active", shared);
  sharedModeButton.setAttribute("aria-pressed", String(shared));
  sharedStatus.hidden = !shared;
  companionSection.hidden = !shared;
  proposalPanel.hidden = shared || !proposal;
  document.querySelector(".proposal-section").hidden = shared;
  demoDisclaimer.hidden = !shared;
  runtimeCaption.textContent = shared ? "Server-authoritative edits via localhost demo API." : "Local browser-only preview.";
  statsNote.textContent = shared ? "Localhost demo state. No phone is connected." : "Changes are local to this browser session.";
  sceneWorldMode.innerHTML = shared ? 'SHARED CORE <span class="live-dot"></span>' : 'LOCAL WORLD <span class="live-dot"></span>';
  worldModeEyebrow.textContent = shared ? "SHARED CORE DEMO" : "LOCAL SANDBOX";
  if (shared) {
    coreStateLabel.textContent = "Not connected";
    setCandidates([]);
    void loadCoreState();
  } else {
    world = localWorld;
    companion = null;
    coreConnected = false;
    coreStateLabel.textContent = "Not connected";
    companionStateLabel.textContent = "—";
    coreOwnerLabel.textContent = "—";
    setRuntimeNotice("");
    refreshWorldView();
  }
  setChatVisible(shared && HOST_MODE);
  updateControls();
}

async function submitSharedIntent(operation, successMessage, retry = false) {
  if (!coreConnected || coreBusy) return false;
  if (!pendingIntent) {
    pendingIntent = {
      clientId: sessionStorage.getItem("simulator-client-id") || crypto.randomUUID(),
      seq: clientSeq + 1,
      baseRev: world.rev,
      operation,
    };
    sessionStorage.setItem("simulator-client-id", pendingIntent.clientId);
    sessionStorage.setItem("simulator-pending-intent", JSON.stringify(pendingIntent));
  }
  setCoreBusy(true);
  coreStateLabel.textContent = retry ? "Retrying intent…" : "Sending intent…";
  setRuntimeNotice("");
  try {
    const payload = await coreRequest("/intent", {
      method: "POST",
      body: JSON.stringify(pendingIntent),
    });
    const ack = payload.decision?.ack;
    const resolvedSeq = pendingIntent?.seq;
    if (!ack || !Number.isSafeInteger(ack.seq) || ack.seq !== resolvedSeq || typeof ack.accepted !== "boolean" || !payload.world) {
      throw new Error("Core returned an incomplete or mismatched intent acknowledgement.");
    }
    applyCoreWorld(payload.world);
    // Any definitive ACK consumes the submitted seq, including stale_revision.
    clientSeq = Math.max(clientSeq, ack.seq);
    sessionStorage.setItem("simulator-client-seq", String(clientSeq));
    pendingIntent = null;
    sessionStorage.removeItem("simulator-pending-intent");
    coreConnected = true;
    coreStateLabel.textContent = "Connected · localhost";
    if (!ack.accepted) {
      const reason = ack.reason ?? "intent rejected";
      setRuntimeNotice(`Intent rejected: ${reason.replaceAll("_", " ")}.`, "paused");
      toastMessage(`Intent rejected: ${reason.replaceAll("_", " ")}.`);
      return false;
    }
    toastMessage(successMessage);
    status.textContent = `${successMessage} Revision ${world.rev}.`;
    return true;
  } catch (error) {
    coreConnected = false;
    coreStateLabel.textContent = "Offline · intent pending";
    setRuntimeNotice(`${error.message} The intent is retained for a safe retry.`);
    return false;
  } finally {
    setCoreBusy(false);
  }
}

async function commitOperations(operations, successMessage) {
  if (!operations.length) return false;
  if (runtimeMode === "shared") {
    if (operations.length !== 1) {
      toastMessage("Shared mode accepts one player edit at a time.");
      return false;
    }
    return submitSharedIntent(operations[0], successMessage);
  }
  const result = applyTransaction(world, operations);
  if (!result.ok) {
    toastMessage(`Transaction rejected: ${result.code.replaceAll("_", " ")}.`);
    status.textContent = `Transaction rejected: ${result.code.replaceAll("_", " ")}.`;
    return false;
  }
  world = result.world;
  localWorld = result.world;
  refreshWorldView();
  toastMessage(successMessage);
  status.textContent = `${successMessage} Revision ${world.rev}.`;
  return true;
}

async function retryCore() {
  if (runtimeMode !== "shared" || coreBusy) return;
  if (!coreConnected) {
    await loadCoreState();
    if (!coreConnected) return;
  }
  if (pendingIntent) await submitSharedIntent(pendingIntent.operation, "Shared intent confirmed.", true);
}

async function runBuildTick() {
  if (runtimeMode !== "shared" || !coreConnected || coreBusy) return;
  setCoreBusy(true);
  coreStateLabel.textContent = "Build tick running…";
  setRuntimeNotice("");
  companionMessage.textContent = "Checking tracking and companion policy…";
  try {
    const payload = await coreRequest("/companion/tick", { method: "POST" });
    if (!payload.world || !payload.result || typeof payload.result.status !== "string") throw new Error("Core returned an incomplete companion tick.");
    applyCoreWorld(payload.world);
    const result = payload.result;
    if (result.candidate) setCandidates(Array.isArray(result.candidate) ? result.candidate : [result.candidate]);
    else setCandidates([]);
    coreConnected = true;
    coreStateLabel.textContent = "Connected · localhost";
    companionMessage.textContent = result.reason
      ? `${result.status.replaceAll("_", " ")} · ${result.reason.replaceAll("_", " ")}`
      : `${result.status.replaceAll("_", " ")} · ${Array.isArray(result.intents) ? result.intents.length : 0} intent(s)`;
    if (result.status === "paused") {
      setRuntimeNotice(`Companion paused: ${(result.reason ?? "tracking or autonomy unavailable").replaceAll("_", " ")}.`, "paused");
    } else {
      setRuntimeNotice("");
    }
    if (result.commit) toastMessage(`Companion build committed at revision ${world.rev}.`);
    else if (result.status === "home_approval_required") toastMessage("Choose a candidate plot and approve it before the next build tick.");
    else if (result.status === "committed") toastMessage("Companion build committed.");
    updateCompanionStatus();
  } catch (error) {
    coreConnected = false;
    coreStateLabel.textContent = "Offline";
    setRuntimeNotice(error.message);
    companionMessage.textContent = "Tick failed. Reconnect to continue.";
  } finally {
    setCoreBusy(false);
    renderSelectedCandidate();
  }
}

async function approveCandidate() {
  if (runtimeMode !== "shared" || !coreConnected || coreBusy) return;
  const candidate = candidates.find((item) => item.candidateId === candidateSelect.value);
  if (!candidate) return;
  setCoreBusy(true);
  setRuntimeNotice("");
  companionMessage.textContent = "Requesting owner approval…";
  try {
    const payload = await coreRequest("/home/approve", {
      method: "POST",
      body: JSON.stringify({ candidateId: candidate.candidateId }),
    });
    if (payload.approved !== true) {
      companionMessage.textContent = "Approval was not granted.";
      setRuntimeNotice("The core did not approve this candidate.", "paused");
      return;
    }
    if (payload.world) applyCoreWorld(payload.world);
    candidatePanel.hidden = true;
    candidates = [];
    companionMessage.textContent = "Plot approved. Running the next companion tick…";
  } catch (error) {
    coreConnected = false;
    coreStateLabel.textContent = "Offline";
    setRuntimeNotice(error.message);
    companionMessage.textContent = "Approval failed. Reconnect to continue.";
    return;
  } finally {
    setCoreBusy(false);
  }
  await runBuildTick();
}

function placeSelected() {
  const target = targetForAction("place");
  if (!target) return toastMessage("No empty build cell remains in this column.");
  const coord = { x: target.x, y: target.y, z: target.z };
  commitOperations([{ type: "place", at: coord, blockId: selectedMaterial }], `${BLOCK_DEFS[selectedMaterial].label} placed at y ${coord.y}.`);
}

function breakSelected() {
  const target = targetForAction("break");
  if (!target) return toastMessage("There is no build block to break in this column.");
  const coord = { x: target.x, y: target.y, z: target.z };
  commitOperations([{ type: "break", at: coord, expectedBlock: target.blockId }], `Block removed at y ${coord.y}.`);
}

function handleTileAction(x, z) {
  selectTile(x, z);
  if (clickMode === "place") placeSelected();
  if (clickMode === "break") breakSelected();
}

function canvasHit(event) {
  const bounds = canvas.getBoundingClientRect();
  const px = (event.clientX - bounds.left) * canvas.width / bounds.width;
  const py = (event.clientY - bounds.top) * canvas.height / bounds.height;
  const dx = (px - baseX) / halfWidth;
  const dy = (py - (baseY - BUILD_MIN_Y * blockHeight)) / halfHeight;
  const x = Math.round((dx + dy - 1) / 2);
  const z = Math.round((dy - 1 - dx) / 2);
  if (!isWithinIsland(x, z)) return null;
  const centerDx = dx - (x - z);
  const centerDy = dy - (x + z + 1);
  if (Math.abs(centerDx) + Math.abs(centerDy) > 1.08) return null;
  return { x, z };
}

function updateStats() {
  document.querySelector("#world-rev").textContent = String(world.rev).padStart(2, "0");
  document.querySelector("#block-count").textContent = String(countBlocks(world));
  document.querySelector("#world-id").textContent = world.worldId;
}

function setMaterial(material) {
  if (!MATERIALS.includes(material)) return;
  selectedMaterial = material;
  for (const button of materialButtons) {
    const isSelected = button.dataset.material === material;
    button.tabIndex = isSelected ? 0 : -1;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-checked", String(isSelected));
    button.setAttribute("aria-label", `${BLOCK_DEFS[button.dataset.material].label}${isSelected ? ", selected" : ""}`);
  }
  updateControls();
  render();
}

function setMode(mode) {
  clickMode = mode;
  for (const button of modeButtons) {
    const isActive = button.dataset.mode === mode;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
  updateControls();
}

function cabinPattern(material) {
  // Patterns are laid out from the first buildable layer up, so they stay on the
  // surface as WorldSpec.terrainTopY changes instead of floating above it.
  const baseY = BUILD_MIN_Y;
  const cells = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) cells.push({ x, y: baseY, z, blockId: material });
  }
  for (let y = baseY + 1; y <= baseY + 2; y += 1) {
    for (let offset = -1; offset <= 1; offset += 1) {
      if (!(y === baseY + 1 && offset === 0)) cells.push({ x: offset, y, z: 1, blockId: material });
      if (!(y === baseY + 1 && offset === 0)) cells.push({ x: offset, y, z: -1, blockId: material });
      if (offset !== 0) {
        cells.push({ x: -1, y, z: offset, blockId: material });
        cells.push({ x: 1, y, z: offset, blockId: material });
      } else if (y === baseY + 1) {
        cells.push({ x: -1, y, z: 0, blockId: "glass" });
        cells.push({ x: 1, y, z: 0, blockId: "glass" });
      }
    }
  }
  for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) cells.push({ x, y: baseY + 3, z, blockId: material === "leaves" ? "planks" : material });
  return cells;
}

function bridgePattern(material) {
  const baseY = BUILD_MIN_Y;
  const cells = [];
  for (let x = -3; x <= 3; x += 1) {
    cells.push({ x, y: baseY, z: 0, blockId: material });
    if (Math.abs(x) < 3) {
      cells.push({ x, y: baseY + 1, z: -1, blockId: "leaves" });
      cells.push({ x, y: baseY + 1, z: 1, blockId: "leaves" });
    }
  }
  return cells;
}

function towerPattern(material) {
  const baseY = BUILD_MIN_Y;
  const cells = [];
  for (let y = baseY; y <= baseY + 4; y += 1) {
    for (let offset = -1; offset <= 1; offset += 1) {
      cells.push({ x: -1, y, z: offset, blockId: material });
      cells.push({ x: 1, y, z: offset, blockId: material });
      if (offset === -1 || offset === 1) cells.push({ x: 0, y, z: offset, blockId: material });
    }
  }
  for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) cells.push({ x, y: baseY + 5, z, blockId: material });
  cells.push({ x: 0, y: baseY + 6, z: 0, blockId: material });
  return cells;
}

function generateProposal(promptText) {
  if (runtimeMode === "shared") return;
  const prompt = promptText.trim();
  if (!prompt) {
    toastMessage("Describe a small build first.");
    document.querySelector("#proposal-prompt").focus();
    return;
  }
  const normalized = prompt.toLowerCase();
  let pattern = "cabin";
  let rawCells;
  if (/bridge|桥/.test(normalized)) {
    pattern = "bridge";
    rawCells = bridgePattern(selectedMaterial);
  } else if (/tower|塔/.test(normalized)) {
    pattern = "tower";
    rawCells = towerPattern(selectedMaterial);
  } else {
    rawCells = cabinPattern(selectedMaterial);
  }
  const cells = [];
  let skipped = 0;
  const seen = new Set();
  const anchor = selectedTile ?? { x: 0, z: 0 };
  for (const raw of rawCells) {
    const cell = { ...raw, x: raw.x + anchor.x, z: raw.z + anchor.z };
    const key = `${cell.x},${cell.y},${cell.z}`;
    if (!isWithinIsland(cell.x, cell.z) || cell.y < BUILD_MIN_Y || cell.y > BUILD_MAX_Y || seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    if (blockAt(cell.x, cell.y, cell.z)) {
      skipped += 1;
      continue;
    }
    cells.push(cell);
  }
  if (cells.length > 256) {
    toastMessage("This proposal exceeds the transaction limit.");
    return;
  }
  proposal = { prompt, pattern, cells, skipped, baseRev: world.rev };
  syncProposalPanel();
  render();
  status.textContent = `Proposal preview generated with ${cells.length} cells. No blocks have been committed.`;
}

function syncProposalPanel() {
  proposalPanel.hidden = !proposal;
  if (!proposal) return;
  const counts = new Map();
  for (const cell of proposal.cells) counts.set(cell.blockId, (counts.get(cell.blockId) ?? 0) + 1);
  const materialSummary = [...counts].map(([id, count]) => `${BLOCK_DEFS[id].label} ${count}`).join(" · ") || "No valid cells";
  document.querySelector("#proposal-description").textContent = proposal.prompt;
  document.querySelector("#proposal-count").textContent = String(proposal.cells.length);
  document.querySelector("#proposal-skipped").textContent = String(proposal.skipped);
  document.querySelector("#proposal-materials").textContent = materialSummary;
  document.querySelector("#proposal-rev").textContent = `BASE REV ${String(proposal.baseRev).padStart(2, "0")}`;
  const stale = proposal.baseRev !== world.rev;
  document.querySelector("#proposal-stale").hidden = !stale;
  document.querySelector("#confirm-proposal").disabled = stale || proposal.cells.length === 0;
}

async function confirmProposal() {
  if (!proposal) return;
  if (proposal.baseRev !== world.rev) {
    syncProposalPanel();
    toastMessage("World changed. Regenerate this preview before confirming.");
    return;
  }
  const currentProposal = proposal;
  const operations = currentProposal.cells.map((cell) => ({
    type: "place",
    at: { x: cell.x, y: cell.y, z: cell.z },
    blockId: cell.blockId,
  }));
  const committed = await commitOperations(operations, `Build confirmed: ${operations.length} blocks.`);
  if (committed) {
    proposal = null;
    syncProposalPanel();
    render();
  }
}

function cancelProposal() {
  proposal = null;
  syncProposalPanel();
  render();
  toastMessage("Build preview cancelled. World unchanged.");
  status.textContent = "Build preview cancelled. World unchanged.";
}

buildZoneLabel.textContent = `X / Z · Y ≥ ${BUILD_MIN_Y} BUILD ZONE`;
createTileGrid();
for (const button of materialButtons) button.tabIndex = button.dataset.material === selectedMaterial ? 0 : -1;
updateStats();
updateControls();
render();
if (CORE_MODE) setRuntimeMode("shared");

materialButtons.forEach((button, index) => {
  button.addEventListener("click", () => setMaterial(button.dataset.material));
  button.addEventListener("keydown", (event) => {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = (index + direction + materialButtons.length) % materialButtons.length;
    setMaterial(materialButtons[next].dataset.material);
    materialButtons[next].focus();
  });
});
modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
localModeButton.addEventListener("click", () => setRuntimeMode("local"));
sharedModeButton.addEventListener("click", () => setRuntimeMode("shared"));
retryCoreButton.addEventListener("click", retryCore);
buildTickButton.addEventListener("click", runBuildTick);
approveCandidateButton.addEventListener("click", approveCandidate);
candidateSelect.addEventListener("change", renderSelectedCandidate);
chatForm.addEventListener("submit", sendChat);
autonomyToggle.addEventListener("click", toggleAutonomy);
placeButton.addEventListener("click", placeSelected);
breakButton.addEventListener("click", breakSelected);
document.querySelector("#proposal-form").addEventListener("submit", (event) => {
  event.preventDefault();
  generateProposal(document.querySelector("#proposal-prompt").value);
});
document.querySelector("#confirm-proposal").addEventListener("click", confirmProposal);
document.querySelector("#cancel-proposal").addEventListener("click", cancelProposal);

canvas.addEventListener("click", (event) => {
  const tile = canvasHit(event);
  if (tile) handleTileAction(tile.x, tile.z);
  else {
    status.textContent = "Outside the island build grid. Select a tile within the 14 by 14 footprint.";
  }
});

canvas.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (selectedTile) handleTileAction(selectedTile.x, selectedTile.z);
    else {
      const button = grid.querySelector(".tile");
      button?.focus();
    }
  }
});

grid.addEventListener("keydown", (event) => {
  const current = event.target.closest(".tile");
  if (!current) return;
  const x = Number(current.dataset.x);
  const z = Number(current.dataset.z);
  const moves = {
    ArrowLeft: [x - 1, z],
    ArrowRight: [x + 1, z],
    ArrowUp: [x, z - 1],
    ArrowDown: [x, z + 1],
  };
  if (moves[event.key]) {
    event.preventDefault();
    const [nextX, nextZ] = moves[event.key];
    if (isWithinIsland(nextX, nextZ)) tileButtons.get(`${nextX},${nextZ}`)?.focus();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handleTileAction(x, z);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName ?? "")) return;
  const materialIndex = Number(event.key) - 1;
  if (materialIndex >= 0 && materialIndex < MATERIALS.length) setMaterial(MATERIALS[materialIndex]);
  if (event.key.toLowerCase() === "p" && selectedTile) placeSelected();
  if (event.key.toLowerCase() === "b" && selectedTile) breakSelected();
});

window.addEventListener("resize", render);
