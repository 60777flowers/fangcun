package org.fangcun.ar.poc;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The companion's frozen action table.
 *
 * <p>Adding an action is one entry here — the renderer only knows how to ask for a pose, it
 * has no per-action branches. Two kinds of entries exist:</p>
 *
 * <ul>
 *   <li><b>Public actions</b> ({@code stand}, {@code sit}, {@code lie}, {@code wave},
 *       {@code jump}, {@code look_around}): listed by {@link #publicActionIds()} so the Host or
 *       PC inspector can offer and trigger them, and sampled by the weighted {@code auto}
 *       idle cycle.</li>
 *   <li><b>Internal actions</b> ({@code build}): played while a {@code companion_state} of
 *       {@code building}/{@code planning} arrives, so build behaviour never fights the idle
 *       cycle. It is reachable by id but not advertised, and it never joins the auto cycle.</li>
 * </ul>
 *
 * <p>Weights are expressed by repeating an action in {@link #AUTO_SEQUENCE}; the cycle length is
 * the sum of the durations, so the idle behaviour is deterministic and easy to reason about.</p>
 */
final class CompanionActionRegistry {
    /** Pseudo-id: cycle the idle actions. Also accepted by {@code setAction}. */
    static final String AUTO = "auto";
    /** Internal id played while the companion reports building/planning. */
    static final String BUILD = "build";

    private static final CompanionActionRegistry INSTANCE = new CompanionActionRegistry();

    static CompanionActionRegistry get() { return INSTANCE; }

    private final List<CompanionAction> publicActions;
    private final Map<String, CompanionAction> byId;
    private final List<CompanionAction> autoSequence;
    private final long autoCycleMs;
    private final CompanionAction buildAction;

    private CompanionActionRegistry() {
        List<CompanionAction> publicList = new ArrayList<>();
        publicList.add(stand());
        publicList.add(sit());
        publicList.add(lie());
        publicList.add(wave());
        publicList.add(jump());
        publicList.add(lookAround());
        publicActions = Collections.unmodifiableList(publicList);

        buildAction = build();
        Map<String, CompanionAction> table = new LinkedHashMap<>();
        for (CompanionAction action : publicList) table.put(action.id, action);
        table.put(buildAction.id, buildAction);
        byId = Collections.unmodifiableMap(table);

        // Weighted idle cycle: stand dominates, sit/look-around are frequent, lying down and
        // the one-shot wave/jump are the occasional beats. Durations come from the actions.
        autoSequence = Collections.unmodifiableList(Arrays.asList(
            byId.get("stand"),
            byId.get("sit"),
            byId.get("stand"),
            byId.get("look_around"),
            byId.get("stand"),
            byId.get("lie"),
            byId.get("stand"),
            byId.get("wave"),
            byId.get("jump"),
            byId.get("stand")));
        long total = 0;
        for (CompanionAction action : autoSequence) total += action.durationMs;
        autoCycleMs = total;
    }

    CompanionAction find(String id) {
        return id == null ? null : byId.get(id);
    }

    /** Public, Host-listable actions in registration order. */
    List<CompanionAction> publicActions() { return publicActions; }

    /** Public ids, {@code auto} first so a UI can offer the full set. */
    String[] publicActionIds() {
        String[] ids = new String[publicActions.size() + 1];
        ids[0] = AUTO;
        for (int index = 0; index < publicActions.size(); index += 1) ids[index + 1] = publicActions.get(index).id;
        return ids;
    }

    /** Display labels parallel to {@link #publicActionIds()}. */
    String[] publicActionLabels() {
        String[] labels = new String[publicActions.size() + 1];
        labels[0] = "自动";
        for (int index = 0; index < publicActions.size(); index += 1) labels[index + 1] = publicActions.get(index).displayName;
        return labels;
    }

    long autoCycleMs() { return autoCycleMs; }

    CompanionAction buildAction() { return buildAction; }

    /**
     * Picks the idle action for {@code elapsedMs} into the weighted cycle. Writes the offset of
     * that action inside the cycle to {@code startOffsetMsOut[0]} (allocation-free: called per
     * frame on the GL thread).
     */
    CompanionAction autoAction(long elapsedMs, long[] startOffsetMsOut) {
        long position = elapsedMs < 0 ? 0 : elapsedMs % autoCycleMs;
        long cursor = 0;
        for (CompanionAction action : autoSequence) {
            long next = cursor + action.durationMs;
            if (position < next) {
                startOffsetMsOut[0] = cursor;
                return action;
            }
            cursor = next;
        }
        startOffsetMsOut[0] = 0;
        return autoSequence.get(0);
    }

    // ------------------------------------------------------------------------------------
    // Action table. Numbers were tuned from on-device screenshots; axis conventions live in
    // CompanionPoseMath. All hips offsets are bind units (a 1.5 m rig), all body yaw values are
    // degrees and body lift is measured in avatar heights.
    // ------------------------------------------------------------------------------------

    /** Idle: weight shift, breathing, a small head sway and a lazy body turn. */
    private static CompanionAction stand() {
        return new CompanionAction("stand", "站立", true, 6000L, 5, phase -> {
            float breathe = CompanionPoseMath.sine(0.5f, phase);
            float sway = CompanionPoseMath.sine(1f, phase);
            return CompanionAction.Pose.builder()
                .hips(0.008f * sway, 0.004f * breathe, 0f)
                .bone("spine", 0f, 0f, 1f, 1.8f * sway)
                .bone("head", 0f, 1f, 0f, 3.5f * sway)
                .bone("head", 1f, 0f, 0f, 1.2f * breathe)
                // The bind pose is a T-pose; relax the arms to a friendly A-pose.
                .bone("leftUpperArm", 0f, 0f, 1f, -22f + 1.5f * sway)
                .bone("rightUpperArm", 0f, 0f, 1f, 22f - 1.5f * sway)
                .bone("leftLowerArm", 0f, 0f, 1f, -8f)
                .bone("rightLowerArm", 0f, 0f, 1f, 8f)
                .bodyYaw(3.0f * sway)
                .build();
        });
    }

    /**
     * Ground sit: thighs forward and slightly splayed so the feet peek out of the wide dress,
     * shins down, hips lowered, and a blank stare with a slow bob.
     */
    private static CompanionAction sit() {
        return new CompanionAction("sit", "坐下", true, 8000L, 2, phase -> {
            float bob = CompanionPoseMath.sine(0.5f, phase);
            return CompanionAction.Pose.builder()
                .bone("leftUpperLeg", 1f, 0f, 0f, -78f)
                .bone("rightUpperLeg", 1f, 0f, 0f, -78f)
                .bone("leftUpperLeg", 0f, 0f, 1f, 16f)
                .bone("rightUpperLeg", 0f, 0f, 1f, -16f)
                .bone("leftLowerLeg", 1f, 0f, 0f, 84f)
                .bone("rightLowerLeg", 1f, 0f, 0f, 84f)
                .bone("spine", 1f, 0f, 0f, 5f)
                .bone("head", 1f, 0f, 0f, 2f + 1.5f * bob)
                .bone("head", 0f, 1f, 0f, 1.5f * bob)
                .bone("leftUpperArm", 0f, 0f, 1f, -16f)
                .bone("rightUpperArm", 0f, 0f, 1f, 16f)
                .hips(0f, -0.42f + 0.005f * bob, 0f)
                .bodyYaw(1.5f * bob)
                .build();
        });
    }

    /** Sleep: lie on the back, face up, with slow breathing through a tiny hips rise. */
    private static CompanionAction lie() {
        return new CompanionAction("lie", "躺下", true, 10000L, 1, phase -> {
            float breathe = CompanionPoseMath.sine(0.5f, phase);
            float pitch = debugLiePitch != null ? debugLiePitch : 88f;
            float drop = debugLieDrop != null ? debugLieDrop : -0.90f;
            return CompanionAction.Pose.builder()
                .bone("hips", 1f, 0f, 0f, pitch)
                .bone("head", 1f, 0f, 0f, 6f + 1.5f * breathe)
                .bone("head", 0f, 0f, 1f, 5f)
                .bone("spine", 1f, 0f, 0f, 1.5f * breathe)
                .hips(0f, drop + 0.014f * breathe, 0f)
                .build();
        });
    }

    /** Debug tuning hooks for the lying pose (`--ef liePitch` / `--ef lieDrop`). */
    static volatile Float debugLiePitch;
    static volatile Float debugLieDrop;

    /**
     * One arm wave. The avatar is a chibi whose head is wider than its arm span, so the arm is
     * raised forward-and-up (out of the head silhouette) before the forearm waves: that keeps the
     * gesture readable from the tabletop camera angle.
     */
    private static CompanionAction wave() {
        return new CompanionAction("wave", "挥手", false, 2000L, 1, phase -> {
            float raise = CompanionPoseMath.smoothStep(0.02f, 0.18f, phase)
                * (1f - CompanionPoseMath.smoothStep(0.82f, 0.98f, phase));
            float wavePhase = CompanionPoseMath.clamp01((phase - 0.18f) / 0.64f);
            float wave = CompanionPoseMath.sine(3f, wavePhase) * raise;
            return CompanionAction.Pose.builder()
                .bone("leftUpperArm", 0f, 1f, 0f, 32f * raise)
                .bone("leftUpperArm", 0f, 0f, 1f, 64f * raise)
                .bone("leftLowerArm", 0f, 0f, 1f, 60f * raise + 22f * wave)
                .bone("leftLowerArm", 0f, 1f, 0f, 18f * wave)
                .bone("leftHand", 0f, 1f, 0f, 16f * wave)
                .bone("head", 0f, 1f, 0f, 8f * raise)
                .bone("head", 0f, 0f, 1f, -8f * raise)
                .bodyYaw(-4f * raise)
                .build();
        });
    }

    /** Hop: crouch, leave the ground via an object-level lift, tuck, land. Plays once. */
    private static CompanionAction jump() {
        return new CompanionAction("jump", "跳一跳", false, 950L, 1, phase -> {
            float air = CompanionPoseMath.smoothStep(0.18f, 0.28f, phase)
                * (1f - CompanionPoseMath.smoothStep(0.72f, 0.82f, phase));
            float takeoff = 1f - CompanionPoseMath.smoothStep(0.04f, 0.24f, phase);
            float landing = CompanionPoseMath.smoothStep(0.78f, 0.90f, phase)
                * (1f - CompanionPoseMath.smoothStep(0.94f, 1f, phase));
            float crouch = takeoff + 0.8f * landing;
            float arc = (float) Math.sin(Math.PI * CompanionPoseMath.clamp01((phase - 0.20f) / 0.56f));
            return CompanionAction.Pose.builder()
                .bone("leftUpperLeg", 1f, 0f, 0f, -30f * crouch - 14f * air)
                .bone("rightUpperLeg", 1f, 0f, 0f, -30f * crouch - 14f * air)
                .bone("leftLowerLeg", 1f, 0f, 0f, 60f * crouch + 26f * air)
                .bone("rightLowerLeg", 1f, 0f, 0f, 60f * crouch + 26f * air)
                .bone("leftUpperArm", 0f, 0f, 1f, -14f + 26f * air)
                .bone("rightUpperArm", 0f, 0f, 1f, 14f - 26f * air)
                .bone("spine", 1f, 0f, 0f, 5f * crouch)
                .bone("head", 1f, 0f, 0f, -4f * air)
                .hips(0f, -0.12f * crouch + 0.02f * air, 0f)
                .bodyLift(0.48f * arc)
                .build();
        });
    }

    /** Look around: sweep the head to the left, then the right, and settle back. */
    private static CompanionAction lookAround() {
        float[] times = {0f, 0.12f, 0.32f, 0.44f, 0.64f, 0.78f, 1f};
        float[] yawDegrees = {0f, 42f, 42f, -38f, -38f, 0f, 0f};
        return new CompanionAction("look_around", "张望", true, 7000L, 2, phase -> {
            float yaw = CompanionPoseMath.keyframes(phase, times, yawDegrees);
            float nod = CompanionPoseMath.sine(2f, phase);
            return CompanionAction.Pose.builder()
                .bone("head", 0f, 1f, 0f, yaw)
                .bone("head", 1f, 0f, 0f, -2f + 1.5f * nod)
                .bone("spine", 0f, 1f, 0f, 0.18f * yaw)
                .bodyYaw(0.2f * yaw)
                .build();
        });
    }

    /**
     * Internal build action: faced towards the island, tapping with the right hand while the
     * Host reports building/planning. The hop keeps the build beat visible at a distance.
     */
    private static CompanionAction build() {
        return new CompanionAction(BUILD, "建造", true, 1400L, 0, phase -> {
            float tap = Math.max(0f, CompanionPoseMath.sine(2f, phase));
            return CompanionAction.Pose.builder()
                .bone("head", 1f, 0f, 0f, 16f)
                .bone("spine", 1f, 0f, 0f, 5f)
                .bone("rightUpperArm", 0f, 1f, 0f, 38f)
                .bone("rightUpperArm", 0f, 0f, 1f, -18f - 22f * tap)
                .bone("rightLowerArm", 0f, 0f, 1f, -34f - 26f * tap)
                .bone("leftUpperArm", 0f, 0f, 1f, 6f)
                .hips(0f, -0.02f - 0.02f * tap, 0f)
                .bodyLift(0.06f * Math.abs(CompanionPoseMath.sine(2f, phase)))
                .build();
        });
    }
}
