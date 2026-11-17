import test from "node:test";
import assert from "node:assert/strict";
import { createAutonomyState, reduceAutonomy } from "../../../packages/companion-runtime/src/autonomy.ts";

test("autonomy reducer observes, proposes home, plans and requests auto commit without writing", () => {
  let state = createAutonomyState(true);
  let transition = reduceAutonomy(state, { type: "tick", nowMs: 1_000 }, { tickIntervalMs: 1_000 });
  state = transition.state;
  assert.equal(state.phase, "observing");
  assert.equal(transition.effects[0]?.kind, "observe");
  const generation = state.generation;
  transition = reduceAutonomy(state, { type: "observation_received", generation, worldRev: 0, hasGrant: false, homeNeedsWork: false }, { tickIntervalMs: 1_000 });
  state = transition.state;
  assert.equal(state.phase, "awaiting_home_approval");
  assert.equal(transition.effects[0]?.kind, "choose_home");
  transition = reduceAutonomy(state, { type: "home_candidate_proposed", generation: state.generation, candidateId: "candidate-1" }, { tickIntervalMs: 1_000 });
  state = transition.state;
  assert.equal(transition.effects[0]?.kind, "request_home_approval");
  transition = reduceAutonomy(state, { type: "home_grant_approved", generation: state.generation, plotId: "plot-1" }, { tickIntervalMs: 1_000 });
  state = transition.state;
  assert.equal(state.phase, "planning_home");
  transition = reduceAutonomy(state, { type: "plan_ready", generation: state.generation, planId: "plan-1", autoCommitEligible: true }, { tickIntervalMs: 1_000 });
  state = transition.state;
  assert.equal(state.phase, "awaiting_commit");
  assert.equal(transition.effects[0]?.kind, "request_user_approval");
  transition = reduceAutonomy(state, { type: "user_approved_plan", generation: state.generation, planId: "plan-1" }, { tickIntervalMs: 1_000 });
  assert.equal(transition.effects[0]?.kind, "request_auto_commit");
});

test("pause/cancel/tracking loss invalidate late results and never emit direct commit", () => {
  let state = createAutonomyState(true);
  state = reduceAutonomy(state, { type: "tick", nowMs: 1_000 }, { tickIntervalMs: 1_000 }).state;
  const staleGeneration = state.generation;
  const paused = reduceAutonomy(state, { type: "pause" }, { tickIntervalMs: 1_000 });
  assert.equal(paused.state.phase, "paused");
  assert.equal(reduceAutonomy(paused.state, { type: "observation_received", generation: staleGeneration, worldRev: 1, hasGrant: true, homeNeedsWork: true }, { tickIntervalMs: 1_000 }).effects.length, 0);
  assert.equal(paused.effects.some((effect) => effect.kind === "request_auto_commit"), false);
  const restored = reduceAutonomy(paused.state, { type: "resume" }, { tickIntervalMs: 1_000 });
  assert.equal(restored.state.autonomyEnabled, true);
  const lost = reduceAutonomy(restored.state, { type: "tracking_lost" }, { tickIntervalMs: 1_000 });
  assert.equal(lost.state.trackingReady, false);
  assert.equal(lost.effects.some((effect) => effect.kind === "request_auto_commit"), false);
});

