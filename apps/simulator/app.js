import { BLOCK_DEFS, WORLD_SPEC } from "@fangcun/world-schema";
import { applyTransaction, countBlocks, createSeedWorld, getBlock } from "@fangcun/voxel-core";

const MATERIALS = ["planks", "stone", "glass", "leaves"];
const COLORS = {
  grass: { top: "#819f62", x: "#60794a", z: "#6f8954" },
  dirt: { top: "#8a6444", x: "#644730", z: "#765338" },
  stone: { top: "#9aa39a", x: "#727c74", z: "#838d85" },
  planks: { top: "#bd895b", x: "#875b3d", z: "#a37149" },
  glass: { top: "#a6ded2", x: "#5d9993", z: "#7cb8ae" },
  leaves: { top: "#91ad5d", x: "#53794a", z: "#6d914c" },
};
const BUILD_MIN_Y = WORLD_SPEC.terrainTopY;
const BUILD_MAX_Y = WORLD_SPEC.size.y - 1;
const canvas = document.querySelector("#world-canvas");
const ctx = canvas.getContext("2d");
const grid = document.querySelector("#tile-grid");
const placeButton = document.querySelector("#place-button");
const breakButton = document.querySelector("#break-button");
const materialButtons = [...document.querySelectorAll(".material-option")];
const modeButtons = [...document.querySelectorAll(".mode-button")];
const proposalPanel = document.querySelector("#proposal-panel");
const toast = document.querySelector("#toast");
const status = document.querySelector("#canvas-status");
const tileWidth = 34;
const tileHeight = 17;
const blockHeight = 16;
const baseX = canvas.width / 2;
const baseY = 362;
const halfWidth = tileWidth / 2;
const halfHeight = tileHeight / 2;

let world = createSeedWorld("local-preview");
let selectedMaterial = "planks";
let selectedTile = null;
let clickMode = "select";
let proposal = null;
let toastTimer;
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
  placeButton.disabled = !placement;
  breakButton.disabled = !removal;
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

function commitOperations(operations, successMessage) {
  if (!operations.length) return false;
  const result = applyTransaction(world, operations);
  if (!result.ok) {
    toastMessage(`Transaction rejected: ${result.code.replaceAll("_", " ")}.`);
    status.textContent = `Transaction rejected: ${result.code.replaceAll("_", " ")}.`;
    return false;
  }
  world = result.world;
  proposal = proposal && proposal.baseRev !== world.rev ? proposal : null;
  updateStats();
  updateControls();
  render();
  syncProposalPanel();
  toastMessage(successMessage);
  status.textContent = `${successMessage} Revision ${world.rev}.`;
  return true;
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
  const cells = [];
  for (let x = -1; x <= 1; x += 1) {
    for (let z = -1; z <= 1; z += 1) cells.push({ x, y: 4, z, blockId: material });
  }
  for (let y = 5; y <= 6; y += 1) {
    for (let offset = -1; offset <= 1; offset += 1) {
      if (!(y === 5 && offset === 0)) cells.push({ x: offset, y, z: 1, blockId: material });
      if (!(y === 5 && offset === 0)) cells.push({ x: offset, y, z: -1, blockId: material });
      if (offset !== 0) {
        cells.push({ x: -1, y, z: offset, blockId: material });
        cells.push({ x: 1, y, z: offset, blockId: material });
      } else if (y === 5) {
        cells.push({ x: -1, y, z: 0, blockId: "glass" });
        cells.push({ x: 1, y, z: 0, blockId: "glass" });
      }
    }
  }
  for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) cells.push({ x, y: 7, z, blockId: material === "leaves" ? "planks" : material });
  return cells;
}

function bridgePattern(material) {
  const cells = [];
  for (let x = -3; x <= 3; x += 1) {
    cells.push({ x, y: 4, z: 0, blockId: material });
    if (Math.abs(x) < 3) {
      cells.push({ x, y: 5, z: -1, blockId: "leaves" });
      cells.push({ x, y: 5, z: 1, blockId: "leaves" });
    }
  }
  return cells;
}

function towerPattern(material) {
  const cells = [];
  for (let y = 4; y <= 8; y += 1) {
    for (let offset = -1; offset <= 1; offset += 1) {
      cells.push({ x: -1, y, z: offset, blockId: material });
      cells.push({ x: 1, y, z: offset, blockId: material });
      if (offset === -1 || offset === 1) cells.push({ x: 0, y, z: offset, blockId: material });
    }
  }
  for (let x = -1; x <= 1; x += 1) for (let z = -1; z <= 1; z += 1) cells.push({ x, y: 9, z, blockId: material });
  cells.push({ x: 0, y: 10, z: 0, blockId: material });
  return cells;
}

function generateProposal(promptText) {
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

function confirmProposal() {
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
  const committed = commitOperations(operations, `Build confirmed: ${operations.length} blocks.`);
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

createTileGrid();
for (const button of materialButtons) button.tabIndex = button.dataset.material === selectedMaterial ? 0 : -1;
updateStats();
updateControls();
render();

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
