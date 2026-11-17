/**
 * Host half of the Fangcun world panel.
 *
 * Owns the local Fangcun Host process: probes `GET /api/health`, spawns
 * `node scripts/run-host.mjs` (cwd `D:/研一上/AR_MC`) only when nothing is
 * already listening, captures the startup pairing code from its stdout, keeps
 * it alive (one automatic restart), and terminates the process it started when
 * this plugin unloads. The state is exposed through the Host Service
 * `ctx.fangcunHost` and an authenticated Fetch-route surface under
 * `/api/fangcun-host/*` that the package's Client half calls.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const name = 'fangcun-dsh-plugin'
// The route surface is the only Client-facing transport, so the plugin needs the
// Connection service that owns authenticated exact Fetch routes.
export const inject = ['connection']

const DEFAULT_PORT = 8765
const DEFAULT_HOST_URL = `http://127.0.0.1:${DEFAULT_PORT}`
const DEFAULT_REPO_DIR = 'D:/研一上/AR_MC'
const HOST_ENTRY = 'scripts/run-host.mjs'
const API_PREFIX = '/api/fangcun-host'

const HEALTH_TIMEOUT_MS = 1200
const READ_TIMEOUT_MS = 2500
const START_HEALTH_TIMEOUT_MS = 25000
const START_POLL_MS = 300
const RESTART_DELAY_MS = 1200
const MAX_RESTARTS = 1
const FULL_REFRESH_MIN_INTERVAL_MS = 4000
const KILL_GRACE_MS = 3000
const MAX_MESSAGES = 8
const MAX_CHAT_TEXT = 500
const MAX_COMPANIONS = 12
const SOCIAL_CACHE_MS = 1500
const ISLAND_CACHE_MS = 10000
const ISLAND_PREFLIGHT_TIMEOUT_MS = 2000
const ISLAND_URL = 'http://127.0.0.1:4173/?mode=host'

/** Local client asset target for an imported companion model (never committed). */
const MODEL_TARGET_SUBDIR = 'apps/android-ar-poc/app/src/main/assets/models/companion'
const MODEL_MAX_BYTES = 64 * 1024 * 1024
/** Pet-settings bounds shared with the Host's validators. */
const PET_NAME_MAX_LENGTH = 24
const PET_PERSONALITY_MAX_LENGTH = 60
const PET_SCALE_MIN = 0.5
const PET_SCALE_MAX = 3
// Host decodes the data URL and caps the image at 64 KiB; allow the base64
// envelope (~87 KiB) plus headroom and let the Host's own validation speak.
const AVATAR_IMAGE_MAX_CHARS = 200_000
const COMPANION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/
const GLB_MAGIC = [0x67, 0x6c, 0x54, 0x46] // 'glTF' little-endian uint32 0x46546C67
const MODEL_REBUILD_COMMAND = 'cd apps/android-ar-poc && gradle assembleDebug'

const PAIRING_LINE = /pairing code[^:\n]*:\s*([A-Za-z0-9]{4,20})/

const delay = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** A failure the route layer maps to an HTTP status. */
class FangcunError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function errorJson(error) {
  const status = error instanceof FangcunError ? error.status
    : (typeof error?.status === 'number' ? error.status : 500)
  return json({
    ok: false,
    error: {
      code: error?.code ?? 'internal_error',
      message: error?.message ?? String(error),
    },
  }, status)
}

async function readJsonBody(request) {
  const text = await request.text()
  if (!text || !text.trim()) return {}
  let value
  try {
    value = JSON.parse(text)
  } catch {
    throw new FangcunError('invalid_json', 'request body is not valid JSON')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new FangcunError('invalid_body', 'request body must be a JSON object')
  }
  return value
}

/**
 * The Host Service behind the panel: one owner of the Fangcun Host process and
 * of the cached world snapshot the Client half renders.
 */
class FangcunHostService {
  #hostUrl
  #repoDir
  #port
  #manualCommand

  #status = 'stopped'
  #managed = false
  #pid = null
  #revision = null
  #blockCount = null
  #worldId = null
  #companionState = null
  #pairingCode = null
  #pairingCodeIssuedAtMs = null
  #lastError = null
  #healthError = null
  #spawnFailed = false
  #restarts = 0
  #messages = []
  #checkedAtMs = null

  #child = null
  #stdoutBuf = ''
  #stderrTail = ''
  #restartTimer = null
  #syncChain = Promise.resolve()
  #lastFullRefreshAt = 0
  #disposing = false
  #socialCache = { key: null, at: 0, value: null }
  #islandCache = { at: 0, value: null }

  constructor({ hostUrl = DEFAULT_HOST_URL, repoDir = DEFAULT_REPO_DIR, port = DEFAULT_PORT } = {}) {
    this.#hostUrl = hostUrl
    this.#repoDir = repoDir
    this.#port = port
    this.#manualCommand = `cd "${repoDir}" then run: node ${HOST_ENTRY}`
  }

  get hostUrl() { return this.#hostUrl }
  get repoDir() { return this.#repoDir }

  /** Immutable view of everything the panel shows. */
  snapshot() {
    return {
      status: this.#status,
      managed: this.#managed,
      pid: this.#pid,
      revision: this.#revision,
      blockCount: this.#blockCount,
      worldId: this.#worldId,
      companionState: this.#companionState,
      pairingCode: this.#pairingCode,
      pairingCodeIssuedAtMs: this.#pairingCodeIssuedAtMs,
      hostUrl: this.#hostUrl,
      port: this.#port,
      repoDir: this.#repoDir,
      manualCommand: this.#manualCommand,
      restarts: this.#restarts,
      maxRestarts: MAX_RESTARTS,
      spawnFailed: this.#spawnFailed,
      lastError: this.#lastError,
      healthError: this.#healthError,
      stderrTail: this.#stderrTail || null,
      messages: this.#messages.slice(-MAX_MESSAGES),
      checkedAtMs: this.#checkedAtMs,
    }
  }

  /** Activation path: adopt an already-listening Host, otherwise start one. */
  async bootstrap() {
    const health = await this.#probe()
    if (health.ok) {
      this.#applyHealth(health)
      await this.refresh({ full: true }).catch(() => this.snapshot())
      return this.snapshot()
    }
    return this.start()
  }

  /** Probe the Host and (optionally) refresh world + chat. */
  refresh({ full = true } = {}) {
    const run = () => this.#syncOnce(full)
    const next = this.#syncChain.then(run, run)
    this.#syncChain = next.then(() => undefined, () => undefined)
    return next
  }

  /** Start the Host unless one is already listening; never spawns a duplicate. */
  async start() {
    if (this.#child) {
      await this.#waitHealthy(1500)
      return this.snapshot()
    }
    const health = await this.#probe()
    if (health.ok) {
      this.#managed = false
      this.#spawnFailed = false
      this.#applyHealth(health)
      await this.refresh({ full: true }).catch(() => this.snapshot())
      return this.snapshot()
    }
    this.#restarts = 0
    this.#spawnHost()
    return this.snapshot()
  }

  /** One companion chat turn through the Host's local core API. */
  async chat(rawText, companionId) {
    const text = typeof rawText === 'string' ? rawText.trim() : ''
    if (!text) throw new FangcunError('invalid_chat_text', 'chat text must not be empty')
    if (text.length > MAX_CHAT_TEXT) {
      throw new FangcunError('invalid_chat_text', `chat text must be at most ${MAX_CHAT_TEXT} characters`)
    }
    await this.#ensureRunning()
    const target = typeof companionId === 'string' && companionId ? companionId : null
    const body = target === null
      ? await this.#requestJson('POST', '/api/core/chat', { text })
      : await this.#requestJson('POST', '/api/core/chat', { companionId: target, text })
    this.#applyWorld(body?.state?.world)
    this.#socialCache.at = 0
    const transcript = await this.#readChatFor(target).catch(() => null)
    if (transcript?.available) this.#messages = transcript.messages.slice(-MAX_MESSAGES)
    else await this.#readChat().catch(() => {})
    return {
      reply: typeof body?.reply === 'string' ? body.reply : '',
      companionId: target,
      messages: this.#messages.slice(-MAX_MESSAGES),
      snapshot: this.snapshot(),
    }
  }

  /** One companion build tick. */
  async tick() {
    await this.#ensureRunning()
    const body = await this.#requestJson('POST', '/api/core/companion/tick')
    this.#applyWorld(body?.world)
    this.#socialCache.at = 0
    await this.#readChat().catch(() => {})
    return { result: body?.result ?? null, snapshot: this.snapshot() }
  }

  /**
   * The social messenger payload: every companion (with its latest say), the
   * user's inventory, the selected companion's transcript, and the host status.
   * Missing Companion/Inventory endpoints degrade to `available: false` plus a
   * single-companion fallback built from `/api/core/state` + `/api/core/pet`, so
   * the panel stays usable while the Host side lands those endpoints.
   */
  async social({ companionId = null, force = false } = {}) {
    await this.#ensureRunning()
    if (this.#status !== 'running') {
      throw new FangcunError('host_not_running', this.#healthError ?? 'Fangcun Host is not reachable', 503)
    }
    const selected = typeof companionId === 'string' && companionId ? companionId : null
    const cacheKey = selected ?? ''
    const now = Date.now()
    if (!force && this.#socialCache.key === cacheKey && now - this.#socialCache.at < SOCIAL_CACHE_MS) {
      return this.#socialCache.value
    }

    const snapshot = await this.refresh({ full: false })
    const [stateResult, petResult, companionsResult, inventoryResult, itemsResult] = await Promise.all([
      this.#hostGet('/api/core/state'),
      this.#hostGet('/api/core/pet'),
      this.#hostGet('/api/core/companions'),
      this.#hostGet('/api/core/inventory'),
      this.#hostGet('/api/core/items'),
    ])

    const state = stateResult.ok ? stateResult.payload : null
    // The console reads revision/block count from this same snapshot: apply the
    // state payload's world so a reset (or any external change) is visible
    // immediately instead of waiting for the next full refresh.
    if (state?.world) this.#applyWorld(state.world)
    const ownerUserId = typeof state?.ownerUserId === 'string' ? state.ownerUserId : null
    const pet = petResult.ok ? petResult.payload : null
    const companionsAvailable = companionsResult.ok
    const inventoryAvailable = inventoryResult.ok
    // Display text for items lives only in the Host's catalog (never on the
    // inventory wire): inventory rows carry ids + counts, companion bags ids.
    const catalog = new Map()
    for (const entry of this.#itemsFrom(itemsResult.ok ? itemsResult.payload : null)) {
      catalog.set(entry.itemId, entry)
    }
    const resolveItem = (raw) => {
      const item = normalizeItem(raw)
      if (!item) return null
      const known = catalog.get(item.itemId)
      return {
        itemId: item.itemId,
        name: known?.name ?? item.name,
        icon: item.icon ?? known?.icon ?? null,
        description: item.description ?? known?.description ?? null,
        count: item.count,
      }
    }
    const inventory = inventoryAvailable
      ? this.#itemsFrom(inventoryResult.payload).map(resolveItem).filter(Boolean)
      : []

    let companions = []
    if (companionsAvailable) {
      const rawList = Array.isArray(companionsResult.payload)
        ? companionsResult.payload
        : (Array.isArray(companionsResult.payload?.companions) ? companionsResult.payload.companions : [])
      companions = rawList
        .slice(0, MAX_COMPANIONS)
        .map((raw) => normalizeCompanion(raw))
        .filter(Boolean)
        .map((companion) => ({
          ...companion,
          isMine: ownerUserId === null ? companion.isMine : companion.ownerUserId === ownerUserId,
          activeAction: companion.activeAction ?? (companion.isMine ? pet?.activeAction ?? null : null),
          personaId: companion.personaId ?? (companion.isMine ? pet?.personaId ?? null : null),
          avatarModelId: companion.avatarModelId ?? (companion.isMine ? pet?.personaId ?? null : null),
          items: companion.items.map(resolveItem).filter(Boolean),
        }))
    } else if (state?.companion && typeof state.companion === 'object') {
      // Single-companion fallback for a Host that predates the companions API.
      const raw = state.companion
      const fallback = normalizeCompanion({
        ...raw,
        name: pet?.name ?? raw.name,
        personaId: pet?.personaId ?? raw.personaId,
        activeAction: pet?.activeAction ?? null,
        items: [],
        isMine: true,
      })
      if (fallback) {
        fallback.isMine = ownerUserId === null ? true : fallback.ownerUserId === ownerUserId
        companions = [fallback]
      }
    }

    const effectiveSelected = selected && companions.some((c) => c.companionId === selected)
      ? selected
      : companions[0]?.companionId ?? null

    // With the companions API the transcript is per companion; without it the
    // Host only has the single global chat log, so read that instead of asking
    // for an id-scoped chat the Host would answer with 404.
    let transcript
    if (effectiveSelected === null) {
      transcript = { available: false, companionId: null, messages: [], reason: 'no_companion' }
    } else if (companionsAvailable) {
      transcript = await this.#readChatFor(effectiveSelected)
        .catch(() => ({ available: false, companionId: effectiveSelected, messages: [], reason: 'chat_unavailable' }))
    } else {
      transcript = await this.#readChatFor(null)
        .catch(() => ({ available: false, companionId: null, messages: [], reason: 'chat_unavailable' }))
      transcript = { ...transcript, companionId: effectiveSelected }
    }

    const lastMessages = new Map()
    await Promise.all(companions.map(async (companion) => {
      if (companion.companionId === effectiveSelected && transcript.available) {
        lastMessages.set(companion.companionId, transcript.messages.at(-1) ?? null)
        return
      }
      if (!companionsAvailable) {
        // Legacy mode: every row shares the one global log.
        lastMessages.set(companion.companionId, transcript.available ? (transcript.messages.at(-1) ?? null) : null)
        return
      }
      const chat = await this.#readChatFor(companion.companionId).catch(() => null)
      lastMessages.set(companion.companionId, chat?.available ? (chat.messages.at(-1) ?? null) : null)
    }))

    const value = {
      ok: true,
      host: snapshot,
      available: companionsAvailable,
      inventoryAvailable,
      reason: companionsAvailable ? null : (companionsResult.error ?? 'companions_unavailable'),
      legacyChat: !companionsAvailable,
      pet: pet && typeof pet === 'object'
        ? {
            name: typeof pet.name === 'string' ? pet.name : null,
            personaId: typeof pet.personaId === 'string' ? pet.personaId : null,
            scale: typeof pet.scale === 'number' ? pet.scale : null,
            activeAction: typeof pet.activeAction === 'string' ? pet.activeAction : null,
            companionId: typeof pet.companionId === 'string' ? pet.companionId : null,
            actions: Array.isArray(pet.actions)
              ? pet.actions.filter((action) => action && typeof action.id === 'string').map((action) => ({
                  id: action.id,
                  displayName: typeof action.displayName === 'string' ? action.displayName : action.id,
                }))
              : [],
          }
        : null,
      companions: companions.map((companion) => ({
        ...companion,
        lastMessage: lastMessages.get(companion.companionId) ?? null,
      })),
      inventory,
      selectedCompanionId: effectiveSelected,
      // Live companion/build state the console tab renders (house proposal waits
      // for the owner's decision; the build summary drives the demo progress).
      live: {
        companionState: typeof state?.companionState === 'string' ? state.companionState : null,
        houseProposal: normalizeHouseProposal(state?.houseProposal),
        build: normalizeBuild(state?.build),
      },
      primaryCompanionId: typeof pet?.companionId === 'string' && pet.companionId
        ? pet.companionId
        : (typeof state?.companion?.companionId === 'string' ? state.companion.companionId : null),
      transcript: {
        available: transcript.available,
        companionId: transcript.companionId ?? effectiveSelected,
        messages: transcript.messages.slice(-MAX_MESSAGES),
        reason: transcript.reason ?? null,
      },
      fetchedAtMs: now,
    }
    this.#socialCache = { key: cacheKey, at: now, value }
    return value
  }

  /** Give one owned item to one companion the user owns. */
  async give(companionId, itemId) {
    if (typeof companionId !== 'string' || !companionId) {
      throw new FangcunError('invalid_companion', 'companionId is required')
    }
    if (typeof itemId !== 'string' || !itemId) {
      throw new FangcunError('invalid_item', 'itemId is required')
    }
    await this.#ensureRunning()
    const result = await this.#hostPost('/api/core/inventory/give', { companionId, itemId })
    if (result.ok) {
      this.#socialCache.at = 0
      return { companionId, itemId }
    }
    const code = typeof result.error === 'string' && result.error ? result.error : 'give_failed'
    // A missing endpoint answers generic 404 `not_found`; any other 4xx is the
    // Host's real refusal and is forwarded with its code and status.
    if (result.status === 404 && code === 'not_found') {
      throw new FangcunError('social_unavailable', 'Host does not expose /api/core/inventory/give yet', 503)
    }
    const messages = {
      companion_inventory_full: 'companion inventory is full',
      item_not_owned: 'item is not in the user inventory',
      item_already_held: 'the companion already holds this item',
      unknown_item: 'unknown item id',
      companion_not_found: 'unknown companion',
      not_owner: 'companion belongs to another user',
      invalid_companion: 'unknown companion',
      invalid_item: 'unknown item',
      invalid_give_request: 'malformed give request',
    }
    const status = result.status >= 400 && result.status < 500 ? result.status : 409
    throw new FangcunError(code, messages[code] ?? code, status)
  }

  /**
   * Persist the imported thumbnail as the companion's avatar through the Host's
   * companion PATCH. The Host field is being extended concurrently: until it
   * lands, its `unknown_companion_field` rejection is reported as
   * `avatar_unsupported` so the panel can say so honestly.
   */
  async setAvatar(companionId, avatarImage) {
    if (typeof companionId !== 'string' || !COMPANION_ID_PATTERN.test(companionId)) {
      throw new FangcunError('invalid_companion', 'companionId is invalid')
    }
    if (typeof avatarImage !== 'string' || !avatarImage) {
      throw new FangcunError('invalid_avatar', 'avatarImage is required')
    }
    if (avatarImage.length > AVATAR_IMAGE_MAX_CHARS) {
      throw new FangcunError('avatar_too_large', `avatarImage must be at most ${AVATAR_IMAGE_MAX_CHARS} characters`, 413)
    }
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(avatarImage)) {
      throw new FangcunError('invalid_avatar', 'avatarImage must be a base64 data URL of a PNG/JPEG/WebP image')
    }
    await this.#ensureRunning()
    const result = await this.#hostPatch(`/api/core/companions/${encodeURIComponent(companionId)}`, { avatarImage })
    if (result.ok) {
      this.#socialCache.at = 0
      return { companionId, companion: result.payload ?? null }
    }
    const code = typeof result.error === 'string' && result.error ? result.error : 'avatar_failed'
    if (result.status === 404 && code === 'not_found') {
      throw new FangcunError('social_unavailable', 'Host does not expose the companion patch route yet', 503)
    }
    if (code === 'unknown_companion_field' || code === 'invalid_companion_request') {
      throw new FangcunError('avatar_unsupported', 'Host does not accept avatarImage yet', 503)
    }
    const status = result.status >= 400 && result.status < 500 ? result.status : 409
    throw new FangcunError(code, `avatar update refused: ${code}`, status)
  }

  /**
   * Store an imported model file into the Android client's companion asset dir.
   * The bytes never enter the panel bundle, the repo history or the Host store:
   * they are written to the local build asset path and must be rebuilt into an
   * APK to take effect on the tablet.
   */
  async installModel(companionId, bytes) {
    if (typeof companionId !== 'string' || !COMPANION_ID_PATTERN.test(companionId)) {
      throw new FangcunError('invalid_companion', 'companionId is invalid')
    }
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new FangcunError('invalid_model', 'model body is empty')
    }
    if (bytes.byteLength > MODEL_MAX_BYTES) {
      throw new FangcunError('model_too_large', `model must be at most ${MODEL_MAX_BYTES} bytes`, 413)
    }
    if (!GLB_MAGIC.every((byte, index) => bytes[index] === byte)) {
      throw new FangcunError('invalid_model_container', 'model is not a GLB/VRM container (glTF magic missing)')
    }
    await this.#ensureRunning()
    const companionsResult = await this.#hostGet('/api/core/companions')
    if (companionsResult.ok) {
      const list = Array.isArray(companionsResult.payload)
        ? companionsResult.payload
        : (Array.isArray(companionsResult.payload?.companions) ? companionsResult.payload.companions : [])
      const target = list.find((row) => row?.companionId === companionId)
      if (!target) throw new FangcunError('companion_not_found', 'unknown companion', 404)
      if (target.isMine === false) throw new FangcunError('not_owner', 'companion belongs to another user', 403)
    }

    const targetDir = join(this.#repoDir, MODEL_TARGET_SUBDIR)
    const fileName = `${companionId}.vrm`
    const absolutePath = join(targetDir, fileName)
    try {
      mkdirSync(targetDir, { recursive: true })
      writeFileSync(absolutePath, bytes)
    } catch (error) {
      throw new FangcunError('model_write_failed', error?.message ?? String(error), 500)
    }
    return {
      stored: true,
      companionId,
      path: `${MODEL_TARGET_SUBDIR}/${fileName}`,
      bytes: bytes.byteLength,
      needsRebuild: true,
      command: MODEL_REBUILD_COMMAND,
    }
  }

  /**
   * Save the selected companion's pet settings. Name/personality travel on the
   * companion PATCH (they belong to the profile); scale/action travel on the pet
   * PATCH (the pet row is primary-companion scoped). Local bounds mirror the
   * Host's validators so the panel reports the same codes without a round trip.
   */
  async updatePetSettings({ companionId, name, personality, scale, action } = {}) {
    if (typeof companionId !== 'string' || !COMPANION_ID_PATTERN.test(companionId)) {
      throw new FangcunError('invalid_companion', 'companionId is invalid')
    }
    const companionPatch = {}
    if (name !== undefined) {
      const trimmed = typeof name === 'string' ? name.trim() : ''
      if (trimmed.length < 1 || trimmed.length > PET_NAME_MAX_LENGTH) {
        throw new FangcunError('invalid_pet_name', `name must be 1..${PET_NAME_MAX_LENGTH} characters`)
      }
      companionPatch.name = trimmed
    }
    if (personality !== undefined) {
      const trimmed = typeof personality === 'string' ? personality.trim() : ''
      if (trimmed.length < 1 || trimmed.length > PET_PERSONALITY_MAX_LENGTH) {
        throw new FangcunError('invalid_pet_personality', `personality must be 1..${PET_PERSONALITY_MAX_LENGTH} characters`)
      }
      companionPatch.personality = trimmed
    }
    const petPatch = {}
    if (scale !== undefined) {
      const value = typeof scale === 'number' ? scale : Number(scale)
      if (!Number.isFinite(value) || value < PET_SCALE_MIN || value > PET_SCALE_MAX) {
        throw new FangcunError('invalid_pet_scale', `scale must be between ${PET_SCALE_MIN} and ${PET_SCALE_MAX}`)
      }
      petPatch.scale = value
    }
    if (action !== undefined) {
      if (typeof action !== 'string' || !action) {
        throw new FangcunError('unknown_pet_action', 'action id is required')
      }
      petPatch.action = action
    }
    if (Object.keys(companionPatch).length === 0 && Object.keys(petPatch).length === 0) {
      throw new FangcunError('invalid_pet_request', 'nothing to save')
    }
    await this.#ensureRunning()
    const result = {}
    if (Object.keys(companionPatch).length > 0) {
      const response = await this.#hostPatch(`/api/core/companions/${encodeURIComponent(companionId)}`, companionPatch)
      if (!response.ok) {
        const code = typeof response.error === 'string' && response.error ? response.error : 'companion_patch_failed'
        const status = response.status >= 400 && response.status < 500 ? response.status : 409
        throw new FangcunError(code, `companion update refused: ${code}`, status)
      }
      result.companion = response.payload ?? null
    }
    if (Object.keys(petPatch).length > 0) {
      const response = await this.#hostPatch('/api/core/pet', petPatch)
      if (!response.ok) {
        const code = typeof response.error === 'string' && response.error ? response.error : 'pet_patch_failed'
        const status = response.status >= 400 && response.status < 500 ? response.status : 409
        throw new FangcunError(code, `pet update refused: ${code}`, status)
      }
      result.pet = response.payload ?? null
    }
    this.#socialCache.at = 0
    return result
  }

  /**
   * Start one of the scripted demos. Both endpoints are being added by the
   * pet-config work: a generic 404 means "not enabled yet" and is reported as
   * `demo_unavailable` so the panel can say so instead of failing. A refusal
   * (`build_in_progress`, `grant_missing`, …) keeps the Host's code and status.
   */
  async runDemo(flow) {
    if (flow !== 'lazy-house' && flow !== 'real-house') {
      throw new FangcunError('invalid_demo', 'unknown demo flow')
    }
    await this.#ensureRunning()
    if (this.#status !== 'running') {
      throw new FangcunError('host_not_running', this.#healthError ?? 'Fangcun Host is not reachable', 503)
    }
    const result = await this.#hostPost(`/api/core/demo/${flow}`, {})
    if (result.ok) {
      this.#socialCache.at = 0
      const payload = result.payload && typeof result.payload === 'object' ? result.payload : {}
      const state = typeof payload.state === 'string'
        ? payload.state
        : (typeof payload.status === 'string' ? payload.status : 'started')
      const proposalId = typeof payload.proposalId === 'string' ? payload.proposalId : null
      return {
        flow,
        state: flow === 'real-house' && proposalId !== null && state === 'started' ? 'awaiting' : state,
        jobId: typeof payload.jobId === 'string' ? payload.jobId : null,
        proposalId,
        planBlockCount: typeof payload.planBlockCount === 'number' ? payload.planBlockCount : null,
        message: typeof payload.message === 'string' ? payload.message : null,
        raw: payload,
      }
    }
    const code = typeof result.error === 'string' && result.error ? result.error : 'demo_failed'
    if (result.status === 404 && code === 'not_found') {
      throw new FangcunError('demo_unavailable', `Host does not expose /api/core/demo/${flow} yet`, 503)
    }
    const status = result.status >= 400 && result.status < 500 ? result.status : 502
    throw new FangcunError(code, `${flow} demo refused: ${code}`, status)
  }

  /**
   * Reset the world to the seed snapshot through the demo endpoint. This is the
   * only destructive action the panel exposes, and it is always confirmed twice
   * in the UI. The Host closes its WebSocket sessions on reset (tablets reconnect
   * automatically); the returned counts come from a fresh read after the reset.
   */
  async resetWorld() {
    await this.#ensureRunning()
    if (this.#status !== 'running') {
      throw new FangcunError('host_not_running', this.#healthError ?? 'Fangcun Host is not reachable', 503)
    }
    const result = await this.#hostPost('/api/core/demo/reset-world', {})
    if (!result.ok) {
      const code = typeof result.error === 'string' && result.error ? result.error : 'reset_failed'
      if (result.status === 404 && code === 'not_found') {
        throw new FangcunError('demo_unavailable', 'Host does not expose /api/core/demo/reset-world yet', 503)
      }
      const status = result.status >= 400 && result.status < 500 ? result.status : 502
      throw new FangcunError(code, `world reset refused: ${code}`, status)
    }
    this.#socialCache.at = 0
    this.#lastFullRefreshAt = 0
    // A fresh read is authoritative about the post-reset revision/block count.
    const state = await this.#hostGet('/api/core/state').catch(() => null)
    const world = state?.ok ? state.payload?.world : null
    const blocks = Array.isArray(world?.blocks) ? world.blocks : []
    const blockCount = blocks.reduce((count, block) => (block === null || block === undefined ? count : count + 1), 0)
    const rev = typeof world?.rev === 'number'
      ? world.rev
      : (typeof result.payload?.rev === 'number' ? result.payload.rev : null)
    if (typeof rev === 'number') this.#revision = rev
    if (world) this.#blockCount = blockCount
    return {
      rev,
      blockCount: world ? blockCount : null,
      worldId: typeof world?.worldId === 'string' ? world.worldId : null,
      raw: result.payload ?? null,
    }
  }

  /**
   * Answer the companion's pending house proposal — the same decision the tablet
   * sends. Whichever surface answers first wins; the other sees
   * `proposal_not_found` / `proposal_expired`, which the panel reports as handled.
   */
  async decideHouse(proposalId, approve) {
    if (typeof proposalId !== 'string' || !proposalId) {
      throw new FangcunError('invalid_house_decision', 'proposalId is required')
    }
    if (typeof approve !== 'boolean') {
      throw new FangcunError('invalid_house_decision', 'approve must be a boolean')
    }
    await this.#ensureRunning()
    if (this.#status !== 'running') {
      throw new FangcunError('host_not_running', this.#healthError ?? 'Fangcun Host is not reachable', 503)
    }
    const result = await this.#hostPost('/api/core/house/decide', { proposalId, approve })
    if (result.ok) {
      this.#socialCache.at = 0
      return {
        approved: result.payload?.approved === true,
        proposalId,
        planBlockCount: typeof result.payload?.planBlockCount === 'number' ? result.payload.planBlockCount : null,
      }
    }
    const code = typeof result.error === 'string' && result.error ? result.error : 'house_decision_failed'
    if (result.status === 404 && code === 'not_found') {
      throw new FangcunError('house_unavailable', 'Host does not expose /api/core/house/decide yet', 503)
    }
    const status = result.status >= 400 && result.status < 500 ? result.status : 409
    throw new FangcunError(code, `house decision refused: ${code}`, status)
  }

  /** Preflight the island console so the panel can decide before framing it. */
  async island() {
    const now = Date.now()
    if (now - this.#islandCache.at < ISLAND_CACHE_MS && this.#islandCache.value) {
      return this.#islandCache.value
    }
    let value
    try {
      const response = await fetch(ISLAND_URL, {
        method: 'GET',
        signal: AbortSignal.timeout(ISLAND_PREFLIGHT_TIMEOUT_MS),
        cache: 'no-store',
      })
      const headers = response.headers
      const xfo = headers.get('x-frame-options')
      const csp = headers.get('content-security-policy') ?? ''
      const frameAncestors = /frame-ancestors([^;]*)/i.exec(csp)?.[1]?.trim() ?? null
      const blockedByXfo = xfo !== null && !/^allowall$/i.test(xfo.trim())
      const blockedByCsp = frameAncestors !== null && !/(\*|127\.0\.0\.1|localhost)/i.test(frameAncestors)
      const reasons = []
      if (!response.ok) reasons.push(`console answered HTTP ${response.status}`)
      if (blockedByXfo) reasons.push(`x-frame-options: ${xfo}`)
      if (blockedByCsp) reasons.push(`frame-ancestors: ${frameAncestors}`)
      value = {
        ok: true,
        url: ISLAND_URL,
        reachable: response.ok,
        status: response.status,
        contentType: headers.get('content-type'),
        embeddable: response.ok && !blockedByXfo && !blockedByCsp,
        reasons,
        checkedAtMs: now,
      }
    } catch (error) {
      value = {
        ok: true,
        url: ISLAND_URL,
        reachable: false,
        status: 0,
        contentType: null,
        embeddable: false,
        reasons: [error?.name === 'TimeoutError' ? 'console preflight timed out' : (error?.message ?? String(error))],
        checkedAtMs: now,
      }
    }
    this.#islandCache = { at: now, value }
    return value
  }

  /** Terminate the process this plugin started; never touch an external Host. */
  async dispose() {
    this.#disposing = true
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = null
    }
    this.#pairingCode = null
    this.#pairingCodeIssuedAtMs = null
    const child = this.#child
    if (!child) {
      this.#status = 'stopped'
      return
    }
    this.#child = null
    this.#pid = null
    const exited = new Promise((resolve) => {
      let settled = false
      const done = () => { if (!settled) { settled = true; resolve() } }
      child.once('exit', done)
      setTimeout(done, KILL_GRACE_MS)
    })
    try {
      child.kill()
    } catch {
      // already gone
    }
    await exited
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
    }
    this.#status = 'stopped'
  }

  // ---------------------------------------------------------------- internals

  async #syncOnce(full) {
    const health = await this.#probe()
    const now = Date.now()
    if (health.ok) {
      this.#applyHealth(health)
      this.#healthError = null
      if (full && now - this.#lastFullRefreshAt >= FULL_REFRESH_MIN_INTERVAL_MS) {
        this.#lastFullRefreshAt = now
        await Promise.all([
          this.#readCore().catch(() => {}),
          this.#readChat().catch(() => {}),
        ])
      }
    } else {
      this.#healthError = health.error
      if (this.#status === 'running') {
        this.#status = this.#child ? 'starting' : 'stopped'
      } else if (this.#child || this.#restartTimer) {
        // A pending automatic restart is still "starting", not "stopped".
        this.#status = 'starting'
      } else {
        this.#status = 'stopped'
      }
    }
    this.#checkedAtMs = now
    return this.snapshot()
  }

  #applyHealth(health) {
    this.#status = 'running'
    if (typeof health.rev === 'number') this.#revision = health.rev
    if (typeof health.worldId === 'string') this.#worldId = health.worldId
  }

  #applyWorld(world) {
    if (!world || typeof world !== 'object') return
    if (typeof world.rev === 'number') this.#revision = world.rev
    if (typeof world.worldId === 'string') this.#worldId = world.worldId
    if (Array.isArray(world.blocks)) {
      let count = 0
      for (const block of world.blocks) if (block !== null && block !== undefined) count += 1
      this.#blockCount = count
    }
  }

  async #probe() {
    try {
      const response = await fetch(`${this.#hostUrl}/api/health`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        cache: 'no-store',
      })
      if (!response.ok) return { ok: false, error: `health endpoint answered HTTP ${response.status}` }
      const body = await response.json()
      if (body?.ok !== true) return { ok: false, error: 'health endpoint reported not ok' }
      return {
        ok: true,
        rev: typeof body.rev === 'number' ? body.rev : null,
        worldId: typeof body.worldId === 'string' ? body.worldId : null,
      }
    } catch (error) {
      const message = error?.name === 'TimeoutError'
        ? 'health check timed out'
        : (error?.message ?? String(error))
      return { ok: false, error: message }
    }
  }

  /**
   * Probe once when the cached status is not `running`, so a panel opened after a
   * Host restart (or an HMR reload) heals before the first action instead of
   * reporting a stale stopped state.
   */
  async #ensureRunning() {
    if (this.#status === 'running') return true
    await this.refresh({ full: false }).catch(() => {})
    return this.#status === 'running'
  }

  async #requestJson(method, path, body) {
    if (this.#status !== 'running') {
      throw new FangcunError(
        'host_not_running',
        this.#healthError ?? 'Fangcun Host is not reachable',
        503,
      )
    }
    let response
    try {
      response = await fetch(`${this.#hostUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (error) {
      throw new FangcunError('host_unreachable', error?.message ?? String(error), 503)
    }
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const message = payload?.error ? String(payload.error) : `Host answered HTTP ${response.status}`
      throw new FangcunError('host_rejected', message, response.status === 400 ? 400 : 502)
    }
    return payload
  }

  async #readCore() {
    const state = await this.#requestJson('GET', '/api/core/state')
    this.#applyWorld(state?.world)
    this.#companionState = state?.companion?.state ?? null
  }

  async #readChat() {
    const body = await this.#requestJson('GET', '/api/core/chat')
    const messages = Array.isArray(body?.messages) ? body.messages : []
    this.#messages = messages
      .filter((message) => message && typeof message.text === 'string')
      .slice(-MAX_MESSAGES)
      .map((message) => ({
        role: message.role === 'user' ? 'user' : 'companion',
        text: message.text,
        atMs: typeof message.atMs === 'number' ? message.atMs : null,
      }))
  }

  /**
   * One optional Host read. Never throws: an endpoint that is not mounted yet
   * comes back as `{ ok: false, status: 404 }` so the caller can degrade.
   */
  async #hostGet(path) {
    let response
    try {
      response = await fetch(`${this.#hostUrl}${path}`, {
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (error) {
      return { ok: false, status: 0, error: error?.message ?? String(error), payload: null }
    }
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: typeof payload?.error === 'string' ? payload.error : `http_${response.status}`,
        payload,
      }
    }
    return { ok: true, status: response.status, payload }
  }

  /** One optional Host write with the same non-throwing contract as #hostGet. */
  async #hostPost(path, body) {
    return this.#hostWrite('POST', path, body)
  }

  /** One optional Host PATCH (companion profile/avatar updates). */
  async #hostPatch(path, body) {
    return this.#hostWrite('PATCH', path, body)
  }

  async #hostWrite(method, path, body) {
    let response
    try {
      response = await fetch(`${this.#hostUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        cache: 'no-store',
      })
    } catch (error) {
      return { ok: false, status: 0, error: error?.message ?? String(error), payload: null }
    }
    let payload = null
    try {
      payload = await response.json()
    } catch {
      payload = null
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: typeof payload?.error === 'string' ? payload.error : `http_${response.status}`,
        payload,
      }
    }
    return { ok: true, status: response.status, payload }
  }

  /** The transcript of one companion, or of the single shared chat when id-less. */
  async #readChatFor(companionId) {
    const query = typeof companionId === 'string' && companionId
      ? `?companionId=${encodeURIComponent(companionId)}`
      : ''
    const result = await this.#hostGet(`/api/core/chat${query}`)
    if (!result.ok) {
      return { available: false, companionId: companionId ?? null, messages: [], reason: result.error ?? `http_${result.status}` }
    }
    const raw = Array.isArray(result.payload?.messages) ? result.payload.messages : []
    return {
      available: true,
      companionId: companionId ?? null,
      messages: raw.map(normalizeMessage).filter(Boolean),
      reason: null,
    }
  }

  /** Inventory/catalog rows from either `{ items: [] }` or a bare array. */
  #itemsFrom(payload) {
    const raw = Array.isArray(payload) ? payload : (Array.isArray(payload?.items) ? payload.items : [])
    return raw.map(normalizeItem).filter(Boolean)
  }

  #spawnHost() {
    if (this.#disposing) return
    this.#status = 'starting'
    this.#managed = true
    this.#spawnFailed = false
    this.#lastError = null
    this.#healthError = null
    this.#stdoutBuf = ''
    this.#stderrTail = ''
    this.#pairingCode = null
    this.#pairingCodeIssuedAtMs = null

    let child
    try {
      child = spawn(process.execPath, [HOST_ENTRY], {
        cwd: this.#repoDir,
        env: { ...process.env, PORT: String(this.#port) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      this.#failSpawn(error)
      return
    }
    this.#child = child
    this.#pid = typeof child.pid === 'number' ? child.pid : null
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => this.#onStdout(String(chunk)))
    child.stderr?.on('data', (chunk) => this.#onStderr(String(chunk)))
    child.on('error', (error) => {
      if (this.#child !== child) return
      this.#spawnFailed = true
      this.#lastError = `Host process failed to start: ${error?.message ?? String(error)}. ` +
        `Start it manually: ${this.#manualCommand}`
      this.#status = 'stopped'
      this.#child = null
      this.#pid = null
    })
    child.on('exit', (code, signal) => {
      if (this.#child !== child) return
      this.#onExit(code, signal)
    })

    this.#waitHealthy(START_HEALTH_TIMEOUT_MS)
  }

  #failSpawn(error) {
    this.#spawnFailed = true
    this.#status = 'stopped'
    this.#managed = false
    this.#child = null
    this.#pid = null
    this.#lastError = `Could not spawn the Fangcun Host: ${error?.message ?? String(error)}. ` +
      `Start it manually: ${this.#manualCommand}`
  }

  #onStdout(chunk) {
    this.#stdoutBuf += chunk
    const lines = this.#stdoutBuf.split(/\r?\n/)
    this.#stdoutBuf = lines.pop() ?? ''
    for (const line of lines) {
      const match = PAIRING_LINE.exec(line)
      if (match) {
        this.#pairingCode = match[1]
        this.#pairingCodeIssuedAtMs = Date.now()
      }
    }
  }

  #onStderr(chunk) {
    this.#stderrTail = (this.#stderrTail + chunk).slice(-2000)
  }

  #onExit(code, signal) {
    this.#child = null
    this.#pid = null
    this.#status = 'stopped'
    this.#pairingCode = null
    this.#pairingCodeIssuedAtMs = null
    if (this.#disposing) return
    const reason = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`
    this.#lastError = `Host exited unexpectedly (${reason})`
    if (this.#restarts < MAX_RESTARTS) {
      this.#restarts += 1
      this.#status = 'starting'
      this.#restartTimer = setTimeout(() => {
        this.#restartTimer = null
        if (this.#disposing) return
        this.#spawnHost()
      }, RESTART_DELAY_MS)
      if (typeof this.#restartTimer?.unref === 'function') this.#restartTimer.unref()
    } else {
      this.#lastError += `; automatic restart limit (${MAX_RESTARTS}) reached`
    }
  }

  async #waitHealthy(timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.#disposing) return false
      const health = await this.#probe()
      if (health.ok) {
        this.#applyHealth(health)
        this.#healthError = null
        this.#lastFullRefreshAt = Date.now()
        await Promise.all([
          this.#readCore().catch(() => {}),
          this.#readChat().catch(() => {}),
        ])
        return true
      }
      await delay(START_POLL_MS)
    }
    if (this.#child && !this.#disposing) {
      this.#lastError = this.#lastError
        ?? `Host did not answer /api/health within ${Math.round(timeoutMs / 1000)}s`
    }
    return false
  }
}

/** A companion-highlighted build area waiting for the owner's decision. */
function normalizeHouseProposal(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    proposalId: typeof raw.proposalId === 'string' ? raw.proposalId : null,
    companionId: typeof raw.companionId === 'string' ? raw.companionId : null,
    planBlockCount: typeof raw.planBlockCount === 'number' ? raw.planBlockCount : null,
    expiresAtMs: typeof raw.expiresAtMs === 'number' ? raw.expiresAtMs : null,
  }
}

/** The Host's in-memory build queue summary. */
function normalizeBuild(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    inProgress: raw.inProgress === true,
    completedBlocks: typeof raw.completedBlocks === 'number' ? raw.completedBlocks : 0,
    totalBlocks: typeof raw.totalBlocks === 'number' ? raw.totalBlocks : 0,
    intervalMs: typeof raw.intervalMs === 'number' ? raw.intervalMs : 0,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : null,
    seatPlaced: raw.seatPlaced === true,
  }
}

/**
 * One companion chat row in the wire shape the Client renders. The Host may send
 * extra fields; only these three cross the panel.
 */
function normalizeMessage(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string') return null
  return {
    role: raw.role === 'user' ? 'user' : 'companion',
    text: raw.text,
    atMs: typeof raw.atMs === 'number' ? raw.atMs : null,
  }
}

/** An item as the panel shows it; `icon` is a sprite name the Client draws. */
function normalizeItem(raw) {
  if (typeof raw === 'string') return { itemId: raw, name: raw, icon: null, description: null, count: 1 }
  if (!raw || typeof raw !== 'object') return null
  const itemId = raw.itemId ?? raw.id ?? raw.item_id
  if (typeof itemId !== 'string' || !itemId) return null
  const name = raw.name ?? raw.displayName ?? raw.display_name
  return {
    itemId,
    name: typeof name === 'string' && name ? name : itemId,
    icon: typeof raw.icon === 'string' && raw.icon ? raw.icon : null,
    description: typeof raw.description === 'string' ? raw.description
      : (typeof raw.desc === 'string' ? raw.desc : null),
    count: typeof raw.count === 'number' && raw.count > 0 ? raw.count : 1,
  }
}

/**
 * One companion in the messenger's wire shape. Missing optional fields stay
 * null so the panel renders placeholders instead of inventing content.
 */
function normalizeCompanion(raw) {
  if (!raw || typeof raw !== 'object') return null
  const companionId = raw.companionId ?? raw.id
  if (typeof companionId !== 'string' || !companionId) return null
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : []
  return {
    companionId,
    name: typeof raw.name === 'string' && raw.name ? raw.name : companionId,
    ownerUserId: typeof raw.ownerUserId === 'string' ? raw.ownerUserId : null,
    isMine: raw.isMine === true,
    personality: typeof raw.personality === 'string' && raw.personality ? raw.personality : null,
    personaId: typeof raw.personaId === 'string' && raw.personaId ? raw.personaId : null,
    avatarModelId: typeof raw.avatarModelId === 'string' && raw.avatarModelId ? raw.avatarModelId
      : (typeof raw.avatar?.modelId === 'string' ? raw.avatar.modelId
        : (typeof raw.personaId === 'string' ? raw.personaId : null)),
    state: typeof raw.state === 'string' ? raw.state : null,
    activeAction: typeof raw.activeAction === 'string' ? raw.activeAction : null,
    // Optional data URL the Host may attach once its avatar field lands; the
    // panel falls back to its own fish glyph when it is absent.
    avatarImage: typeof raw.avatarImage === 'string' && raw.avatarImage.length <= AVATAR_IMAGE_MAX_CHARS
      ? raw.avatarImage
      : null,
    items: items.slice(0, 2),
  }
}

/** Build the authenticated exact-Fetch routes the Client half calls. */
function createRoutes(service) {
  const route = (path, methods, handler, requestBody = 'buffered') => ({
    path,
    methods,
    requestBody,
    fetch: async (request) => {
      try {
        return await handler(request)
      } catch (error) {
        return errorJson(error)
      }
    },
  })

  /** Collect one streamed upload with a hard byte cap (the model file). */
  const readCappedBody = async (request, maxBytes) => {
    const body = request.body
    if (!body || typeof body.getReader !== 'function') {
      throw new FangcunError('invalid_model', 'model upload requires a request body')
    }
    const reader = body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (!value) continue
      total += value.byteLength
      if (total > maxBytes) {
        try { await reader.cancel() } catch { /* already closed */ }
        throw new FangcunError('model_too_large', `model must be at most ${maxBytes} bytes`, 413)
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }

  return [
    route(`${API_PREFIX}/state`, ['GET'], async (request) => {
      const full = new URL(request.url).searchParams.get('full') !== '0'
      const snapshot = await service.refresh({ full })
      return json({ ok: true, host: snapshot })
    }),
    route(`${API_PREFIX}/social`, ['GET'], async (request) => {
      const params = new URL(request.url).searchParams
      const companionId = params.get('companionId') ?? undefined
      const force = params.get('force') === '1'
      const social = await service.social({ companionId, force })
      return json(social)
    }),
    route(`${API_PREFIX}/chat`, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const companionId = typeof body.companionId === 'string' ? body.companionId : undefined
      const outcome = await service.chat(body.text, companionId)
      return json({
        ok: true,
        reply: outcome.reply,
        companionId: outcome.companionId,
        messages: outcome.messages,
        host: outcome.snapshot,
      })
    }),
    route(`${API_PREFIX}/give`, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const result = await service.give(body.companionId, body.itemId)
      return json({ ok: true, companionId: result.companionId, itemId: result.itemId })
    }),
    route(`${API_PREFIX}/avatar`, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const result = await service.setAvatar(body.companionId, body.avatarImage)
      return json({ ok: true, companionId: result.companionId, companion: result.companion })
    }),
    route(`${API_PREFIX}/pet`, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const result = await service.updatePetSettings({
        companionId: body.companionId,
        name: body.name,
        personality: body.personality,
        scale: body.scale,
        action: body.action,
      })
      return json({ ok: true, ...result })
    }),
    route(`${API_PREFIX}/house/decide`, ['POST'], async (request) => {
      const body = await readJsonBody(request)
      const result = await service.decideHouse(body.proposalId, body.approve)
      return json({ ok: true, approved: result.approved, proposalId: result.proposalId, planBlockCount: result.planBlockCount })
    }),
    route(`${API_PREFIX}/demo/lazy-house`, ['POST'], async () => {
      const result = await service.runDemo('lazy-house')
      return json({ ok: true, flow: result.flow, state: result.state, jobId: result.jobId, message: result.message, demo: result.raw })
    }),
    route(`${API_PREFIX}/demo/real-house`, ['POST'], async () => {
      const result = await service.runDemo('real-house')
      return json({
        ok: true,
        flow: result.flow,
        state: result.state,
        jobId: result.jobId,
        proposalId: result.proposalId,
        planBlockCount: result.planBlockCount,
        message: result.message,
        demo: result.raw,
      })
    }),
    route(`${API_PREFIX}/demo/reset-world`, ['POST'], async () => {
      const result = await service.resetWorld()
      return json({ ok: true, rev: result.rev, blockCount: result.blockCount, worldId: result.worldId, reset: result.raw })
    }),
    route(`${API_PREFIX}/model`, ['POST'], async (request) => {
      const params = new URL(request.url).searchParams
      const companionId = params.get('companionId') ?? ''
      const contentType = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/octet-stream') {
        throw new FangcunError('invalid_content_type', 'model uploads must be application/octet-stream', 415)
      }
      const bytes = await readCappedBody(request, MODEL_MAX_BYTES)
      const result = await service.installModel(companionId, bytes)
      return json({ ok: true, ...result })
    }, 'streaming'),
    route(`${API_PREFIX}/island`, ['GET'], async () => json(await service.island())),
    route(`${API_PREFIX}/tick`, ['POST'], async () => {
      const outcome = await service.tick()
      return json({ ok: true, result: outcome.result, host: outcome.snapshot })
    }),
    route(`${API_PREFIX}/start`, ['POST'], async () => {
      const snapshot = await service.start()
      return json({ ok: true, host: snapshot })
    }),
  ]
}

/**
 * Host plugin entry: provide `ctx.fangcunHost`, register the route surface, and
 * adopt or start the Fangcun Host process.
 * @param ctx - owning Cordis context.
 * @param config - optional `{ hostUrl, repoDir }` overrides.
 * @returns disposer that stops the process this plugin started.
 */
export function apply(ctx, config = {}) {
  const port = Number.isInteger(config?.port) && config.port > 0 && config.port < 65536 ? config.port : DEFAULT_PORT
  const hostUrl = typeof config?.hostUrl === 'string' && config.hostUrl
    ? config.hostUrl
    : `http://127.0.0.1:${port}`
  const repoDir = typeof config?.repoDir === 'string' && config.repoDir ? config.repoDir : DEFAULT_REPO_DIR
  const service = new FangcunHostService({ hostUrl, repoDir, port })
  const disposers = []

  if (typeof ctx.reflect?.provide === 'function') {
    try {
      disposers.push(ctx.reflect.provide('fangcunHost', service))
    } catch (error) {
      // A reload racing the previous instance is not fatal: the routes below are
      // the Client-facing surface and the process ownership still belongs here.
      ctx.logger?.warn?.(`[fangcun] could not provide ctx.fangcunHost: ${error?.message ?? String(error)}`)
    }
  }
  for (const route of createRoutes(service)) {
    disposers.push(ctx.connection.fetch.register(route))
  }

  ctx.logger?.info?.(`[fangcun] panel host plugin active (${hostUrl}, repo ${repoDir})`)
  service.bootstrap().catch((error) => {
    ctx.logger?.warn?.(`[fangcun] startup probe failed: ${error?.message ?? String(error)}`)
  })

  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        const result = typeof dispose === 'function' ? dispose() : undefined
        if (result && typeof result.then === 'function') result.catch(() => {})
      } catch {
        // ignore teardown failures
      }
    }
    service.dispose().catch(() => {})
  }
}
