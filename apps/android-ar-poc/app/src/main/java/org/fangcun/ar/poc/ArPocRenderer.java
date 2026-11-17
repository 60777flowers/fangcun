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

/**
 * GLES 2 renderer: ARCore camera background plus the replicated voxel island drawn at a
 * horizontal plane anchor. Taps after the anchor exists are ray-cast onto the island plane
 * and converted to a world column, which the activity turns into a Host intent.
 */
final class ArPocRenderer implements GLSurfaceView.Renderer {
    private static final int FLOAT_BYTES = 4;

    private final ArPocActivity activity;
    private final VoxelWorld world;
    private final AtomicReference<float[]> pendingTap;
    private final float[] viewMatrix = new float[16];
    private final float[] projectionMatrix = new float[16];
    private final float[] modelMatrix = new float[16];
    private final float[] modelView = new float[16];
    private final float[] mvp = new float[16];
    private final float[] viewProjection = new float[16];
    private final float[] inverseViewProjection = new float[16];
    private final float[] anchorInverse = new float[16];
    private final float[] cameraPose = new float[16];
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

    private FloatBuffer voxelVertices;
    private FloatBuffer voxelColors;
    private int voxelVertexCount;
    private volatile boolean meshDirty = true;
    private volatile int hintVoxelX = Integer.MIN_VALUE;
    private volatile int hintVoxelZ = Integer.MIN_VALUE;

    private static final float COMPANION_X = 0.10f;
    /** Feet rest on the terrain surface: BUILD_MIN_Y voxels above the anchor plane. */
    private static final float COMPANION_Y = VoxelWorld.BUILD_MIN_Y * VoxelWorld.VOXEL_METERS;
    private static final float COMPANION_Z = 0.06f;
    private static final float PREVIEW_DISTANCE = 1.0f;
    /** Two voxels tall, so the character reads at the same scale as the built blocks. */
    private static final float COMPANION_HEIGHT_METERS = 0.06f;
    private final float[] characterModel = new float[16];
    private final float[] characterMvp = new float[16];
    private final float[] characterViewA = new float[16];
    private final float[] characterViewB = new float[16];
    private CompanionMesh.Mesh companionMesh;
    private volatile String companionState = "idle";

    /** Replaceable companion asset: drop another .vrm/.glb here to change the character. */
    private static final String COMPANION_ASSET = "models/companion/default.vrm";
    private VrmModel vrm;
    private int vrmProgram;
    private int vrmPositionHandle;
    private int vrmNormalHandle;
    private int vrmUvHandle;
    private int vrmMvpHandle;
    private int vrmNormalMatrixHandle;
    private int vrmTextureHandle;
    private int vrmUseTextureHandle;
    private int vrmFlipVHandle;
    private final float[] characterNormal = new float[9];

    ArPocRenderer(ArPocActivity activity, AtomicReference<float[]> pendingTap, VoxelWorld world) {
        this.activity = activity;
        this.pendingTap = pendingTap;
        this.world = world;
    }

    void setSession(Session session) { this.session = session; }

    private boolean glReady;
    private String startupError;

    void bindSessionIfReady(Session session) {
        this.session = session;
        if (glReady) attachSessionTexture(session);
    }

    /** Called when the replica changed (initial snapshot, commit or resync). */
    void markWorldDirty() { meshDirty = true; }

    /** Drives the idle/building behaviour of the placeholder companion. */
    void setCompanionState(String state) { companionState = state; }

    /**
     * Debug aid: draws the companion a fixed distance in front of the camera so the model
     * can be inspected without a detected plane or an anchor.
     */
    void setPreviewMode(boolean enabled) { previewMode = enabled; }

    /** Forces a pose for tuning: "stand", "sit", "lie", or "auto" to cycle on its own. */
    void setForcedPose(String pose) { forcedPose = pose; }

    private volatile String forcedPose = "auto";
    private static final long POSE_UPDATE_MS = 120;
    private long lastPoseMs;
    private int poseIndex = -1;

    /**
     * Cycles stand → sit → lie while idle so the companion looks alive, and stands up while
     * building. Poses are procedural bone rotations because the source VRM ships no clips.
     */
    private void applyCharacterPose(VrmModel model) {
        if (!model.hasSkin()) return;
        long now = System.currentTimeMillis();
        String pose;
        if (previewMode || !"auto".equals(forcedPose)) {
            pose = "auto".equals(forcedPose) ? "stand" : forcedPose;
        } else if ("building".equals(companionState) || "planning".equals(companionState)) {
            pose = "stand";
        } else {
            long cycle = (now / 1000L) % 45L;
            pose = cycle < 20 ? "stand" : cycle < 32 ? "sit" : "lie";
        }
        if (now - lastPoseMs < POSE_UPDATE_MS && pose.equals(lastPose)) return;
        lastPoseMs = now;
        lastPose = pose;

        java.util.Map<String, float[]> rotations = new java.util.HashMap<>();
        float[] hips = {0f, 0f, 0f};
        if ("sit".equals(pose)) {
            rotations.put("leftUpperLeg", VrmModel.axisAngle(1f, 0f, 0f, -85f));
            rotations.put("rightUpperLeg", VrmModel.axisAngle(1f, 0f, 0f, -85f));
            rotations.put("leftLowerLeg", VrmModel.axisAngle(1f, 0f, 0f, 85f));
            rotations.put("rightLowerLeg", VrmModel.axisAngle(1f, 0f, 0f, 85f));
            rotations.put("spine", VrmModel.axisAngle(1f, 0f, 0f, 6f));
            hips[1] = -0.30f;
        } else if ("lie".equals(pose)) {
            rotations.put("hips", VrmModel.axisAngle(1f, 0f, 0f, -88f));
            rotations.put("head", VrmModel.axisAngle(1f, 0f, 0f, 12f));
            hips[1] = -0.90f;
        }
        model.applyPose(rotations, hips);
    }

    private String lastPose = "";

    /**
     * Debug switch for the glTF-vs-GL texture V orientation. Off by default because
     * Android's GLUtils.texImage2D already lands rows where glTF UVs expect them; flipping
     * mirrors every texture region (the blue tail sampled skin instead).
     */
    void setFlipV(boolean enabled) {
        flipV = enabled;
        VrmModel model = vrm;
        if (model != null) model.setFlipV(enabled);
    }

    private volatile boolean flipV;

    private volatile boolean previewMode;

    void releaseAnchorNow() {
        pendingTap.set(null);
        releaseAnchor();
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
            companionMesh = CompanionMesh.build();
            vrmProgram = createProgram(VRM_VERTEX_SHADER, VRM_FRAGMENT_SHADER);
            vrmPositionHandle = GLES20.glGetAttribLocation(vrmProgram, "a_Position");
            vrmNormalHandle = GLES20.glGetAttribLocation(vrmProgram, "a_Normal");
            vrmUvHandle = GLES20.glGetAttribLocation(vrmProgram, "a_Uv");
            vrmMvpHandle = GLES20.glGetUniformLocation(vrmProgram, "u_Mvp");
            vrmNormalMatrixHandle = GLES20.glGetUniformLocation(vrmProgram, "u_NormalMatrix");
            vrmTextureHandle = GLES20.glGetUniformLocation(vrmProgram, "u_Tex");
            vrmUseTextureHandle = GLES20.glGetUniformLocation(vrmProgram, "u_UseTex");
            vrmFlipVHandle = GLES20.glGetUniformLocation(vrmProgram, "u_FlipV");
            vrm = VrmModel.load(activity, COMPANION_ASSET);
            if (vrm != null) {
                vrm.normalise(COMPANION_HEIGHT_METERS);
                vrm.setFlipV(flipV);
            }
            glReady = true;
            Session current = session != null ? session : activity.currentSession();
            if (current != null) attachSessionTexture(current);
            startupError = null;
        } catch (RuntimeException error) {
            glReady = false;
            textureSession = null;
            startupError = "Renderer init failed: " + error.getMessage();
            activity.setArStatus(startupError);
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
                // Fail closed: never replay taps or keep drawing anchored content while relocalizing.
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
                for (Plane trackedPlane : current.getAllTrackables(Plane.class)) {
                    if (trackedPlane.getTrackingState() == TrackingState.TRACKING) planeCount++;
                }
                String message = System.currentTimeMillis() < tapDiagnosticUntilMs
                    ? tapDiagnostic
                    : "Tracking camera — planes: " + planeCount + ". Move device slowly, then tap tabletop to anchor the island.";
                publishStatus(message);
                if (previewMode) drawPreviewCompanion(camera);
                return;
            }
            anchor.getPose().toMatrix(modelMatrix, 0);
            Matrix.multiplyMM(modelView, 0, viewMatrix, 0, modelMatrix, 0);
            Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);
            if (meshDirty) rebuildMesh();
            drawVoxels();
            drawCompanion();
            camera.getPose().toMatrix(cameraPose, 0);
            float dcx = cameraPose[12] - modelMatrix[12];
            float dcy = cameraPose[13] - modelMatrix[13];
            float dcz = cameraPose[14] - modelMatrix[14];
            publishStatus(hintStatus((float) Math.sqrt(dcx * dcx + dcy * dcy + dcz * dcz)));
        } catch (CameraNotAvailableException e) {
            releaseAnchor();
            publishStatus("Camera unavailable — AR paused, writes disabled");
        } catch (RuntimeException e) {
            releaseAnchor();
            publishStatus("AR frame error — writes disabled");
        }
    }

    private String hintStatus(float distanceMeters) {
        int x = hintVoxelX;
        int z = hintVoxelZ;
        String distance = String.format(java.util.Locale.US, "camera %.2f m from island centre (island is 0.48 m wide)", distanceMeters);
        if (x == Integer.MIN_VALUE || z == Integer.MIN_VALUE) {
            return "Island anchored\n" + distance + "\nHold 0.8-1.2 m away, then tap a column to build.";
        }
        int placeY = world.firstEmptyY(x, z);
        String target = placeY >= 0 ? "place at y=" + placeY : "break column";
        return "Island anchored  rev " + world.revision() + "  blocks " + world.countBlocks()
            + "\n" + distance
            + "\nTarget column x=" + x + " z=" + z + " (" + target + ")";
    }

    private void rebuildMesh() {
        meshDirty = false;
        VoxelWorld.Mesh mesh = world.buildMesh();
        voxelVertexCount = mesh.vertexCount;
        voxelVertices = directBuffer(mesh.positions);
        voxelColors = directBuffer(mesh.colors);
    }

    private void processTap(Session current, Frame frame) {
        float[] tap = pendingTap.getAndSet(null);
        if (tap == null || frame.getCamera().getTrackingState() != TrackingState.TRACKING) return;

        if (anchor == null) {
            placeAnchor(tap, frame);
            return;
        }
        int[] column = columnForTap(tap, frame);
        if (column == null) {
            hintVoxelX = Integer.MIN_VALUE;
            hintVoxelZ = Integer.MIN_VALUE;
            publishStatus("Tap missed the island — aim inside the 42 cm island footprint.");
            return;
        }
        hintVoxelX = column[0];
        hintVoxelZ = column[1];
        activity.onColumnTapped(column[0], column[1]);
    }

    private void placeAnchor(float[] tap, Frame frame) {
        int planeHits = 0;
        for (HitResult hit : frame.hitTest(tap[0], tap[1])) {
            if (!(hit.getTrackable() instanceof Plane)) continue;
            planeHits++;
            Plane plane = (Plane) hit.getTrackable();
            if (plane.getTrackingState() != TrackingState.TRACKING || !plane.isPoseInPolygon(hit.getHitPose())) continue;
            Anchor newAnchor;
            try {
                // The island is a thin slab now, so the tap point itself is a good spot.
                newAnchor = hit.createAnchor();
            } catch (RuntimeException e) {
                publishStatus("Anchor creation failed — tap again");
                return;
            }
            releaseAnchor();
            anchor = newAnchor;
            meshDirty = true;
            publishStatus("Island anchored");
            return;
        }
        tapDiagnostic = planeHits == 0 ? "Tap missed plane — move device to map surface, retry."
            : "Plane hit outside detected surface polygon — keep moving, retry.";
        tapDiagnosticUntilMs = System.currentTimeMillis() + 2500;
        publishStatus(tapDiagnostic);
    }

    /**
     * Ray-casts the tap onto the anchor's horizontal plane and converts the hit point into
     * a world column. Returns null when the ray misses the island footprint.
     */
    private int[] columnForTap(float[] tap, Frame frame) {
        Matrix.multiplyMM(viewProjection, 0, projectionMatrix, 0, viewMatrix, 0);
        Matrix.invertM(inverseViewProjection, 0, viewProjection, 0);

        float[] near = unproject(tap[0], tap[1], -1f);
        float[] far = unproject(tap[0], tap[1], 1f);
        if (near == null || far == null) return null;
        float dx = far[0] - near[0];
        float dy = far[1] - near[1];
        float dz = far[2] - near[2];

        float[] pose = new float[16];
        anchor.getPose().toMatrix(pose, 0);
        float px = pose[12];
        float py = pose[13];
        float pz = pose[14];
        float nx = pose[4];
        float ny = pose[5];
        float nz = pose[6];
        float denominator = dx * nx + dy * ny + dz * nz;
        if (Math.abs(denominator) < 1e-6f) return null;
        float t = ((px - near[0]) * nx + (py - near[1]) * ny + (pz - near[2]) * nz) / denominator;
        if (t <= 0f) return null;
        float hitX = near[0] + dx * t;
        float hitY = near[1] + dy * t;
        float hitZ = near[2] + dz * t;

        if (!Matrix.invertM(anchorInverse, 0, pose, 0)) return null;
        float[] local = new float[4];
        Matrix.multiplyMV(local, 0, anchorInverse, 0, new float[] {hitX, hitY, hitZ, 1f}, 0);
        int voxelX = (int) Math.floor(local[0] / VoxelWorld.VOXEL_METERS);
        int voxelZ = (int) Math.floor(local[2] / VoxelWorld.VOXEL_METERS);
        if (voxelX < VoxelWorld.ORIGIN || voxelX >= VoxelWorld.ORIGIN + VoxelWorld.SIZE) return null;
        if (voxelZ < VoxelWorld.ORIGIN || voxelZ >= VoxelWorld.ORIGIN + VoxelWorld.SIZE) return null;
        return new int[] {voxelX, voxelZ};
    }

    private float[] unproject(float screenX, float screenY, float depth) {
        float[] ndc = {
            2f * screenX / Math.max(surfaceWidth, 1) - 1f,
            1f - 2f * screenY / Math.max(surfaceHeight, 1),
            depth,
            1f,
        };
        float[] out = new float[4];
        Matrix.multiplyMV(out, 0, inverseViewProjection, 0, ndc, 0);
        if (Math.abs(out[3]) < 1e-6f) return null;
        return new float[] {out[0] / out[3], out[1] / out[3], out[2] / out[3]};
    }

    private void drawVoxels() {
        if (voxelVertexCount == 0 || voxelVertices == null || voxelColors == null) return;
        GLES20.glUseProgram(program);
        GLES20.glUniformMatrix4fv(mvpHandle, 1, false, mvp, 0);
        voxelVertices.position(0);
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 0, voxelVertices);
        voxelColors.position(0);
        GLES20.glEnableVertexAttribArray(colorHandle);
        GLES20.glVertexAttribPointer(colorHandle, 4, GLES20.GL_FLOAT, false, 0, voxelColors);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, voxelVertexCount);
        GLES20.glDisableVertexAttribArray(positionHandle);
        GLES20.glDisableVertexAttribArray(colorHandle);
    }

    /**
     * Draws the placeholder companion hovering over the island. Idle it bobs slowly while
     * turning; while building the motion gets faster so the state is visible without UI.
     */
    private void drawPreviewCompanion(Camera camera) {
        camera.getPose().toMatrix(modelMatrix, 0);
        modelMatrix[12] -= modelMatrix[8] * PREVIEW_DISTANCE;
        modelMatrix[13] -= modelMatrix[9] * PREVIEW_DISTANCE;
        modelMatrix[14] -= modelMatrix[10] * PREVIEW_DISTANCE;
        Matrix.multiplyMM(modelView, 0, viewMatrix, 0, modelMatrix, 0);
        Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);
        drawCompanion();
    }

    private void drawCompanionModel(VrmModel model) {
        // Preview enlarges the avatar so textures and material assignment can be inspected.
        model.normalise(previewMode ? 0.45f : COMPANION_HEIGHT_METERS);
        applyCharacterPose(model);
        double seconds = System.currentTimeMillis() / 1000.0;
        boolean busy = "building".equals(companionState) || "planning".equals(companionState);
        // Grounded by default: the avatar stands on the terrain and only hops while building.
        float bob = busy ? (float) (Math.abs(Math.sin(seconds * 5.0)) * 0.008) : 0f;
        float yaw = (float) (Math.sin(seconds * (busy ? 2.2 : 0.45)) * 18.0);

        Matrix.setIdentityM(characterModel, 0);
        // Preview mode centres the avatar on the camera ray so its silhouette and scale are
        // easy to judge without an anchor.
        float offsetX = previewMode ? 0f : COMPANION_X;
        float offsetY = previewMode ? 0f : COMPANION_Y;
        float offsetZ = previewMode ? 0f : COMPANION_Z;
        Matrix.translateM(characterModel, 0, offsetX, offsetY + bob, offsetZ);
        // Preview turns the avatar toward the camera so textures and the silhouette can be
        // compared against the model's own thumbnail.
        float baseYaw = previewMode ? 0f : 180f;
        Matrix.rotateM(characterModel, 0, baseYaw + yaw, 0f, 1f, 0f);
        Matrix.scaleM(characterModel, 0, model.scale(), model.scale(), model.scale());
        Matrix.translateM(characterModel, 0, model.offsetX(), model.offsetY(), model.offsetZ());

        float inverseScale = 1f / Math.max(model.scale(), 1e-6f);
        characterNormal[0] = characterModel[0] * inverseScale;
        characterNormal[1] = characterModel[1] * inverseScale;
        characterNormal[2] = characterModel[2] * inverseScale;
        characterNormal[3] = characterModel[4] * inverseScale;
        characterNormal[4] = characterModel[5] * inverseScale;
        characterNormal[5] = characterModel[6] * inverseScale;
        characterNormal[6] = characterModel[8] * inverseScale;
        characterNormal[7] = characterModel[9] * inverseScale;
        characterNormal[8] = characterModel[10] * inverseScale;

        Matrix.multiplyMM(characterViewA, 0, viewMatrix, 0, modelMatrix, 0);
        Matrix.multiplyMM(characterViewB, 0, characterViewA, 0, characterModel, 0);
        Matrix.multiplyMM(characterMvp, 0, projectionMatrix, 0, characterViewB, 0);

        GLES20.glUseProgram(vrmProgram);
        GLES20.glUniformMatrix4fv(vrmMvpHandle, 1, false, characterMvp, 0);
        GLES20.glUniformMatrix3fv(vrmNormalMatrixHandle, 1, false, characterNormal, 0);
        model.draw(vrmProgram, vrmPositionHandle, vrmNormalHandle, vrmUvHandle, vrmTextureHandle, vrmUseTextureHandle, vrmFlipVHandle);
    }

    private void drawCompanion() {
        VrmModel model = vrm;
        if (model != null) {
            drawCompanionModel(model);
            return;
        }
        CompanionMesh.Mesh mesh = companionMesh;
        if (mesh == null || mesh.vertexCount == 0) return;
        double seconds = System.currentTimeMillis() / 1000.0;
        boolean busy = "building".equals(companionState) || "planning".equals(companionState);
        double bobRate = busy ? 6.0 : 1.6;
        float bob = (float) (Math.sin(seconds * bobRate) * (busy ? 0.022 : 0.012));
        float yaw = (float) (Math.sin(seconds * (busy ? 2.4 : 0.6)) * 22.0);

        Matrix.setIdentityM(characterModel, 0);
        Matrix.translateM(characterModel, 0, COMPANION_X, COMPANION_Y + bob, COMPANION_Z);
        Matrix.rotateM(characterModel, 0, 180f + yaw, 0f, 1f, 0f);
        Matrix.multiplyMM(characterViewA, 0, viewMatrix, 0, modelMatrix, 0);
        Matrix.multiplyMM(characterViewB, 0, characterViewA, 0, characterModel, 0);
        Matrix.multiplyMM(characterMvp, 0, projectionMatrix, 0, characterViewB, 0);

        GLES20.glUseProgram(program);
        GLES20.glUniformMatrix4fv(mvpHandle, 1, false, characterMvp, 0);
        mesh.positions.position(0);
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 0, mesh.positions);
        mesh.colors.position(0);
        GLES20.glEnableVertexAttribArray(colorHandle);
        GLES20.glVertexAttribPointer(colorHandle, 4, GLES20.GL_FLOAT, false, 0, mesh.colors);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, mesh.vertexCount);
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
        if (now - lastStatusMs < 120 && !message.startsWith("Tap")) return;
        lastStatusMs = now;
        activity.setArStatus(message);
    }

    private static FloatBuffer directBuffer(float[] values) {
        FloatBuffer buffer = ByteBuffer.allocateDirect(values.length * FLOAT_BYTES)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer();
        buffer.put(values);
        buffer.position(0);
        return buffer;
    }

    private static int createProgram(String vertexSource, String fragmentSource) {
        int vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, vertexSource);
        int fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, fragmentSource);
        int programHandle = GLES20.glCreateProgram();
        GLES20.glAttachShader(programHandle, vertexShader);
        GLES20.glAttachShader(programHandle, fragmentShader);
        GLES20.glLinkProgram(programHandle);
        int[] status = new int[1];
        GLES20.glGetProgramiv(programHandle, GLES20.GL_LINK_STATUS, status, 0);
        if (status[0] == 0) throw new IllegalStateException("GLES program link failed: " + GLES20.glGetProgramInfoLog(programHandle));
        return programHandle;
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

    /**
     * Textured shader for the companion avatar. MToon is approximated with a base-colour
     * texture plus a fixed half-lambert term; alpha is discarded so hair cards do not need
     * depth-sorted transparency.
     */
    private static final String VRM_VERTEX_SHADER =
        "uniform mat4 u_Mvp; uniform mat3 u_NormalMatrix; uniform float u_FlipV;"
        + "attribute vec3 a_Position; attribute vec3 a_Normal; attribute vec2 a_Uv;"
        + "varying vec2 v_Uv; varying float v_Light;"
        + "void main(){"
        + " gl_Position=u_Mvp*vec4(a_Position,1.0);"
        + " v_Uv=vec2(a_Uv.x, u_FlipV > 0.5 ? 1.0-a_Uv.y : a_Uv.y);"
        + " vec3 n=normalize(u_NormalMatrix*a_Normal);"
        + " v_Light=0.62+0.38*max(dot(n, normalize(vec3(0.35,0.9,0.25))),0.0);"
        + "}";
    private static final String VRM_FRAGMENT_SHADER =
        "precision mediump float; uniform sampler2D u_Tex; uniform float u_UseTex;"
        + "varying vec2 v_Uv; varying float v_Light;"
        + "void main(){"
        + " vec4 color = u_UseTex > 0.5 ? texture2D(u_Tex, v_Uv) : vec4(0.95,0.75,0.55,1.0);"
        + " if(color.a < 0.35) discard;"
        + " gl_FragColor=vec4(color.rgb*v_Light, 1.0);"
        + "}";
}
