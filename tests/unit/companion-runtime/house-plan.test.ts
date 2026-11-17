import test from "node:test";
import assert from "node:assert/strict";
import { applyTransaction, createSeedWorld } from "@fangcun/voxel-core";
import type { HomePlotGrant } from "@fangcun/companion-schema";
import { buildHousePlan, findHouseBuildPlan, HOUSE_PLAN_BLOCK_COUNT } from "../../../packages/companion-runtime/src/index.ts";

function grantWithBounds(bounds: HomePlotGrant["bounds"]): HomePlotGrant {
  return {
    schemaVersion: 1,
    grantId: "grant-house-search-1",
    grantRev: 1,
    plotId: "home-house-search-1",
    worldId: "house-search-world",
    ownerUserId: "local-user",
    approvedByUserId: "local-user",
    companionId: "fish-1",
    bounds,
    allowedBlockIds: ["planks", "glass", "stairs"],
    maxBlocksPerPlan: 32,
    maxBlocksPerDay: 128,
    createdAt: "2026-11-16T12:00:00.000Z",
    expiresAt: "2026-11-23T12:00:00.000Z",
  };
}

function fillCells(world: ReturnType<typeof createSeedWorld>, cells: ReadonlyArray<Readonly<{ x: number; y: number; z: number }>>) {
  const result = applyTransaction(world, cells.map((at) => ({ type: "place" as const, at, blockId: "stone" as const })), { baseRev: world.rev, actor: "player" });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fill failed");
  return result.world;
}

test("findHouseBuildPlan searches past an occupied origin and keeps ops relative to the chosen footprint", () => {
  const grant = grantWithBounds({ min: { x: 0, y: 1, z: 0 }, maxExclusive: { x: 4, y: 5, z: 4 } });
  // Occupy the (0,0) footprint's floor cell: a 4x4 grant ties on centre distance for
  // all four 3x3 origins, so the deterministic z-then-x tie-break picks (1,0) next.
  const world = fillCells(createSeedWorld("house-search-world"), [{ x: 0, y: 1, z: 0 }]);
  const plan = findHouseBuildPlan(world, grant);
  assert.ok(plan, "a clear footprint exists inside the grant");
  if (!plan) return;
  assert.deepEqual(plan.origin, { x: 1, y: 1, z: 0 });
  assert.deepEqual(plan.bounds.min, { x: 1, y: 1, z: 0 });
  assert.deepEqual(plan.bounds.maxExclusive, { x: 4, y: 4, z: 3 });
  assert.equal(plan.blockCount, HOUSE_PLAN_BLOCK_COUNT);
  assert.deepEqual(plan.seat, { x: 2, y: 2, z: 1 }, "the seat is the chosen footprint's centre");
  const cells = new Set<string>();
  for (const operation of plan.operations) {
    const { x, y, z } = operation.at;
    assert.ok(x >= plan.bounds.min.x && x < plan.bounds.maxExclusive.x, `op x ${x} inside the chosen footprint`);
    assert.ok(y >= plan.bounds.min.y && y < plan.bounds.maxExclusive.y, `op y ${y} inside the chosen footprint`);
    assert.ok(z >= plan.bounds.min.z && z < plan.bounds.maxExclusive.z, `op z ${z} inside the chosen footprint`);
    assert.notDeepEqual(operation.at, { x: 0, y: 1, z: 0 }, "the occupied origin cell is not reused");
    cells.add(`${x},${y},${z}`);
  }
  assert.equal(cells.size, HOUSE_PLAN_BLOCK_COUNT, "all plan cells are unique");
});

test("findHouseBuildPlan prefers the footprint nearest the plot centre", () => {
  const grant = grantWithBounds({ min: { x: 0, y: 1, z: 0 }, maxExclusive: { x: 6, y: 5, z: 6 } });
  // Candidate origins are 0..3 on both axes; (1,1) and (2,1) etc. tie nearest the centre.
  // Block (1,1)'s floor cell so the next deterministic choice is (2,1).
  const world = fillCells(createSeedWorld("house-centre-world"), [{ x: 1, y: 1, z: 1 }]);
  const plan = findHouseBuildPlan(world, grant);
  assert.ok(plan);
  if (!plan) return;
  assert.deepEqual(plan.origin, { x: 2, y: 1, z: 1 });
});

test("buildHousePlan accepts an explicit origin so the chosen footprint drives all coordinates", () => {
  const grant = grantWithBounds({ min: { x: 0, y: 1, z: 0 }, maxExclusive: { x: 4, y: 5, z: 4 } });
  const originPlan = buildHousePlan(grant);
  const shiftedPlan = buildHousePlan(grant, { x: 1, y: 1, z: 1 });
  assert.ok(originPlan);
  assert.ok(shiftedPlan);
  if (!originPlan || !shiftedPlan) return;
  assert.deepEqual(shiftedPlan.origin, { x: 1, y: 1, z: 1 });
  assert.deepEqual(shiftedPlan.seat, { x: 2, y: 2, z: 2 });
  for (let index = 0; index < shiftedPlan.operations.length; index += 1) {
    const base = originPlan.operations[index]!;
    const shifted = shiftedPlan.operations[index]!;
    assert.deepEqual(shifted.at, { x: base.at.x + 1, y: base.at.y, z: base.at.z + 1 }, `op ${index} is relative to the chosen origin`);
  }
});

test("findHouseBuildPlan returns null when no 3x3 footprint is clear", () => {
  const grant = grantWithBounds({ min: { x: 0, y: 1, z: 0 }, maxExclusive: { x: 4, y: 5, z: 4 } });
  const groundCells = [];
  for (let z = 0; z < 4; z += 1) for (let x = 0; x < 4; x += 1) groundCells.push({ x, y: 1, z });
  const world = fillCells(createSeedWorld("house-full-world"), groundCells);
  assert.equal(findHouseBuildPlan(world, grant), null, "every candidate floor is occupied");
});
