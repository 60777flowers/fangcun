import type { RuntimeErrorCode } from "./index.ts";

export type AutonomyPhase = "idle" | "observing" | "awaiting_home_approval" | "planning_home" | "awaiting_commit" | "building" | "paused";
export type AutonomyState = Readonly<{
  phase: AutonomyPhase;
  autonomyEnabled: boolean;
  generation: number;
  inFlight?: string | undefined;
  goalId?: string | undefined;
  planId?: string | undefined;
  lastObservedRev?: number | undefined;
  lastTickMs?: number | undefined;
  trackingReady: boolean;
}>;
export type AutonomyEvent =
  | Readonly<{ type: "tick"; nowMs: number }>
  | Readonly<{ type: "observation_received"; generation: number; worldRev: number; hasGrant: boolean; homeNeedsWork: boolean }>
  | Readonly<{ type: "home_candidate_proposed"; generation: number; candidateId: string }>
  | Readonly<{ type: "home_grant_approved"; generation: number; plotId: string }>
  | Readonly<{ type: "home_grant_revoked" }>
  | Readonly<{ type: "plan_ready"; generation: number; planId: string; autoCommitEligible: boolean }>
  | Readonly<{ type: "user_approved_plan"; generation: number; planId: string }>
  | Readonly<{ type: "commit_result"; generation: number; ok: boolean; rev?: number; reason?: RuntimeErrorCode }>
  | Readonly<{ type: "build_finished"; generation: number }>
  | Readonly<{ type: "pause" }>
  | Readonly<{ type: "resume" }>
  | Readonly<{ type: "cancel" }>
  | Readonly<{ type: "tracking_lost" }>
  | Readonly<{ type: "tracking_restored" }>;
export type AutonomyEffect = Readonly<{
  kind: "observe" | "choose_home" | "request_home_approval" | "plan_home" | "request_auto_commit" | "request_user_approval" | "say";
  generation: number;
  goalId?: string | undefined;
  candidateId?: string | undefined;
  plotId?: string | undefined;
  planId?: string | undefined;
}>;
export type AutonomyConfig = Readonly<{ tickIntervalMs: number }>;
export type AutonomyTransition = Readonly<{ state: AutonomyState; effects: readonly AutonomyEffect[] }>;

function effect(kind: AutonomyEffect["kind"], generation: number, data: Omit<AutonomyEffect, "kind" | "generation"> = {}): AutonomyEffect {
  return Object.freeze({ kind, generation, ...data });
}

function reset(state: AutonomyState, phase: AutonomyPhase, patch: Partial<AutonomyState> = {}): AutonomyState {
  return Object.freeze({ ...state, phase, inFlight: undefined, planId: undefined, ...patch, generation: state.generation + 1 });
}

export function createAutonomyState(enabled = true): AutonomyState {
  return Object.freeze({ phase: enabled ? "idle" : "paused", autonomyEnabled: enabled, generation: 0, trackingReady: true });
}

export function reduceAutonomy(state: AutonomyState, event: AutonomyEvent, config: AutonomyConfig): AutonomyTransition {
  if (event.type === "pause" || event.type === "cancel" || event.type === "home_grant_revoked" || event.type === "tracking_lost") {
    const trackingReady = event.type === "tracking_lost" ? false : state.trackingReady;
    const autonomyEnabled = event.type === "pause" ? false : state.autonomyEnabled;
    const next = reset(state, event.type === "pause" ? "paused" : "idle", { trackingReady, autonomyEnabled, goalId: undefined });
    return { state: next, effects: Object.freeze([effect("say", next.generation)]) };
  }
  if (event.type === "resume") {
    if (!state.trackingReady) return { state, effects: Object.freeze([]) };
    return { state: reset(state, "idle", { autonomyEnabled: true, inFlight: undefined, planId: undefined, goalId: undefined }), effects: Object.freeze([]) };
  }
  if (event.type === "tracking_restored") {
    const next = reset(state, state.autonomyEnabled ? "idle" : "paused", { trackingReady: true, inFlight: undefined, planId: undefined });
    return { state: next, effects: Object.freeze([]) };
  }
  if (!state.autonomyEnabled || state.phase === "paused" || !state.trackingReady) return { state, effects: Object.freeze([]) };

  if (event.type === "tick") {
    if (!Number.isFinite(config.tickIntervalMs) || config.tickIntervalMs < 1_000 || !Number.isFinite(event.nowMs) || event.nowMs < 0) return { state, effects: Object.freeze([]) };
    if (state.phase !== "idle" || (state.lastTickMs !== undefined && event.nowMs - state.lastTickMs < config.tickIntervalMs)) return { state, effects: Object.freeze([]) };
    const generation = state.generation + 1;
    const goalId = `home:${generation}`;
    const next = Object.freeze({ ...state, phase: "observing" as const, generation, goalId, inFlight: "observe", lastTickMs: event.nowMs });
    return { state: next, effects: Object.freeze([effect("observe", generation, { goalId })]) };
  }

  if (event.type === "user_approved_plan") {
    if (event.generation !== state.generation || state.phase !== "awaiting_commit" || state.planId !== event.planId) return { state, effects: Object.freeze([]) };
    const next = Object.freeze({ ...state, phase: "awaiting_commit" as const, inFlight: "commit" });
    return { state: next, effects: Object.freeze([effect("request_auto_commit", next.generation, { planId: event.planId, goalId: state.goalId })]) };
  }
  if (!("generation" in event) || event.generation !== state.generation) return { state, effects: Object.freeze([]) };
  if (event.type === "observation_received" && state.phase === "observing" && state.inFlight === "observe") {
    if (event.worldRev < 0 || !Number.isSafeInteger(event.worldRev)) return { state: reset(state, "idle"), effects: Object.freeze([]) };
    const patch = { inFlight: undefined, lastObservedRev: event.worldRev };
    if (!event.hasGrant) {
      const next = Object.freeze({ ...state, phase: "awaiting_home_approval" as const, ...patch });
      return { state: next, effects: Object.freeze([effect("choose_home", next.generation, { goalId: state.goalId })]) };
    }
    if (event.homeNeedsWork) {
      const next = Object.freeze({ ...state, phase: "planning_home" as const, inFlight: "plan" });
      return { state: next, effects: Object.freeze([effect("plan_home", next.generation, { goalId: state.goalId })]) };
    }
    const next = reset(state, "idle", patch);
    return { state: next, effects: Object.freeze([effect("say", next.generation, { goalId: state.goalId })]) };
  }

  if (event.type === "home_candidate_proposed" && state.phase === "awaiting_home_approval") {
    const next = Object.freeze({ ...state, inFlight: "home_approval" });
    return { state: next, effects: Object.freeze([effect("request_home_approval", next.generation, { candidateId: event.candidateId, goalId: state.goalId })]) };
  }

  if (event.type === "home_grant_approved" && state.phase === "awaiting_home_approval" && state.inFlight === "home_approval") {
    const next = Object.freeze({ ...state, phase: "planning_home" as const, inFlight: "plan" });
    return { state: next, effects: Object.freeze([effect("plan_home", next.generation, { plotId: event.plotId, goalId: state.goalId })]) };
  }

  if (event.type === "plan_ready" && state.phase === "planning_home" && state.inFlight === "plan") {
    if (!event.planId) return { state: reset(state, "idle"), effects: Object.freeze([]) };
    const next = Object.freeze({ ...state, phase: "awaiting_commit" as const, inFlight: undefined, planId: event.planId });
    return { state: next, effects: Object.freeze([effect("request_user_approval", next.generation, { planId: event.planId, goalId: state.goalId })]) };
  }

  if (event.type === "commit_result" && state.phase === "awaiting_commit" && state.inFlight === "commit") {
    if (!event.ok) return { state: reset(state, "idle"), effects: Object.freeze([effect("say", state.generation + 1, { goalId: state.goalId })]) };
    const next = Object.freeze({ ...state, phase: "building" as const, inFlight: undefined, lastObservedRev: event.rev ?? state.lastObservedRev });
    return { state: next, effects: Object.freeze([effect("say", next.generation, { planId: state.planId, goalId: state.goalId })]) };
  }

  if (event.type === "build_finished" && state.phase === "building") return { state: reset(state, "idle", { planId: undefined, goalId: undefined }), effects: Object.freeze([]) };
  return { state, effects: Object.freeze([]) };
}
