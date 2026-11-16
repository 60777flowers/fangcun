import { coordToIndex, isBlockId } from "@fangcun/world-schema";
import { validateCommitMessage, type CommitMessage } from "@fangcun/protocol";
import { assertWorldState, type WorldState } from "./index.ts";

export type ReplicaApplyResult =
  | Readonly<{ status: "applied"; world: WorldState }>
  | Readonly<{ status: "duplicate"; world: WorldState }>
  | Readonly<{ status: "resync_required"; world: WorldState; reason: "revision_gap" | "invalid_commit" | "before_mismatch" }>;

/** Applies one ordered authoritative commit. ACK messages must never call this function. */
export function applyCommit(world: WorldState, commit: CommitMessage): ReplicaApplyResult {
  if (!assertWorldState(world)) return { status: "resync_required", world, reason: "invalid_commit" };
  const validated = validateCommitMessage(commit);
  if (!validated.ok || validated.value.worldId !== world.worldId) return { status: "resync_required", world, reason: "invalid_commit" };
  commit = validated.value;
  if (commit.rev <= world.rev) return { status: "duplicate", world };
  if (commit.rev !== world.rev + 1) return { status: "resync_required", world, reason: "revision_gap" };
  if (!Array.isArray(commit.operations) || commit.operations.length < 1 || commit.operations.length > 256) {
    return { status: "resync_required", world, reason: "invalid_commit" };
  }
  const nextBlocks = [...world.blocks];
  const seen = new Set<number>();
  const validatedOps: Array<{ index: number; blockId: string | null }> = [];
  let previousIndex = -1;
  for (const operation of commit.operations) {
    if (!operation || (operation.type !== "place" && operation.type !== "break") || !isBlockId(operation.type === "place" ? operation.blockId : operation.expectedBlock)) {
      return { status: "resync_required", world, reason: "invalid_commit" };
    }
    let index: number;
    try { index = coordToIndex(operation.at); } catch { return { status: "resync_required", world, reason: "invalid_commit" }; }
    if (seen.has(index) || index <= previousIndex) return { status: "resync_required", world, reason: "invalid_commit" };
    seen.add(index);
    previousIndex = index;
    const current = nextBlocks[index] ?? null;
    if (operation.type === "place") {
      if (current !== null) return { status: "resync_required", world, reason: "before_mismatch" };
      validatedOps.push({ index, blockId: operation.blockId });
    } else {
      if (current !== operation.expectedBlock) return { status: "resync_required", world, reason: "before_mismatch" };
      validatedOps.push({ index, blockId: null });
    }
  }
  for (const operation of validatedOps) nextBlocks[operation.index] = operation.blockId as WorldState["blocks"][number];
  return { status: "applied", world: Object.freeze({ worldId: world.worldId, rev: commit.rev, blocks: Object.freeze(nextBlocks) }) };
}
