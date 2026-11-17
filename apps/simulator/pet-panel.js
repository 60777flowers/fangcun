/**
 * PC desktop-pet panel — host mode only.
 *
 * Self-contained on purpose: it owns its DOM and its styles, talks to the durable Host
 * through the `/api/host/*` proxy, and only needs a single `<script>` include in
 * index.html. Keeping it out of app.js avoids colliding with concurrent edits there.
 *
 * The action catalog and display names come from `GET /api/host/pet`; this file never
 * keeps a second hardcoded action list. Host text is untrusted display data and is only
 * ever assigned through textContent.
 */

const HOST_MODE = new URLSearchParams(window.location.search).get("mode") === "host";
const API_BASE = "/api/host";
const POLL_MS = 2000;
const NAME_MIN = 1;
const NAME_MAX = 24;
const SCALE_MIN = 0.5;
const SCALE_MAX = 3;

if (HOST_MODE) initPetPanel();

function initPetPanel() {
  const section = document.querySelector("#pet-section");
  const mount = document.querySelector("#pet-panel-body");
  if (!section || !mount) return;
  injectStyles();

  const scaleHint = document.createElement("span");
  scaleHint.className = "pet-hint";
  scaleHint.id = "pet-scale-hint";
  scaleHint.textContent = `${SCALE_MIN} – ${SCALE_MAX}`;

  const nameLabel = document.createElement("label");
  nameLabel.className = "pet-field";
  nameLabel.htmlFor = "pet-name-input";
  const nameCaption = document.createElement("span");
  nameCaption.className = "status-label";
  nameCaption.textContent = "NAME";
  const nameInput = document.createElement("input");
  nameInput.id = "pet-name-input";
  nameInput.type = "text";
  nameInput.maxLength = NAME_MAX;
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.setAttribute("aria-label", "Pet name");
  nameLabel.append(nameCaption, nameInput);

  const scaleLabel = document.createElement("label");
  scaleLabel.className = "pet-field pet-field-scale";
  scaleLabel.htmlFor = "pet-scale-input";
  const scaleCaption = document.createElement("span");
  scaleCaption.className = "status-label";
  scaleCaption.textContent = "SCALE";
  const scaleInput = document.createElement("input");
  scaleInput.id = "pet-scale-input";
  scaleInput.type = "number";
  scaleInput.min = String(SCALE_MIN);
  scaleInput.max = String(SCALE_MAX);
  scaleInput.step = "0.1";
  scaleInput.inputMode = "decimal";
  scaleInput.setAttribute("aria-label", "Pet scale");
  scaleLabel.append(scaleCaption, scaleInput);

  const fieldGrid = document.createElement("div");
  fieldGrid.className = "pet-field-grid";
  fieldGrid.append(nameLabel, scaleLabel);

  const saveButton = document.createElement("button");
  saveButton.id = "pet-save";
  saveButton.className = "pet-save";
  saveButton.type = "button";
  saveButton.textContent = "Save profile";

  const saveRow = document.createElement("div");
  saveRow.className = "pet-save-row";
  saveRow.append(scaleHint, saveButton);

  const actionsLabel = document.createElement("span");
  actionsLabel.className = "status-label";
  actionsLabel.textContent = "ACTIONS";
  const actionsCount = document.createElement("span");
  actionsCount.className = "pet-hint";
  actionsCount.id = "pet-actions-count";
  actionsCount.textContent = "—";
  const actionsHeading = document.createElement("div");
  actionsHeading.className = "pet-actions-heading";
  actionsHeading.append(actionsLabel, actionsCount);

  const actionRow = document.createElement("div");
  actionRow.id = "pet-actions";
  actionRow.className = "pet-actions";
  actionRow.setAttribute("role", "group");
  actionRow.setAttribute("aria-label", "Companion actions");

  const sayInput = document.createElement("input");
  sayInput.id = "pet-say-input";
  sayInput.type = "text";
  sayInput.maxLength = 200;
  sayInput.autocomplete = "off";
  sayInput.placeholder = "Say hello…";
  const sayLabel = document.createElement("label");
  sayLabel.className = "sr-only";
  sayLabel.htmlFor = "pet-say-input";
  sayLabel.textContent = "Say something to the companion";
  const sayButton = document.createElement("button");
  sayButton.id = "pet-say-send";
  sayButton.className = "pet-say-send";
  sayButton.type = "submit";
  sayButton.textContent = "Say";
  const sayForm = document.createElement("form");
  sayForm.id = "pet-say-form";
  sayForm.className = "pet-say-form";
  sayForm.append(sayLabel, sayInput, sayButton);

  const reply = document.createElement("p");
  reply.id = "pet-reply";
  reply.className = "pet-reply";
  reply.hidden = true;

  const panelStatus = document.createElement("p");
  panelStatus.id = "pet-panel-status";
  panelStatus.className = "pet-status";
  panelStatus.setAttribute("role", "status");
  panelStatus.setAttribute("aria-live", "polite");
  panelStatus.textContent = "Connecting…";

  mount.append(fieldGrid, saveRow, actionsHeading, actionRow, sayForm, reply, panelStatus);

  const statusCells = {
    connection: statusCell("PET", "pet-connection"),
    persona: statusCell("PERSONA", "pet-persona"),
    home: statusCell("HOME", "pet-home"),
  };
  const statusRow = document.createElement("div");
  statusRow.className = "pet-status-row";
  statusRow.append(statusCells.connection.root, statusCells.persona.root, statusCells.home.root);

  const currentRow = document.createElement("div");
  currentRow.className = "pet-current-row";
  const currentCaption = document.createElement("span");
  currentCaption.className = "status-label";
  currentCaption.textContent = "CURRENT ACTION";
  const currentActionText = document.createElement("strong");
  currentActionText.id = "pet-current-action";
  currentActionText.className = "pet-current-action";
  currentActionText.textContent = "—";
  currentRow.append(currentCaption, currentActionText);

  mount.insertBefore(statusRow, mount.firstChild);
  mount.insertBefore(currentRow, statusRow.nextSibling);

  let profile = null;
  let online = false;
  let busy = false;
  let nameDirty = false;
  let scaleDirty = false;
  let pollTimer;
  let actionButtons = new Map();
  let actionNames = new Map();
  let actionSignature = "";

  function statusCell(caption, id) {
    const root = document.createElement("div");
    const label = document.createElement("span");
    label.className = "status-label";
    label.textContent = caption;
    const value = document.createElement("strong");
    value.className = "pet-value";
    value.id = id;
    root.append(label, value);
    return { root, value };
  }

  function setStatus(message, kind) {
    panelStatus.textContent = message;
    panelStatus.classList.toggle("is-error", kind === "error");
    panelStatus.classList.toggle("is-ok", kind === "ok");
  }

  function setOnline(next) {
    online = next;
    statusCells.connection.value.textContent = next ? "LIVE · HOST" : "OFFLINE";
    syncDisabled();
  }

  function syncDisabled() {
    const disabled = !online || busy;
    saveButton.disabled = disabled;
    sayButton.disabled = disabled;
    for (const button of actionButtons.values()) button.disabled = disabled;
  }

  async function api(path, options) {
    const request = options ?? {};
    const response = await fetch(`${API_BASE}${path}`, {
      ...request,
      headers: {
        ...(request.body ? { "Content-Type": "application/json" } : {}),
        ...(request.headers ?? {}),
      },
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Host returned an unreadable response (${response.status}).`);
    }
    if (!response.ok) {
      const code = typeof payload?.error === "string" ? payload.error : `Host request failed (${response.status}).`;
      throw new Error(code);
    }
    return payload;
  }

  function formatScale(value) {
    return Number.isFinite(value) ? `${Math.round(value * 100) / 100}×` : "—";
  }

  function renderedName(actionId) {
    return actionNames.get(actionId) ?? actionId;
  }

  function renderActions(actions) {
    if (!Array.isArray(actions)) return;
    const signature = JSON.stringify(actions.map((action) => [action?.id, action?.displayName]));
    if (signature === actionSignature) return;
    actionSignature = signature;
    actionRow.replaceChildren();
    actionButtons = new Map();
    actionNames = new Map();
    for (const action of actions) {
      if (!action || typeof action.id !== "string") continue;
      const label = typeof action.displayName === "string" && action.displayName.length > 0
        ? action.displayName
        : action.id;
      const button = document.createElement("button");
      button.className = "pet-action";
      button.type = "button";
      button.dataset.action = action.id;
      button.textContent = label;
      button.addEventListener("click", () => void triggerAction(action.id));
      actionRow.append(button);
      actionButtons.set(action.id, button);
      actionNames.set(action.id, label);
    }
    actionsCount.textContent = `${actionButtons.size} available`;
    applyActiveAction(profile?.activeAction);
    syncDisabled();
  }

  function applyActiveAction(activeAction) {
    for (const [actionId, button] of actionButtons) {
      const isActive = actionId === activeAction;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    }
    currentActionText.textContent = typeof activeAction === "string" && actionNames.has(activeAction)
      ? renderedName(activeAction)
      : "—";
  }

  function renderProfile(next) {
    if (!next || typeof next !== "object") return;
    profile = next;
    statusCells.connection.value.textContent = "LIVE · HOST";
    statusCells.persona.value.textContent = typeof next.personaId === "string" ? next.personaId : "—";
    statusCells.home.value.textContent = next.homeGrantActive === true ? "Granted" : "Not granted";
    statusCells.home.value.classList.toggle("is-positive", next.homeGrantActive === true);
    renderActions(next.actions);
    applyActiveAction(next.activeAction);
    if (!nameDirty && document.activeElement !== nameInput && typeof next.name === "string") {
      nameInput.value = next.name;
    }
    if (!scaleDirty && document.activeElement !== scaleInput && Number.isFinite(next.scale)) {
      scaleInput.value = String(next.scale);
    }
    if (Number.isFinite(next.scale)) scaleHint.textContent = `${formatScale(next.scale)} · range ${SCALE_MIN}–${SCALE_MAX}`;
    setOnline(true);
  }

  async function refresh() {
    if (section.hidden) return;
    const wasOnline = online;
    try {
      const payload = await api("/pet");
      renderProfile(payload);
      // Routine polls stay silent; only a recovered connection rewrites the status.
      if (!wasOnline) setStatus("Connected · pet profile synced.", "ok");
    } catch (error) {
      setOnline(false);
      setStatus(`Host offline: ${error.message}`, "error");
    }
  }

  async function saveProfile() {
    if (busy || !online) return;
    const name = nameInput.value.trim();
    const scale = Number(scaleInput.value);
    if (name.length < NAME_MIN || name.length > NAME_MAX) {
      setStatus(`Name must be ${NAME_MIN}–${NAME_MAX} characters.`, "error");
      nameInput.focus();
      return;
    }
    if (!Number.isFinite(scale) || scale < SCALE_MIN || scale > SCALE_MAX) {
      setStatus(`Scale must be between ${SCALE_MIN} and ${SCALE_MAX}.`, "error");
      scaleInput.focus();
      return;
    }
    busy = true;
    syncDisabled();
    try {
      const payload = await api("/pet", { method: "POST", body: JSON.stringify({ name, scale }) });
      nameDirty = false;
      scaleDirty = false;
      renderProfile(payload);
      setStatus("Pet profile saved.", "ok");
    } catch (error) {
      setStatus(`Save failed: ${error.message}`, "error");
    } finally {
      busy = false;
      syncDisabled();
    }
  }

  async function triggerAction(actionId) {
    if (busy || !online) return;
    busy = true;
    syncDisabled();
    try {
      const payload = await api("/pet", { method: "POST", body: JSON.stringify({ action: actionId }) });
      renderProfile(payload);
      setStatus(`Action sent: ${renderedName(actionId)}.`, "ok");
    } catch (error) {
      setStatus(`Action failed: ${error.message}`, "error");
    } finally {
      busy = false;
      syncDisabled();
    }
  }

  async function say(event) {
    event.preventDefault();
    if (busy || !online) return;
    const text = sayInput.value.trim();
    if (!text) return;
    busy = true;
    syncDisabled();
    try {
      const payload = await api("/chat", { method: "POST", body: JSON.stringify({ text }) });
      if (typeof payload.reply !== "string") throw new Error("Host returned no chat reply.");
      reply.hidden = false;
      reply.textContent = payload.reply;
      sayInput.value = "";
      setStatus("Companion replied.", "ok");
    } catch (error) {
      setStatus(`Say failed: ${error.message}`, "error");
    } finally {
      busy = false;
      syncDisabled();
    }
  }

  nameInput.addEventListener("input", () => { nameDirty = true; });
  scaleInput.addEventListener("input", () => { scaleDirty = true; });
  saveButton.addEventListener("click", () => void saveProfile());
  sayForm.addEventListener("submit", (event) => void say(event));

  function startPolling() {
    if (pollTimer !== undefined) return;
    pollTimer = window.setInterval(() => void refresh(), POLL_MS);
    void refresh();
  }

  function stopPolling() {
    if (pollTimer === undefined) return;
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }

  function setVisible(visible) {
    section.hidden = !visible;
    if (visible) startPolling();
    else stopPolling();
  }

  // Host mode always enters Shared Core on load; follow the runtime switch so the panel
  // mirrors the rest of the page (app.js hides its chat panel in local mode the same way).
  const localModeButton = document.querySelector("#local-mode");
  const sharedModeButton = document.querySelector("#shared-mode");
  localModeButton?.addEventListener("click", () => setVisible(false));
  sharedModeButton?.addEventListener("click", () => {
    setVisible(true);
    setStatus("Connecting…");
    void refresh();
  });

  setVisible(true);
  syncDisabled();
}

function injectStyles() {
  if (document.querySelector("#pet-panel-styles")) return;
  const styles = document.createElement("style");
  styles.id = "pet-panel-styles";
  styles.textContent = `
.pet-section { grid-column: 1 / -1; padding-bottom: 18px; }
.pet-section .section-caption { margin-bottom: 10px; }
.pet-status-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 9px 0; border-top: 1px solid #293630; border-bottom: 1px solid #293630; }
.pet-status-row > div { min-width: 0; display: grid; gap: 5px; }
.pet-value { overflow-wrap: anywhere; color: #d6e2da; font-size: 9px; font-weight: 600; }
.pet-value.is-positive { color: #c8dfa9; }
.pet-current-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 8px 0 0; }
.pet-current-action { color: #e0edcf; font-size: 10px; font-weight: 650; }
.pet-field-grid { display: grid; grid-template-columns: minmax(0, 1fr) 92px; gap: 7px; margin-top: 10px; }
.pet-field { display: grid; gap: 5px; }
.pet-section input[type="text"], .pet-section input[type="number"] { width: 100%; min-height: 34px; padding: 0 10px; border: 1px solid #3a4941; border-radius: 2px; background: #121b17; color: #e1e9e3; font-size: 10px; }
.pet-section input::placeholder { color: #728078; }
.pet-save-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 7px; }
.pet-hint { color: #718078; font-size: 8px; font-variant-numeric: tabular-nums; }
.pet-save, .pet-say-send { height: 34px; padding: 0 12px; border: 1px solid #a9d17b; border-radius: 2px; background: #b4de83; color: #1b2718; font-size: 9px; font-weight: 650; cursor: pointer; }
.pet-save:hover:not(:disabled), .pet-say-send:hover:not(:disabled) { background: #c2e99a; }
.pet-save:disabled, .pet-say-send:disabled, .pet-action:disabled { opacity: .42; cursor: not-allowed; }
.pet-actions-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 11px 0 6px; }
.pet-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.pet-action { min-height: 30px; padding: 0 9px; border: 1px solid #46564d; border-radius: 2px; background: #17211c; color: #cfdbd3; font-size: 9px; font-weight: 600; cursor: pointer; }
.pet-action:hover:not(:disabled) { border-color: #718278; background: #1d2b24; }
.pet-action.is-active { border-color: #a9d17b; background: #25352a; color: #e0edcf; }
.pet-say-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; margin-top: 11px; }
.pet-reply { margin: 7px 0 0; padding: 8px; border: 1px solid #40543a; background: #1b2a1e; color: #dce6dd; font-size: 10px; line-height: 1.55; overflow-wrap: anywhere; }
.pet-status { margin: 8px 0 0; color: #91a097; font-size: 9px; line-height: 1.5; }
.pet-status.is-error { color: #f0bd8c; }
.pet-status.is-ok { color: #c8dfa9; }
`;
  document.head.append(styles);
}
