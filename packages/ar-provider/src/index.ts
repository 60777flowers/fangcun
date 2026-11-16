export type ArMode = "webxr-arcore" | "printed-marker" | "none";
export type CameraPermission = "unknown" | "granted" | "denied";
export type TrackingState = "unsupported" | "permission-required" | "permission-denied" | "session-paused" | "tracking-lost" | "relocalizing" | "running" | "ended";

export type CapabilityProbe = Readonly<{
  secureContext: boolean;
  cameraAvailable: boolean;
  cameraPermission: CameraPermission;
  /** Device/runtime can start an immersive-ar session (this alone is not sufficient for tabletop placement). */
  webxrImmersiveArSupported: boolean;
  /** Required WebXR hit-test and anchor features are available for the actual session request. */
  webxrHitTestSupported: boolean;
  webxrAnchorsSupported: boolean;
  /** Concrete native CameraX + marker provider session is initialized and ready, not merely library presence. */
  markerProviderReady: boolean;
}>;

export type ArCapabilities = CapabilityProbe & Readonly<{ preferredMode: ArMode }>;

export type AnchorPose = Readonly<{
  mode: Exclude<ArMode, "none">;
  /** Column-major rigid transform from stable anchor frame to AR/world frame; translations are meters. */
  matrix: readonly number[];
  /** Provider-calibrated confidence in [0,1]. WebXR adapter may emit 1 for a valid tracked pose. */
  confidence: number;
  /**
   * Timestamp in the JavaScript performance.now() time origin, in milliseconds.
   * Native providers must NOT copy SystemClock.elapsedRealtime() directly; call
   * mapNativeTimestampToJs() with a calibrated sample and reject stale mappings.
   */
  observedAtMs: number;
  /** Provider-calibrated threshold required before allowing an edit. */
  writeConfidenceThreshold: number;
}>;

export type TrackingSnapshot = Readonly<{
  mode: ArMode;
  state: TrackingState;
  /** Only present while running or awaiting relocalization; never used for edits in relocalizing state. */
  pose?: AnchorPose;
  /** Stable pre-loss pose, retained only as a comparison reference and never accepted for writes. */
  lastStablePose?: AnchorPose;
  reason?: "permission" | "unsupported" | "tracking" | "marker-hidden" | "session-ended" | "provider-mismatch";
}>;

function poseWithinRecoveryTolerance(previous: AnchorPose, next: AnchorPose): boolean {
  if (previous.mode !== next.mode) return false;
  const translationDelta = Math.hypot(next.matrix[12]! - previous.matrix[12]!, next.matrix[13]! - previous.matrix[13]!, next.matrix[14]! - previous.matrix[14]!);
  if (translationDelta > 0.05) return false;
  const trace = previous.matrix[0]! * next.matrix[0]! + previous.matrix[1]! * next.matrix[1]! + previous.matrix[2]! * next.matrix[2]!
    + previous.matrix[4]! * next.matrix[4]! + previous.matrix[5]! * next.matrix[5]! + previous.matrix[6]! * next.matrix[6]!
    + previous.matrix[8]! * next.matrix[8]! + previous.matrix[9]! * next.matrix[9]! + previous.matrix[10]! * next.matrix[10]!;
  const cosine = Math.max(-1, Math.min(1, (trace - 1) / 2));
  return Math.acos(cosine) <= (10 * Math.PI / 180);
}

function isRigidMatrix(matrix: readonly number[]): boolean {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) return false;
  const epsilon = 0.025;
  if (Math.abs(matrix[3]!) > epsilon || Math.abs(matrix[7]!) > epsilon || Math.abs(matrix[11]!) > epsilon || Math.abs(matrix[15]! - 1) > epsilon) return false;
  const columns = [
    [matrix[0]!, matrix[1]!, matrix[2]!],
    [matrix[4]!, matrix[5]!, matrix[6]!],
    [matrix[8]!, matrix[9]!, matrix[10]!],
  ];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  for (let column = 0; column < 3; column += 1) {
    if (Math.abs(dot(columns[column]!, columns[column]!) - 1) > epsilon) return false;
    for (let other = column + 1; other < 3; other += 1) {
      if (Math.abs(dot(columns[column]!, columns[other]!)) > epsilon) return false;
    }
  }
  const [a, b, c] = columns;
  const determinant = a![0]! * (b![1]! * c![2]! - b![2]! * c![1]!)
    - b![0]! * (a![1]! * c![2]! - a![2]! * c![1]!)
    + c![0]! * (a![1]! * b![2]! - a![2]! * b![1]!);
  return determinant > 0 && Math.abs(determinant - 1) <= 0.05;
}

export type NativeClockCalibration = Readonly<{ nativeMonotonicMs: number; jsPerformanceNowMs: number; measuredBridgeLatencyMs: number }>;

/** Map native monotonic timestamp to JS performance.now() origin using a measured bridge latency. */
export function mapNativeTimestampToJs(nativeObservedAtMs: number, calibration: NativeClockCalibration): number | null {
  if (![nativeObservedAtMs, calibration.nativeMonotonicMs, calibration.jsPerformanceNowMs, calibration.measuredBridgeLatencyMs].every(Number.isFinite)) return null;
  if (calibration.measuredBridgeLatencyMs < 0 || calibration.measuredBridgeLatencyMs > 250) return null;
  const ageAtCalibration = calibration.nativeMonotonicMs - nativeObservedAtMs;
  if (ageAtCalibration < 0 || ageAtCalibration > 5_000) return null;
  const mapped = calibration.jsPerformanceNowMs - calibration.measuredBridgeLatencyMs - ageAtCalibration;
  return mapped >= 0 ? mapped : null;
}

export function choosePreferredMode(probe: CapabilityProbe): ArMode {
  if (probe.secureContext && probe.cameraAvailable && probe.cameraPermission !== "denied"
    && probe.webxrImmersiveArSupported && probe.webxrHitTestSupported && probe.webxrAnchorsSupported) return "webxr-arcore";
  if (probe.secureContext && probe.cameraAvailable && probe.cameraPermission !== "denied" && probe.markerProviderReady) return "printed-marker";
  return "none";
}

export function detectCapabilities(probe: CapabilityProbe): ArCapabilities {
  return Object.freeze({ ...probe, preferredMode: choosePreferredMode(probe) });
}

export function createInitialTracking(capabilities: ArCapabilities): TrackingSnapshot {
  if (capabilities.cameraPermission === "denied" && capabilities.secureContext && capabilities.cameraAvailable) {
    return Object.freeze({ mode: "none", state: "permission-denied", reason: "permission" });
  }
  if (capabilities.preferredMode === "none") {
    return Object.freeze({ mode: "none", state: "unsupported", reason: "unsupported" });
  }
  if (capabilities.cameraPermission === "unknown") {
    return Object.freeze({ mode: capabilities.preferredMode, state: "permission-required", reason: "permission" });
  }
  return Object.freeze({ mode: capabilities.preferredMode, state: "session-paused" });
}

function isAllowedTransition(from: TrackingState, to: TrackingState): boolean {
  const transitions: Readonly<Record<TrackingState, readonly TrackingState[]>> = {
    unsupported: ["unsupported"],
    "permission-required": ["permission-required", "permission-denied", "session-paused"],
    "permission-denied": ["permission-denied", "permission-required", "session-paused"],
    "session-paused": ["session-paused", "tracking-lost", "relocalizing", "running", "ended"],
    "tracking-lost": ["tracking-lost", "session-paused", "relocalizing", "ended"],
    relocalizing: ["relocalizing", "tracking-lost", "session-paused", "ended"],
    running: ["running", "tracking-lost", "relocalizing", "session-paused", "ended"],
    ended: ["ended"],
  };
  return transitions[from].includes(to);
}

function isValidPose(pose: AnchorPose | undefined, mode: ArMode): pose is AnchorPose {
  return !!pose && pose.mode === mode && isRigidMatrix(pose.matrix)
    && Number.isFinite(pose.confidence) && pose.confidence >= 0 && pose.confidence <= 1
    && Number.isFinite(pose.writeConfidenceThreshold) && pose.writeConfidenceThreshold >= 0 && pose.writeConfidenceThreshold <= 1
    && Number.isFinite(pose.observedAtMs) && pose.observedAtMs >= 0;
}

function copyPose(pose: AnchorPose): AnchorPose {
  return Object.freeze({ ...pose, matrix: Object.freeze([...pose.matrix]) });
}

export function updateTracking(snapshot: TrackingSnapshot, update: Readonly<{ mode?: ArMode; state: TrackingState; pose?: AnchorPose; reason?: TrackingSnapshot["reason"] }>): TrackingSnapshot {
  const mode = update.mode ?? snapshot.mode;
  if (mode !== snapshot.mode || mode === "none" || (update.pose && update.pose.mode !== mode)) {
    return Object.freeze({ mode: snapshot.mode, state: "tracking-lost", ...(snapshot.pose ? { lastStablePose: snapshot.pose } : {}), reason: "provider-mismatch" });
  }
  if ((snapshot.state === "tracking-lost" || snapshot.state === "session-paused") && update.state === "running") {
    const lastStablePose = snapshot.state === "session-paused" ? snapshot.lastStablePose : snapshot.lastStablePose;
    if (isValidPose(update.pose, mode)) return Object.freeze({ mode, state: "relocalizing", pose: copyPose(update.pose), ...(lastStablePose ? { lastStablePose } : {}), reason: "tracking" });
    return Object.freeze({ mode, state: "tracking-lost", ...(lastStablePose ? { lastStablePose } : {}), reason: "tracking" });
  }
  if (snapshot.state === "relocalizing" && update.state === "running") {
    if (!isValidPose(update.pose, mode)) return Object.freeze({ mode, state: "relocalizing", ...(snapshot.lastStablePose ? { lastStablePose: snapshot.lastStablePose } : {}), reason: "tracking" });
    return Object.freeze({ mode, state: "relocalizing", pose: copyPose(update.pose), ...(snapshot.lastStablePose ? { lastStablePose: snapshot.lastStablePose } : {}), reason: "tracking" });
  }
  if (!isAllowedTransition(snapshot.state, update.state)) {
    return Object.freeze({ mode, state: snapshot.state, ...(snapshot.pose ? { pose: snapshot.pose } : {}), ...(snapshot.lastStablePose ? { lastStablePose: snapshot.lastStablePose } : {}), reason: "tracking" });
  }
  if (update.state !== "running") {
    const lastStablePose = snapshot.state === "running" ? snapshot.pose : snapshot.lastStablePose;
    if (update.state === "relocalizing" && isValidPose(update.pose, mode)) {
      return Object.freeze({ mode, state: "relocalizing", pose: copyPose(update.pose), ...(lastStablePose ? { lastStablePose } : {}), ...(update.reason ? { reason: update.reason } : {}) });
    }
    if (update.state === "relocalizing") {
      return Object.freeze({ mode, state: "relocalizing", ...(lastStablePose ? { lastStablePose } : {}), ...(update.reason ? { reason: update.reason } : {}) });
    }
    return Object.freeze({ mode, state: update.state, ...(lastStablePose ? { lastStablePose } : {}), ...(update.reason ? { reason: update.reason } : {}) });
  }
  if (!isValidPose(update.pose, mode)) return Object.freeze({ mode, state: "tracking-lost", ...(snapshot.lastStablePose ? { lastStablePose: snapshot.lastStablePose } : {}), reason: "tracking" });
  if (snapshot.state !== "running") {
    return Object.freeze({ mode, state: "relocalizing", pose: copyPose(update.pose), ...(snapshot.lastStablePose ? { lastStablePose: snapshot.lastStablePose } : {}), reason: "tracking" });
  }
  return Object.freeze({ mode, state: "running", pose: copyPose(update.pose) });
}

/** Complete re-localization only after explicit user confirmation and pose continuity check. */
export function confirmRelocalization(snapshot: TrackingSnapshot, nowMs: number, userConfirmed = false): TrackingSnapshot {
  if (snapshot.state !== "relocalizing" || !isValidPose(snapshot.pose, snapshot.mode)) return snapshot;
  if (!Number.isFinite(nowMs) || nowMs < snapshot.pose.observedAtMs || nowMs - snapshot.pose.observedAtMs > 500) return snapshot;
  if (snapshot.lastStablePose && !poseWithinRecoveryTolerance(snapshot.lastStablePose, snapshot.pose)) {
    return Object.freeze({ mode: snapshot.mode, state: "tracking-lost", lastStablePose: snapshot.lastStablePose, reason: "tracking" });
  }
  if (!userConfirmed) return snapshot;
  return Object.freeze({ mode: snapshot.mode, state: "running", pose: copyPose(snapshot.pose) });
}

/** World writes require a fresh, provider-calibrated pose; losses clear pose before resume. */
export function canWriteWorld(snapshot: TrackingSnapshot, nowMs: number, maxPoseAgeMs = 500): boolean {
  if (!Number.isFinite(maxPoseAgeMs) || maxPoseAgeMs < 0 || maxPoseAgeMs > 5_000) return false;
  if (snapshot.state !== "running" || snapshot.mode === "none" || !isValidPose(snapshot.pose, snapshot.mode)) return false;
  const age = nowMs - snapshot.pose.observedAtMs;
  return Number.isFinite(nowMs) && age >= 0 && age <= maxPoseAgeMs && snapshot.pose.confidence >= snapshot.pose.writeConfidenceThreshold;
}
