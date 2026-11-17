package org.fangcun.ar.poc;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One data-driven companion action.
 *
 * <p>An action is only a table entry: it declares how long it runs, whether it loops, and a
 * sampler that turns a normalised phase in {@code [0, 1]} into a {@link Pose}. The renderer
 * owns the clock, the skeleton and the object transform, so adding an action never requires
 * touching {@code ArPocRenderer} or {@code VrmModel}.</p>
 *
 * <p>See {@link CompanionActionRegistry} for the table and {@link CompanionPoseMath} for the
 * axis conventions and the easing/oscillator helpers used by the samplers.</p>
 */
final class CompanionAction {
    /** A pose sample. Bone names are VRM 1.0 humanoid names. */
    static final class Pose {
        /** Humanoid bone name -> local-space quaternion (x, y, z, w). */
        final Map<String, float[]> boneRotations;
        /** Translation added to the hips bone, in the VRM model's bind units (metres). */
        final float[] hipsOffset;
        /** Object-level yaw added to the companion's facing direction, in degrees. */
        final float bodyYawDegrees;
        /** Object-level vertical offset in AR world metres (used by the hop). */
        final float bodyLiftMeters;

        private Pose(Map<String, float[]> boneRotations, float[] hipsOffset, float bodyYawDegrees, float bodyLiftMeters) {
            this.boneRotations = boneRotations;
            this.hipsOffset = hipsOffset;
            this.bodyYawDegrees = bodyYawDegrees;
            this.bodyLiftMeters = bodyLiftMeters;
        }

        static Builder builder() { return new Builder(); }

        /** The neutral standing bind pose. */
        static Pose rest() { return builder().build(); }
    }

    /** Mutable helper that action tables use to assemble a {@link Pose}. */
    static final class Builder {
        private final Map<String, float[]> bones = new LinkedHashMap<>();
        private float hipsX;
        private float hipsY;
        private float hipsZ;
        private float yawDegrees;
        private float liftMeters;

        private Builder() { }

        /**
         * Adds a rotation about an axis in the bone's parent frame (the model frame for the
         * humanoid chain, because the bind rotations are near identity). Adding the same bone
         * twice composes the rotations, which keeps the sampler code readable.
         */
        Builder bone(String humanoidBone, float axisX, float axisY, float axisZ, float degrees) {
            float[] extra = VrmModel.axisAngle(axisX, axisY, axisZ, degrees);
            float[] existing = bones.get(humanoidBone);
            bones.put(humanoidBone, existing == null
                ? extra
                : CompanionPoseMath.multiplyQuaternions(extra, existing));
            return this;
        }

        /** Hips translation in bind units: +X is the companion's left, +Y up, +Z toward its face. */
        Builder hips(float x, float y, float z) {
            hipsX += x;
            hipsY += y;
            hipsZ += z;
            return this;
        }

        Builder bodyYaw(float degrees) {
            yawDegrees += degrees;
            return this;
        }

        Builder bodyLift(float meters) {
            liftMeters += meters;
            return this;
        }

        Pose build() {
            return new Pose(
                Collections.unmodifiableMap(new LinkedHashMap<>(bones)),
                new float[] {hipsX, hipsY, hipsZ},
                yawDegrees,
                liftMeters);
        }
    }

    /** Maps a normalised phase to a pose. Implementations must be side-effect free. */
    interface Sampler {
        Pose poseAt(float phase);
    }

    final String id;
    final String displayName;
    final boolean loop;
    final long durationMs;
    /** Relative frequency in the idle {@code auto} cycle; only meaningful for {@code auto}. */
    final int weight;
    private final Sampler sampler;

    CompanionAction(String id, String displayName, boolean loop, long durationMs, int weight, Sampler sampler) {
        if (id == null || id.isEmpty()) throw new IllegalArgumentException("action id is required");
        if (durationMs <= 0) throw new IllegalArgumentException("action duration must be positive");
        this.id = id;
        this.displayName = displayName == null ? id : displayName;
        this.loop = loop;
        this.durationMs = durationMs;
        this.weight = Math.max(1, weight);
        this.sampler = sampler;
    }

    /** Clamped sample; a phase outside {@code [0, 1]} is pinned to the nearest end. */
    Pose poseAt(float phase) {
        float clamped = phase < 0f ? 0f : (phase > 1f ? 1f : phase);
        return sampler.poseAt(clamped);
    }

    @Override public String toString() { return id; }
}
