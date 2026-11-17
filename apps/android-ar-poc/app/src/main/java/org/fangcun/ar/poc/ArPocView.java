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

    /** Drops the island anchor so the next tap re-anchors (used by the UI button). */
    void resetAnchor() { queueEvent(() -> renderer.releaseAnchorNow()); }

    @Override public void onResume() { super.onResume(); pendingTap.set(null); }
    @Override public void onPause() { pendingTap.set(null); super.onPause(); }
}
