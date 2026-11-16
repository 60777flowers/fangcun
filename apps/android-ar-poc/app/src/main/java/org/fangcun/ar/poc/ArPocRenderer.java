package org.fangcun.ar.poc;

import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.opengl.Matrix;

import com.google.ar.core.Anchor;
import com.google.ar.core.Camera;
import com.google.ar.core.Frame;
import com.google.ar.core.HitResult;
import com.google.ar.core.Plane;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.CameraNotAvailableException;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.util.concurrent.atomic.AtomicReference;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/** GLES 2 renderer: ARCore camera background + one colored cube at a horizontal plane anchor. */
final class ArPocRenderer implements GLSurfaceView.Renderer {
    private static final float CUBE_HALF = 0.035f;
    private static final float CUBE_CENTER_Y = CUBE_HALF;
    private static final int FLOAT_BYTES = 4;

    private final ArPocActivity activity;
    private final AtomicReference<float[]> pendingTap;
    private final float[] viewMatrix = new float[16];
    private final float[] projectionMatrix = new float[16];
    private final float[] modelMatrix = new float[16];
    private final float[] modelView = new float[16];
    private final float[] mvp = new float[16];
    private final FloatBuffer vertices;
    private final FloatBuffer colors;
    private volatile Session session;
    private Anchor anchor;
    private BackgroundRenderer background;
    private int program;
    private int positionHandle;
    private int colorHandle;
    private int mvpHandle;
    private int surfaceWidth;
    private int surfaceHeight;
    private long lastStatusMs;
    private long tapDiagnosticUntilMs;
    private String tapDiagnostic = "";
    private Session textureSession;

    ArPocRenderer(ArPocActivity activity, AtomicReference<float[]> pendingTap) {
        this.activity = activity;
        this.pendingTap = pendingTap;
        float[] cube = cubeVertices(CUBE_HALF);
        vertices = directBuffer(cube);
        colors = directBuffer(cubeColors());
    }

    void setSession(Session session) { this.session = session; }

    private boolean glReady;
    private String startupError;

    void bindSessionIfReady(Session session) {
        this.session = session;
        if (glReady) attachSessionTexture(session);
    }

    private void attachSessionTexture(Session session) {
        if (background == null || !glReady) return;
        try {
            background.attachToSession(session);
            textureSession = session;
            startupError = null;
        } catch (RuntimeException error) {
            textureSession = null;
            startupError = "Camera texture setup failed: " + error.getClass().getSimpleName();
        }
    }

    @Override public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        GLES20.glClearColor(0f, 0f, 0f, 1f);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
        releaseAnchor();
        try {
            program = createProgram(VERTEX_SHADER, FRAGMENT_SHADER);
            positionHandle = GLES20.glGetAttribLocation(program, "a_Position");
            colorHandle = GLES20.glGetAttribLocation(program, "a_Color");
            mvpHandle = GLES20.glGetUniformLocation(program, "u_Mvp");
            background = new BackgroundRenderer();
            background.createOnGlThread(activity);
            glReady = true;
            Session current = session != null ? session : activity.currentSession();
            if (current != null) attachSessionTexture(current);
            startupError = null;
        } catch (RuntimeException error) {
            glReady = false;
            textureSession = null;
            startupError = "Renderer init failed: " + error.getMessage();
            activity.setStatus(startupError);
        }
    }

    @Override public void onSurfaceChanged(GL10 gl, int width, int height) {
        surfaceWidth = width;
        surfaceHeight = height;
        GLES20.glViewport(0, 0, width, height);
        if (session != null) {
            try { session.setDisplayGeometry(activity.getWindowManager().getDefaultDisplay().getRotation(), width, height); }
            catch (RuntimeException ignored) { /* Session may be paused; next frame will retry. */ }
        }
    }

    @Override public void onDrawFrame(GL10 gl) {
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT | GLES20.GL_DEPTH_BUFFER_BIT);
        Session current = session;
        if (current == null) {
            publishStatus("Waiting for AR session");
            return;
        }
        try {
            if (startupError != null) {
                publishStatus(startupError);
                return;
            }
            current.setDisplayGeometry(activity.getWindowManager().getDefaultDisplay().getRotation(), surfaceWidth, surfaceHeight);
            if (background == null || background.textureId() == 0 || textureSession != current) {
                publishStatus("Preparing camera texture — writes disabled");
                return;
            }
            Frame frame = current.update();
            Camera camera = frame.getCamera();
            background.draw(frame);
            if (camera.getTrackingState() != TrackingState.TRACKING) {
                // Fail closed: don't render stale anchored content or replay taps after relocalization.
                pendingTap.set(null);
                releaseAnchor();
                publishStatus("Tracking lost/relocalizing — world writes disabled");
                return;
            }
            camera.getViewMatrix(viewMatrix, 0);
            camera.getProjectionMatrix(projectionMatrix, 0, 0.1f, 100f);
            processTap(current, frame);
            if (anchor == null || anchor.getTrackingState() != TrackingState.TRACKING) {
                int planeCount = 0;
                for (Plane trackedPlane : current.getAllTrackables(Plane.class)) if (trackedPlane.getTrackingState() == TrackingState.TRACKING) planeCount++;
                String message = System.currentTimeMillis() < tapDiagnosticUntilMs ? tapDiagnostic : "Tracking camera — planes: " + planeCount + ". Move device slowly, then tap tabletop.";
                publishStatus(message);
                return;
            }
            anchor.getPose().toMatrix(modelMatrix, 0);
            modelMatrix[12] += modelMatrix[4] * CUBE_CENTER_Y;
            modelMatrix[13] += modelMatrix[5] * CUBE_CENTER_Y;
            modelMatrix[14] += modelMatrix[6] * CUBE_CENTER_Y;
            Matrix.multiplyMM(modelView, 0, viewMatrix, 0, modelMatrix, 0);
            Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);
            drawCube();
            publishStatus("Tracking: RUNNING\nAnchor placed — camera tracking is required to continue");
        } catch (CameraNotAvailableException e) {
            releaseAnchor();
            publishStatus("Camera unavailable — AR paused, writes disabled");
        } catch (RuntimeException e) {
            releaseAnchor();
            publishStatus("AR frame error — writes disabled");
        }
    }

    private void processTap(Session current, Frame frame) {
        float[] tap = pendingTap.getAndSet(null);
        if (tap == null || frame.getCamera().getTrackingState() != TrackingState.TRACKING) return;
        int planeHits = 0;
        for (HitResult hit : frame.hitTest(tap[0], tap[1])) {
            if (!(hit.getTrackable() instanceof Plane)) continue;
            planeHits++;
            Plane plane = (Plane) hit.getTrackable();
            if (plane.getTrackingState() != TrackingState.TRACKING || !plane.isPoseInPolygon(hit.getHitPose())) continue;
            Anchor newAnchor;
            try { newAnchor = hit.createAnchor(); }
            catch (RuntimeException e) { publishStatus("Anchor creation failed — tap again"); return; }
            releaseAnchor();
            anchor = newAnchor;
            publishStatus("Anchor placed on detected horizontal plane");
            return;
        }
        tapDiagnostic = planeHits == 0 ? "Tap missed plane — move device to map surface, retry."
            : "Plane hit outside detected surface polygon — keep moving, retry.";
        tapDiagnosticUntilMs = System.currentTimeMillis() + 2500;
        publishStatus(tapDiagnostic);
    }

    private void drawCube() {
        GLES20.glUseProgram(program);
        GLES20.glUniformMatrix4fv(mvpHandle, 1, false, mvp, 0);
        vertices.position(0);
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 0, vertices);
        colors.position(0);
        GLES20.glEnableVertexAttribArray(colorHandle);
        GLES20.glVertexAttribPointer(colorHandle, 4, GLES20.GL_FLOAT, false, 0, colors);
        // Six faces, two triangles per face. Colors intentionally make axis/orientation visible.
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 36);
        GLES20.glDisableVertexAttribArray(positionHandle);
        GLES20.glDisableVertexAttribArray(colorHandle);
    }

    private void releaseAnchor() {
        Anchor old = anchor;
        anchor = null;
        if (old != null) old.detach();
    }

    private void publishStatus(String message) {
        long now = System.currentTimeMillis();
        if (now - lastStatusMs < 250) return;
        lastStatusMs = now;
        activity.setStatus(message);
    }

    private static FloatBuffer directBuffer(float[] values) {
        FloatBuffer buffer = ByteBuffer.allocateDirect(values.length * FLOAT_BYTES).order(ByteOrder.nativeOrder()).asFloatBuffer();
        buffer.put(values).position(0);
        return buffer;
    }

    private static float[] cubeVertices(float h) {
        float[][] faces = {
            {-h,-h,h, h,-h,h, h,h,h, -h,-h,h, h,h,h, -h,h,h},
            {h,-h,-h, -h,-h,-h, -h,h,-h, h,-h,-h, -h,h,-h, h,h,-h},
            {-h,-h,-h, -h,-h,h, -h,h,h, -h,-h,-h, -h,h,h, -h,h,-h},
            {h,-h,h, h,-h,-h, h,h,-h, h,-h,h, h,h,-h, h,h,h},
            {-h,h,h, h,h,h, h,h,-h, -h,h,h, h,h,-h, -h,h,-h},
            {-h,-h,-h, h,-h,-h, h,-h,h, -h,-h,-h, h,-h,h, -h,-h,h}
        };
        float[] result = new float[36 * 3];
        int i = 0;
        for (float[] face : faces) for (float v : face) result[i++] = v;
        return result;
    }

    private static float[] cubeColors() {
        float[][] faceColors = {
            {0.34f,0.72f,0.36f,1f}, {0.70f,0.38f,0.28f,1f},
            {0.33f,0.62f,0.90f,1f}, {0.90f,0.66f,0.26f,1f},
            {0.48f,0.82f,0.72f,1f}, {0.48f,0.42f,0.62f,1f}
        };
        float[] result = new float[36 * 4];
        int i = 0;
        for (float[] color : faceColors) for (int vertex = 0; vertex < 6; vertex++) for (float component : color) result[i++] = component;
        return result;
    }

    private static int createProgram(String vertex, String fragment) {
        int vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, vertex);
        int fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, fragment);
        int program = GLES20.glCreateProgram();
        GLES20.glAttachShader(program, vertexShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);
        int[] status = new int[1];
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, status, 0);
        if (status[0] == 0) throw new IllegalStateException("GLES program link failed: " + GLES20.glGetProgramInfoLog(program));
        GLES20.glDeleteShader(vertexShader);
        GLES20.glDeleteShader(fragmentShader);
        return program;
    }

    private static int compileShader(int type, String source) {
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);
        int[] status = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0);
        if (status[0] == 0) throw new IllegalStateException("GLES shader compile failed: " + GLES20.glGetShaderInfoLog(shader));
        return shader;
    }

    private static final String VERTEX_SHADER =
        "uniform mat4 u_Mvp; attribute vec3 a_Position; attribute vec4 a_Color; varying vec4 v_Color;"
        + "void main(){ gl_Position=u_Mvp*vec4(a_Position,1.0); v_Color=a_Color; }";
    private static final String FRAGMENT_SHADER =
        "precision mediump float; varying vec4 v_Color; void main(){ gl_FragColor=v_Color; }";
}
