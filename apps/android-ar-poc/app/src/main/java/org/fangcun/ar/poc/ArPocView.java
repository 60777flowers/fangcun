package org.fangcun.ar.poc;

import android.opengl.GLSurfaceView;
import com.google.ar.core.Session;

import java.util.concurrent.atomic.AtomicReference;

/** GLSurfaceView that renders the ARCore camera background and the replicated voxel island. */
final class ArPocView extends GLSurfaceView {
    private final ArPocRenderer renderer;
    private final AtomicReference<float[]> pendingTap = new AtomicReference<>();
    private volatile Session session;
    private final ArPocActivity activity;

    ArPocView(ArPocActivity activity, VoxelWorld world) {
        super(activity);
        this.activity = activity;
        setEGLContextClientVersion(2);
        renderer = new ArPocRenderer(activity, pendingTap, world);
        setRenderer(renderer);
        setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
    }

    void setSession(Session newSession) {
        session = newSession;
        queueEvent(() -> renderer.bindSessionIfReady(newSession));
    }

    void queueTap(float x, float y) {
        pendingTap.set(new float[]{x, y});
    }

    void clearPendingTap() { pendingTap.set(null); }

    /** Call on the GL thread after the replica changed. */
    void markWorldDirty() { queueEvent(() -> renderer.markWorldDirty()); }

    /** Updates the placeholder companion's visible behaviour. */
    void setCompanionState(String state) { queueEvent(() -> renderer.setCompanionState(state)); }

    /** Triggers a data-driven action by id ({@code auto} resumes the idle cycle). */
    void setAction(String id) { queueEvent(() -> renderer.setAction(id)); }

    /** Host-driven trigger: repeat a one-shot action until the Host's expiry time. */
    void playTimedAction(String id, long expiresAtMs) { queueEvent(() -> renderer.playTimedAction(id, expiresAtMs)); }

    /** Sets the name shown on the 3D nameplate above the companion's head. */
    void setCompanionName(String name) { queueEvent(() -> renderer.setCompanionName(name)); }

    /** Shows one line in the Animal-Crossing-style 3D speech bubble above the head. */
    void setCompanionSay(String text) { queueEvent(() -> renderer.say(text)); }

    /** Debug: draws the companion in front of the camera without needing a plane. */
    void setPreviewMode(boolean enabled) { queueEvent(() -> renderer.setPreviewMode(enabled)); }

    /** Debug: flips the texture V orientation. */
    void setFlipV(boolean enabled) { queueEvent(() -> renderer.setFlipV(enabled)); }

    /** Debug: forces a companion pose for tuning. */
    void setForcedPose(String pose) { queueEvent(() -> renderer.setForcedPose(pose)); }

    /** Debug: freezes a forced pose at one phase (0..1) for deterministic screenshots. */
    void setForcedPhase(float phase) { queueEvent(() -> renderer.setForcedPhase(phase)); }

    /** Drops the island anchor so the next tap re-anchors (used by the UI button). */
    void resetAnchor() { queueEvent(() -> renderer.releaseAnchorNow()); }

    @Override public void onResume() { super.onResume(); pendingTap.set(null); }
    @Override public void onPause() { pendingTap.set(null); super.onPause(); }
}
