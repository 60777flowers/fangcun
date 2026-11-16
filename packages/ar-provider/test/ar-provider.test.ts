import test from "node:test";
import assert from "node:assert/strict";
import { canWriteWorld, choosePreferredMode, confirmRelocalization, createInitialTracking, detectCapabilities, mapNativeTimestampToJs, updateTracking, type CapabilityProbe } from "../src/index.ts";

const matrix = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const baseProbe = { secureContext: true, cameraAvailable: true, cameraPermission: "granted" as const, webxrImmersiveArSupported: false, webxrHitTestSupported: false, webxrAnchorsSupported: false, markerProviderReady: false };
const probe = (overrides: Partial<CapabilityProbe> = {}): CapabilityProbe => ({ ...baseProbe, ...overrides });
const markerPose = { mode: "printed-marker" as const, matrix, confidence: 0.95, observedAtMs: 1000, writeConfidenceThreshold: 0.8 };

test("native timestamps are mapped to JS performance time and reject bad calibration", () => {
  assert.equal(mapNativeTimestampToJs(980, { nativeMonotonicMs: 1000, jsPerformanceNowMs: 500, measuredBridgeLatencyMs: 10 }), 470);
  assert.equal(mapNativeTimestampToJs(10, { nativeMonotonicMs: 1000, jsPerformanceNowMs: 500, measuredBridgeLatencyMs: 10 }), null);
  assert.equal(mapNativeTimestampToJs(980, { nativeMonotonicMs: 1000, jsPerformanceNowMs: 500, measuredBridgeLatencyMs: 300 }), null);
});

test("ARCore/WebXR is preferred, marker mode is fallback only when ready", () => {
  assert.equal(choosePreferredMode(probe({ webxrImmersiveArSupported: true, webxrHitTestSupported: true, webxrAnchorsSupported: true, markerProviderReady: true })), "webxr-arcore");
  assert.equal(choosePreferredMode(probe({ secureContext: false, markerProviderReady: true })), "none");
  assert.equal(choosePreferredMode(probe({ markerProviderReady: true })), "printed-marker");
  assert.equal(choosePreferredMode(probe({ cameraPermission: "denied", markerProviderReady: true })), "none");
  assert.equal(choosePreferredMode(probe()), "none");
});

test("camera permission is an explicit state before the provider can run", () => {
  const capabilities = detectCapabilities(probe({ cameraPermission: "unknown", webxrImmersiveArSupported: true, webxrHitTestSupported: true, webxrAnchorsSupported: true }));
  const initial = createInitialTracking(capabilities);
  assert.equal(initial.state, "permission-required");
  const deniedCapabilities = detectCapabilities(probe({ cameraPermission: "denied", webxrImmersiveArSupported: true, webxrHitTestSupported: true, webxrAnchorsSupported: true }));
  assert.equal(createInitialTracking(deniedCapabilities).state, "permission-denied");
  assert.equal(canWriteWorld(updateTracking(initial, { state: "running", pose: { ...markerPose, mode: "webxr-arcore" } }), 1100), false);
});

test("fresh calibrated pose allows writes only after initial placement confirmation", () => {
  const capabilities = detectCapabilities(probe({ markerProviderReady: true }));
  const initial = createInitialTracking(capabilities);
  const candidate = updateTracking(initial, { state: "running", pose: markerPose });
  assert.equal(candidate.state, "relocalizing");
  assert.equal(canWriteWorld(candidate, 1200), false);
  const running = confirmRelocalization(candidate, 1200, true);
  assert.equal(running.state, "running");
  assert.equal(canWriteWorld(running, 1200), true);
  assert.equal(canWriteWorld(running, 1601), false);
  assert.equal(canWriteWorld(running, 900), false);
  assert.equal(canWriteWorld(running, 1200, Number.NaN), false);
  assert.equal(canWriteWorld(updateTracking(running, { state: "running", pose: { ...markerPose, confidence: 0.7, observedAtMs: 1150 } }), 1200), false);
});

test("tracking loss requires explicit re-localization confirmation; jumps remain blocked", () => {
  const initial = createInitialTracking(detectCapabilities(probe({ markerProviderReady: true })));
  const running = confirmRelocalization(updateTracking(initial, { state: "running", pose: markerPose }), 1000, true);
  const lost = updateTracking(running, { state: "tracking-lost", reason: "marker-hidden" });
  assert.equal("pose" in lost, false);
  assert.equal(canWriteWorld(lost, 1200), false);
  const candidate = updateTracking(lost, { state: "running", pose: { ...markerPose, observedAtMs: 1150 } });
  assert.equal(candidate.state, "relocalizing");
  assert.equal(canWriteWorld(candidate, 1200), false);
  assert.equal(confirmRelocalization(candidate, 1200).state, "relocalizing");
  assert.equal(confirmRelocalization(candidate, 1200, true).state, "running");
  const jumped = updateTracking(lost, { state: "running", pose: { ...markerPose, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.2, 0, 0, 1], observedAtMs: 1150 } });
  assert.equal(confirmRelocalization(jumped, 1200, true).state, "tracking-lost", "pose jump requires reset/re-anchor");
  assert.equal(canWriteWorld(updateTracking(lost, { state: "running" }), 1200), false);
});

test("provider switches, malformed transforms, and non-rigid matrices fail closed", () => {
  const initial = createInitialTracking(detectCapabilities(probe({ markerProviderReady: true })));
  const mismatch = updateTracking(initial, { mode: "webxr-arcore", state: "running", pose: { ...markerPose, mode: "webxr-arcore" } });
  assert.equal(mismatch.state, "tracking-lost");
  assert.equal(mismatch.reason, "provider-mismatch");
  const malformed = updateTracking(initial, { state: "running", pose: { ...markerPose, matrix: [1, 2] } });
  assert.equal(malformed.state, "tracking-lost");
  const scaled = [...matrix];
  scaled[0] = 2;
  const nonRigid = updateTracking(initial, { state: "running", pose: { ...markerPose, matrix: scaled } });
  assert.equal(nonRigid.state, "tracking-lost");
});
