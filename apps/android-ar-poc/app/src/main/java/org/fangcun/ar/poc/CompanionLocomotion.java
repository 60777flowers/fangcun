package org.fangcun.ar.poc;

/**
 * Island-local companion locomotion: position, short walk steps, hops and smooth turning.
 *
 * <p>All coordinates are island-local metres (island is 48 cm wide, one voxel is 3 cm). The
 * companion only ever stands on "standable" columns (the two build cells above the terrain are
 * free), walks in short steps toward a goal, and hops over a blocking column instead of passing
 * through it. Facing is a separate smoothed yaw: {@code yawDeg=0} means the model faces island
 * +Z (its bind-pose front), so {@code yawDeg = atan2(dx, dz)} points at a target.</p>
 */
final class CompanionLocomotion {
    /** Max horizontal distance the companion can place a block from (~1.5 arm lengths). */
    static final float REACH_METERS = 0.30f;
    static final float WALK_SPEED = 0.26f;          // m/s
    static final float TURN_DEG_PER_SEC = 480f;     // ~90 degrees in ~190 ms
    static final float ISLAND_LIMIT = 0.215f;       // keep the body inside the island footprint
    private static final float HOP_HEIGHT = 0.11f;
    private static final float STEP_BOB = 0.006f;

    float x;
    float z;
    float yawDeg;
    /** Extra vertical offset from steps/hops, added to the companion object transform. */
    float lift;

    private float targetYawDeg;
    private boolean snapYaw = true;
    private boolean walking;
    private boolean hopping;
    private float walkFromX;
    private float walkFromZ;
    private float walkToX;
    private float walkToZ;
    private long walkStartMs;
    private long walkDurationMs;
    private long lastUpdateMs = -1;

    /** Teleports the companion to the island centre and snaps its facing on the next update. */
    void resetToCentre() {
        x = 0f;
        z = 0f;
        walkFromX = 0f;
        walkFromZ = 0f;
        walkToX = 0f;
        walkToZ = 0f;
        walking = false;
        hopping = false;
        lift = 0f;
        yawDeg = 0f;
        targetYawDeg = 0f;
        snapYaw = true;
        lastUpdateMs = -1;
    }

    boolean withinReach(float targetX, float targetZ) {
        return horizontalDistance(targetX, targetZ) <= REACH_METERS;
    }

    /** True when the companion is within {@code distance} metres of the island-local target. */
    boolean withinDistance(float targetX, float targetZ, float distance) {
        return horizontalDistance(targetX, targetZ) <= distance;
    }

    /** Points the smoothed facing at a cell centre (used for the block being built). */
    void faceTowards(float targetX, float targetZ) {
        targetYawDeg = angleTo(targetX, targetZ);
    }

    /** Points the smoothed facing at the user, with a slow idle sway added. */
    void faceCamera(float cameraX, float cameraZ, float idleSwayDeg) {
        targetYawDeg = angleTo(cameraX, cameraZ) + idleSwayDeg;
    }

    /** True when the companion is currently walking or hopping. */
    boolean moving() { return walking; }

    /**
     * Walks to a free column near {@code (targetX, targetZ)} while keeping it in reach. If no free
     * column can be found nearby the companion hops straight over the blockage instead.
     */
    void walkNear(float targetX, float targetZ, long nowMs, VoxelWorld world) {
        walkNear(targetX, targetZ, nowMs, world, REACH_METERS * 0.72f);
    }

    /**
     * Walks to a free column near {@code (targetX, targetZ)} at the given standing distance. If no
     * free column can be found nearby the companion hops straight over the blockage instead.
     */
    void walkNear(float targetX, float targetZ, long nowMs, VoxelWorld world, float standingDistance) {
        float dx = x - targetX;
        float dz = z - targetZ;
        float length = (float) Math.sqrt(dx * dx + dz * dz);
        if (length < 1e-4f) {
            dx = 1f;
            dz = 0f;
            length = 1f;
        }
        float desiredX = clamp(targetX + dx / length * standingDistance, -ISLAND_LIMIT, ISLAND_LIMIT);
        float desiredZ = clamp(targetZ + dz / length * standingDistance, -ISLAND_LIMIT, ISLAND_LIMIT);
        float[] spot = nearestStandable(desiredX, desiredZ, world);
        if (spot != null) {
            startWalk(spot[0], spot[1], nowMs, false);
        } else {
            // No free column nearby (e.g. the middle of a roof): hop straight to the goal.
            startWalk(clamp(desiredX, -ISLAND_LIMIT, ISLAND_LIMIT),
                clamp(desiredZ, -ISLAND_LIMIT, ISLAND_LIMIT), nowMs, true);
        }
    }

    /** Walks to the nearest free column (used before sitting down / "walk to the seat"). */
    void walkToNearestFreeSpot(long nowMs, VoxelWorld world) {
        float[] spot = nearestStandable(x, z, world);
        if (spot != null) startWalk(spot[0], spot[1], nowMs, false);
    }

    /**
     * Walks to the nearest {@code stairs} block and hops onto it, so the companion can sit on the
     * finished house's seat block instead of on the grass.
     */
    boolean walkToNearestSeat(long nowMs, VoxelWorld world) {
        float bestX = 0f;
        float bestZ = 0f;
        float bestDistance = Float.MAX_VALUE;
        for (int vx = VoxelWorld.ORIGIN; vx < VoxelWorld.ORIGIN + VoxelWorld.SIZE; vx += 1) {
            for (int vz = VoxelWorld.ORIGIN; vz < VoxelWorld.ORIGIN + VoxelWorld.SIZE; vz += 1) {
                if (!world.isStairsColumn(vx, vz)) continue;
                float candX = (vx + 0.5f) * VoxelWorld.VOXEL_METERS;
                float candZ = (vz + 0.5f) * VoxelWorld.VOXEL_METERS;
                float distance = (candX - x) * (candX - x) + (candZ - z) * (candZ - z);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestX = candX;
                    bestZ = candZ;
                }
            }
        }
        if (bestDistance == Float.MAX_VALUE) return false;
        // The seat column is solid (one block high): hop onto it.
        startWalk(bestX, bestZ, nowMs, bestDistance > 0.0004f);
        return true;
    }

    /**
     * Time the renderer should delay a block's pop-in so the companion can first walk into reach.
     * Returns 0 when the target is already within reach.
     */
    long extraTravelDelayMs(float targetX, float targetZ) {
        float distance = horizontalDistance(targetX, targetZ);
        if (distance <= REACH_METERS) return 0L;
        float travel = (distance - REACH_METERS * 0.72f) / WALK_SPEED;
        return (long) Math.max(140f, Math.min(700f, travel * 1000f));
    }

    /** Advances walking, hopping and facing. GL thread, once per frame. */
    void update(long nowMs, VoxelWorld world) {
        if (lastUpdateMs < 0) lastUpdateMs = nowMs;
        long deltaMs = Math.max(0L, nowMs - lastUpdateMs);
        lastUpdateMs = nowMs;
        if (walking) {
            float t = CompanionPoseMath.clamp01((nowMs - walkStartMs) / (float) Math.max(1L, walkDurationMs));
            float eased = t * t * (3f - 2f * t);
            float candidateX = walkFromX + (walkToX - walkFromX) * eased;
            float candidateZ = walkFromZ + (walkToZ - walkFromZ) * eased;
            if (!hopping && !standableOrSeat(cellOf(candidateX), cellOf(candidateZ), world)) {
                // Path is blocked: hop over the column instead of clipping through it.
                hopping = true;
                android.util.Log.i("CompanionMove", String.format(java.util.Locale.US,
                    "hop over blocked cell x=%d z=%d (from %.3f,%.3f to %.3f,%.3f)",
                    cellOf(candidateX), cellOf(candidateZ), walkFromX, walkFromZ, walkToX, walkToZ));
            }
            x = candidateX;
            z = candidateZ;
            lift = hopping
                ? (float) Math.sin(Math.PI * t) * HOP_HEIGHT
                : (float) Math.sin(Math.PI * t) * STEP_BOB;
            if (t >= 1f) {
                walking = false;
                hopping = false;
                lift = 0f;
                if (!standableOrSeat(cellOf(x), cellOf(z), world)) {
                    float[] spot = nearestStandable(x, z, world);
                    if (spot != null) {
                        x = spot[0];
                        z = spot[1];
                    }
                }
            }
        } else {
            lift *= 0.5f;
            if (lift < 1e-4f) lift = 0f;
        }
        float yawStep = TURN_DEG_PER_SEC * (deltaMs / 1000f);
        if (snapYaw) {
            // The first frame after (re)placing the island must already face the user.
            yawDeg = normalizeYaw(targetYawDeg);
            snapYaw = false;
        } else {
            float difference = normalizeYaw(targetYawDeg - yawDeg);
            yawDeg = normalizeYaw(yawDeg + Math.max(-yawStep, Math.min(yawStep, difference)));
        }
    }

    private void startWalk(float targetX, float targetZ, long nowMs, boolean hop) {
        walkFromX = x;
        walkFromZ = z;
        walkToX = clamp(targetX, -ISLAND_LIMIT, ISLAND_LIMIT);
        walkToZ = clamp(targetZ, -ISLAND_LIMIT, ISLAND_LIMIT);
        if (Math.abs(walkToX - walkFromX) < 0.005f && Math.abs(walkToZ - walkFromZ) < 0.005f) {
            // Already on the target cell: do not restart a zero-length step every frame.
            walking = false;
            hopping = false;
            return;
        }
        float distance = horizontalDistance(walkToX, walkToZ);
        walkDurationMs = (long) Math.max(150f, Math.min(720f, distance / WALK_SPEED * 1000f));
        walkStartMs = nowMs;
        walking = true;
        hopping = hop;
        lift = 0f;
        android.util.Log.i("CompanionMove", String.format(java.util.Locale.US,
            "walk from (%.3f,%.3f) to (%.3f,%.3f) durationMs=%d hop=%s",
            walkFromX, walkFromZ, walkToX, walkToZ, walkDurationMs, hop));
    }

    /** Finds the closest standable column centre around a point, searching up to 3 cells away. */
    private float[] nearestStandable(float pointX, float pointZ, VoxelWorld world) {
        int centreX = cellOf(pointX);
        int centreZ = cellOf(pointZ);
        for (int ring = 0; ring <= 3; ring += 1) {
            float[] best = null;
            float bestDistance = Float.MAX_VALUE;
            for (int dx = -ring; dx <= ring; dx += 1) {
                for (int dz = -ring; dz <= ring; dz += 1) {
                    if (Math.max(Math.abs(dx), Math.abs(dz)) != ring) continue;
                    int voxelX = centreX + dx;
                    int voxelZ = centreZ + dz;
                    if (!standable(voxelX, voxelZ, world)) continue;
                    float candX = (voxelX + 0.5f) * VoxelWorld.VOXEL_METERS;
                    float candZ = (voxelZ + 0.5f) * VoxelWorld.VOXEL_METERS;
                    float distance = (candX - pointX) * (candX - pointX) + (candZ - pointZ) * (candZ - pointZ);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        best = new float[] {candX, candZ};
                    }
                }
            }
            if (best != null) return best;
        }
        return null;
    }

    private static boolean standable(int voxelX, int voxelZ, VoxelWorld world) {
        if (!world.insideColumn(voxelX, voxelZ)) return false;
        return !world.isSolid(voxelX, 1, voxelZ) && !world.isSolid(voxelX, 2, voxelZ);
    }

    /** Free column, or a stairs block the companion may stand/sit on top of. */
    private static boolean standableOrSeat(int voxelX, int voxelZ, VoxelWorld world) {
        return standable(voxelX, voxelZ, world) || world.isStairsColumn(voxelX, voxelZ);
    }

    private static int cellOf(float metres) {
        return (int) Math.floor(metres / VoxelWorld.VOXEL_METERS);
    }

    private float horizontalDistance(float targetX, float targetZ) {
        float dx = targetX - x;
        float dz = targetZ - z;
        return (float) Math.sqrt(dx * dx + dz * dz);
    }

    /** Facing yaw that points from the companion to an island-local target. */
    private float angleTo(float targetX, float targetZ) {
        return (float) Math.toDegrees(Math.atan2(targetX - x, targetZ - z));
    }

    private static float normalizeYaw(float degrees) {
        float value = degrees % 360f;
        if (value > 180f) value -= 360f;
        if (value < -180f) value += 360f;
        return value;
    }

    private static float clamp(float value, float min, float max) {
        return value < min ? min : (value > max ? max : value);
    }
}
