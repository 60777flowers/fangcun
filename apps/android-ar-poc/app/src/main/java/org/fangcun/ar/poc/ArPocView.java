package org.fangcun.ar.poc;

import android.opengl.GLSurfaceView;
import com.google.ar.core.Session;

import java.util.concurrent.atomic.AtomicReference;

/** GLSurfaceView that renders ARCore camera background and a single anchored GLES cube. */
final class ArPocView extends GLSurfaceView {
    private final ArPocRenderer renderer;
    private final AtomicReference<float[]> pendingTap = new AtomicReference<>();
    private volatile Session session;
    private final ArPocActivity activity;

    ArPocView(ArPocActivity activity) {
        super(activity);
        this.activity = activity;
        setEGLContextClientVersion(2);
        renderer = new ArPocRenderer(activity, pendingTap);
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

    @Override public void onResume() { super.onResume(); pendingTap.set(null); }
    @Override public void onPause() { pendingTap.set(null); super.onPause(); }
}
