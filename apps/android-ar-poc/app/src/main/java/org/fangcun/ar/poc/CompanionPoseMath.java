package org.fangcun.ar.poc;

/**
 * Pose math shared by every companion action.
 *
 * <h2>Bone axis conventions</h2>
 *
 * <p>The shipped {@code default.vrm} (VRM 1.0) is authored with a near-T-pose bind pose: the
 * humanoid bones carry only small rest rotations relative to the model root, and the model
 * faces {@code +Z} with {@code +Y} up. {@link VrmModel#applyPose} premultiplies the extra
 * quaternion before the bind rotation, so an action rotation is expressed in the bone's
 * parent frame — which for this rig is the model frame up to a couple of degrees of spine
 * lean. That makes every action table portable and readable in model axes:</p>
 *
 * <ul>
 *   <li>{@code +X} = the companion's left (its left arm/leg sits at +X),
 *       {@code -X} = its right.</li>
 *   <li>{@code +Y} = up.</li>
 *   <li>{@code +Z} = the direction the companion faces.</li>
 * </ul>
 *
 * <ul>
 *   <li>{@code upperLeg} / {@code lowerLeg}: rotate about {@code X} to swing forward/back.
 *       Negative {@code upperLeg} X lifts the thigh forward, positive {@code lowerLeg} X bends
 *       the knee so the shin drops; together they produce the ground-sit pose.</li>
 *   <li>{@code upperArm} / {@code lowerArm}: a {@code +Z} rotation raises the {@code +X} (left)
 *       arm sideways, a {@code -Z} rotation raises the {@code -X} (right) arm. {@code X} swings
 *       the arm forward/back and {@code Y} twists it.</li>
 *   <li>{@code head} / {@code spine}: {@code +Y} yaws to the companion's left, {@code X} nods
 *       ({@code +X} looks down towards the island), {@code Z} tilts.</li>
 *   <li>{@code hips}: {@code X} pitches the whole body; {@code -88} lies the companion on its
 *       back (its face turns up).</li>
 * </ul>
 *
 * <p>The numbers in {@link CompanionActionRegistry} were tuned against on-device screenshots;
 * if a pose reads wrong, fix the numbers there instead of adding renderer special cases.</p>
 */
final class CompanionPoseMath {
    private static final float TWO_PI = (float) (Math.PI * 2.0);

    private CompanionPoseMath() { }

    static float clamp01(float value) {
        return value < 0f ? 0f : (value > 1f ? 1f : value);
    }

    static float lerp(float from, float to, float t) {
        return from + (to - from) * t;
    }

    /** {@code sin(2π * cycles * phase)}; phase is normally the action's normalised phase. */
    static float sine(float cycles, float phase) {
        return (float) Math.sin(TWO_PI * cycles * phase);
    }

    static float smoothStep(float edge0, float edge1, float value) {
        if (edge1 <= edge0) return value >= edge1 ? 1f : 0f;
        float t = clamp01((value - edge0) / (edge1 - edge0));
        return t * t * (3f - 2f * t);
    }

    static float easeOutCubic(float t) {
        float inverse = 1f - clamp01(t);
        return 1f - inverse * inverse * inverse;
    }

    /** Overshooting ease used by the speech bubble pop-in. */
    static float easeOutBack(float t) {
        float clamped = clamp01(t);
        float c = 1.70158f;
        float x = clamped - 1f;
        return 1f + (c + 1f) * x * x * x + c * x * x;
    }

    /**
     * Piecewise-linear keyframes: {@code times} must be strictly ascending and the same length
     * as {@code values}; the first key is assumed to be at phase 0.
     */
    static float keyframes(float phase, float[] times, float[] values) {
        int count = Math.min(times.length, values.length);
        if (count == 0) return 0f;
        if (phase <= times[0]) return values[0];
        for (int index = 1; index < count; index += 1) {
            if (phase <= times[index]) {
                float span = times[index] - times[index - 1];
                float t = span <= 1e-6f ? 1f : (phase - times[index - 1]) / span;
                return lerp(values[index - 1], values[index], t);
            }
        }
        return values[count - 1];
    }

    /** Hamilton product {@code a * b} for unit quaternions stored as (x, y, z, w). */
    static float[] multiplyQuaternions(float[] a, float[] b) {
        float ax = a[0], ay = a[1], az = a[2], aw = a[3];
        float bx = b[0], by = b[1], bz = b[2], bw = b[3];
        return new float[] {
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw,
            aw * bw - ax * bx - ay * by - az * bz,
        };
    }
}
