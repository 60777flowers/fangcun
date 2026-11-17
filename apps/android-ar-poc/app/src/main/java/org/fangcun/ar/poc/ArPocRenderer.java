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
 * GLES 2 renderer: ARCore camera background, the replicated textured voxel island at a horizontal
 * plane anchor, the skinned VRM companion, and the camera-facing nameplate/speech-bubble HUD.
 *
 * <p>The companion's motion is fully data-driven: {@link CompanionActionRegistry} supplies the
 * action table and {@link CompanionAction} samples a pose for the action's phase. This class only
 * owns the clock, applies the pose to the skeleton (throttled, because CPU skinning is the
 * expensive part) and turns the pose's object-level yaw/lift into the draw transform.</p>
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
    private long lastArStateMs;
    private long tapDiagnosticUntilMs;
    private String tapDiagnostic = "";
    private Session textureSession;

    private int voxelProgram;
    private int voxelPositionHandle;
    private int voxelUvHandle;
    private int voxelShadeHandle;
    private int voxelMvpHandle;
    private int voxelTextureHandle;
    private VoxelAtlas voxelAtlas;
    private FloatBuffer voxelVertices;
    private FloatBuffer voxelColors;
    private FloatBuffer voxelUvs;
    private FloatBuffer voxelShades;
    private int voxelVertexCount;
    private int voxelTexturedVertexCount;
    private volatile boolean meshDirty = true;
    private volatile int hintVoxelX = Integer.MIN_VALUE;
    private volatile int hintVoxelZ = Integer.MIN_VALUE;

    private static final float COMPANION_X = 0.10f;
    /** Feet rest on the terrain surface: BUILD_MIN_Y voxels above the anchor plane. */
    private static final float COMPANION_Y = VoxelWorld.BUILD_MIN_Y * VoxelWorld.VOXEL_METERS;
    private static final float COMPANION_Z = 0.06f;
    private static final float PREVIEW_DISTANCE = 1.25f;
    /** Two voxels tall, so the character reads at the same scale as the built blocks. */
    private static final float COMPANION_HEIGHT_METERS = 0.06f;
    /** Preview model is enlarged for inspection, then pulled slightly down so the HUD fits. */
    private static final float PREVIEW_COMPANION_HEIGHT_METERS = 0.34f;
    private static final float PREVIEW_VERTICAL_OFFSET = -0.14f;
    private static final float FALLBACK_COMPANION_HEIGHT_METERS = 0.05f;
    private final float[] characterFrame = new float[16];
    private final float[] characterFrameWorld = new float[16];
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

    // ---- data-driven companion actions -------------------------------------------------
    private final CompanionActionRegistry actionRegistry = CompanionActionRegistry.get();
    private final long[] autoStartScratch = new long[1];
    private volatile String requestedAction = CompanionActionRegistry.AUTO;
    /** Debug override from the {@code --es pose} intent extra; repeats so screenshots catch it. */
    private volatile String forcedAction;
    private long actionEpochMs = -1;
    private long autoEpochMs = -1;
    private long forcedEpochMs = -1;
    /** Host-triggered actions repeat until this wall-clock time (companion_action expiry). */
    private volatile long actionHoldUntilMs;
    private long buildEpochMs = -1;
    private boolean lastBusy;
    private String activeActionId = "";
    private String lastSkinnedActionId = "";
    private CompanionAction currentAction;
    private CompanionAction.Pose currentPose = CompanionAction.Pose.rest();
    private float currentBodyYaw;
    private float currentBodyLiftHeights;
    private long lastSkinMs;
    /** CPU skinning is the expensive part, so the skeleton animates at ~22 Hz. */
    private static final long SKIN_INTERVAL_MS = 45;

    // ---- companion billboards ----------------------------------------------------------
    private Billboard billboard;
    private Nameplate nameplate;
    private SpeechBubble speechBubble;
    private volatile String companionName = "大肥鱼";
    private final float[] companionHeadWorld = new float[3];
    private final float[] headAnchorModel = new float[3];
    private boolean companionVisible;
    private final float[] cameraRight = new float[3];
    private final float[] cameraUp = new float[3];
    private final float[] cameraPosition = new float[3];
    /** Fraction of screen height the nameplate/bubble text should cover at any distance. */
    private static final float NAME_TEXT_SCREEN_FRACTION = 0.0105f;
    private static final float BUBBLE_TEXT_SCREEN_FRACTION = 0.0130f;
    /** Projection focal factor for the 60 degree vertical FOV used below. */
    private static final float FOV_FOCAL_FACTOR = 0.866f;
    private static final float MIN_BILLBOARD_DISTANCE = 0.25f;
    private static final float MAX_BILLBOARD_DISTANCE = 3.5f;

    private boolean glReady;
    private String startupError;

    ArPocRenderer(ArPocActivity activity, AtomicReference<float[]> pendingTap, VoxelWorld world) {
        this.activity = activity;
        this.pendingTap = pendingTap;
        this.world = world;
    }

    void setSession(Session session) { this.session = session; }

    void bindSessionIfReady(Session session) {
        this.session = session;
        if (glReady) attachSessionTexture(session);
    }

    /** Called when the replica changed (initial snapshot, commit or resync). */
    void markWorldDirty() { meshDirty = true; }

    /** Drives the build behaviour of the companion. */
    void setCompanionState(String state) { companionState = state; }

    /** Public action seam for the Host/PC side: {@code auto} resumes the idle cycle. */
    void setAction(String id) {
        if (id == null) return;
        String cleaned = id.trim();
        if (cleaned.isEmpty() || CompanionActionRegistry.AUTO.equals(cleaned)) {
            requestedAction = CompanionActionRegistry.AUTO;
            autoEpochMs = -1;
            actionHoldUntilMs = 0;
            return;
        }
        if (actionRegistry.find(cleaned) == null) return;
        requestedAction = cleaned;
        actionEpochMs = System.currentTimeMillis();
        actionHoldUntilMs = 0;
    }

    /**
     * Plays an action triggered by the Host's {@code companion_action} message. One-shot actions
     * repeat until {@code expiresAtMs} so the requested beat is visible for its whole grant.
     */
    void playTimedAction(String id, long expiresAtMs) {
        if (id == null || actionRegistry.find(id) == null) return;
        requestedAction = id;
        actionEpochMs = System.currentTimeMillis();
        actionHoldUntilMs = Math.max(0L, expiresAtMs);
    }

    /** Debug override: force one action, repeating it so a screenshot can catch any phase. */
    void setForcedPose(String pose) {
        String cleaned = pose == null ? "" : pose.trim();
        if (cleaned.isEmpty() || CompanionActionRegistry.AUTO.equals(cleaned)) {
            forcedAction = null;
        } else if (actionRegistry.find(cleaned) != null) {
            forcedAction = cleaned;
        } else {
            forcedAction = null;
        }
        forcedEpochMs = -1;
    }

    /** Debug override: freeze the forced action at one phase (0..1) for deterministic screenshots. */
    void setForcedPhase(float phase) {
        forcedPhase = phase < 0f ? -1f : CompanionPoseMath.clamp01(phase);
    }

    private volatile float forcedPhase = -1f;

    /** Debug aid: draws the companion a fixed distance in front of the camera so the model can be
     * inspected without a detected plane or an anchor. */
    void setPreviewMode(boolean enabled) { previewMode = enabled; }

    /** Name shown on the nameplate above the companion's head. */
    void setCompanionName(String name) {
        if (name != null && !name.isEmpty()) companionName = name;
    }

    /** Starts the 3D speech bubble above the companion's head. */
    void say(String text) {
        SpeechBubble bubble = speechBubble;
        if (bubble != null) bubble.show(text, System.currentTimeMillis());
    }

    private volatile boolean flipV;
    private volatile boolean previewMode;

    void setFlipV(boolean enabled) {
        flipV = enabled;
        VrmModel model = vrm;
        if (model != null) model.setFlipV(enabled);
    }

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
            startupError = "相机画面初始化失败：" + error.getClass().getSimpleName();
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
            voxelProgram = createProgram(TEXTURED_VERTEX_SHADER, TEXTURED_FRAGMENT_SHADER);
            voxelPositionHandle = GLES20.glGetAttribLocation(voxelProgram, "a_Position");
            voxelUvHandle = GLES20.glGetAttribLocation(voxelProgram, "a_Uv");
            voxelShadeHandle = GLES20.glGetAttribLocation(voxelProgram, "a_Shade");
            voxelMvpHandle = GLES20.glGetUniformLocation(voxelProgram, "u_Mvp");
            voxelTextureHandle = GLES20.glGetUniformLocation(voxelProgram, "u_Tex");
            background = new BackgroundRenderer();
            background.createOnGlThread(activity);
            companionMesh = CompanionMesh.build();
            billboard = Billboard.create();
            nameplate = new Nameplate();
            speechBubble = new SpeechBubble();
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
                vrm.normalise(previewMode ? PREVIEW_COMPANION_HEIGHT_METERS : COMPANION_HEIGHT_METERS);
                vrm.setFlipV(flipV);
            }
            voxelAtlas = VoxelAtlas.load(activity);
            meshDirty = true;
            glReady = true;
            Session current = session != null ? session : activity.currentSession();
            if (current != null) attachSessionTexture(current);
            startupError = null;
        } catch (RuntimeException error) {
            glReady = false;
            textureSession = null;
            startupError = "渲染器初始化失败：" + error.getMessage();
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
            publishStatus("正在等待 AR 会话…");
            return;
        }
        try {
            if (startupError != null) {
                publishStatus(startupError);
                return;
            }
            current.setDisplayGeometry(activity.getWindowManager().getDefaultDisplay().getRotation(), surfaceWidth, surfaceHeight);
            if (background == null || background.textureId() == 0 || textureSession != current) {
                publishStatus("正在准备相机画面…");
                return;
            }
            Frame frame = current.update();
            Camera camera = frame.getCamera();
            background.draw(frame);
            if (camera.getTrackingState() != TrackingState.TRACKING) {
                // Fail closed: never replay taps or keep drawing anchored content while relocalizing.
                pendingTap.set(null);
                releaseAnchor();
                companionVisible = false;
                publishArState(false, -1, false);
                publishStatus("追踪已丢失：把平板对准桌面并缓慢移动，恢复后再操作");
                return;
            }
            camera.getViewMatrix(viewMatrix, 0);
            camera.getProjectionMatrix(projectionMatrix, 0, 0.1f, 100f);
            camera.getPose().toMatrix(cameraPose, 0);
            cameraPosition[0] = cameraPose[12];
            cameraPosition[1] = cameraPose[13];
            cameraPosition[2] = cameraPose[14];
            cameraRight[0] = viewMatrix[0];
            cameraRight[1] = viewMatrix[4];
            cameraRight[2] = viewMatrix[8];
            cameraUp[0] = viewMatrix[1];
            cameraUp[1] = viewMatrix[5];
            cameraUp[2] = viewMatrix[9];
            processTap(current, frame);
            long now = System.currentTimeMillis();
            if (speechBubble != null) speechBubble.update(now);
            if (previewMode) {
                // Preview inspection is immune to stray taps and to an existing anchor: it always
                // draws the companion in front of the camera (and the island when one is up).
                boolean anchored = anchor != null && anchor.getTrackingState() == TrackingState.TRACKING;
                if (anchored) {
                    anchor.getPose().toMatrix(modelMatrix, 0);
                    Matrix.multiplyMM(modelView, 0, viewMatrix, 0, modelMatrix, 0);
                    Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);
                    if (meshDirty) rebuildMesh();
                    drawVoxels();
                }
                drawPreviewCompanion(camera);
                drawCompanionBillboards();
                publishArState(true, -1, anchored);
                publishStatus("预览模式：仅用于检查动作与模型，点击不会放置小岛");
                return;
            }
            if (anchor == null || anchor.getTrackingState() != TrackingState.TRACKING) {
                int planeCount = 0;
                for (Plane trackedPlane : current.getAllTrackables(Plane.class)) {
                    if (trackedPlane.getTrackingState() == TrackingState.TRACKING) planeCount++;
                }
                publishArState(true, planeCount, false);
                String message = System.currentTimeMillis() < tapDiagnosticUntilMs
                    ? tapDiagnostic
                    : "对准桌面缓慢移动，出现平面提示后点一下桌面放置小岛（当前平面数 " + planeCount + "）";
                publishStatus(message);
                return;
            }
            anchor.getPose().toMatrix(modelMatrix, 0);
            Matrix.multiplyMM(modelView, 0, viewMatrix, 0, modelMatrix, 0);
            Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);
            if (meshDirty) rebuildMesh();
            drawVoxels();
            drawCompanion();
            drawCompanionBillboards();
            publishArState(true, -1, true);
            float dcx = cameraPosition[0] - modelMatrix[12];
            float dcy = cameraPosition[1] - modelMatrix[13];
            float dcz = cameraPosition[2] - modelMatrix[14];
            publishStatus(hintStatus((float) Math.sqrt(dcx * dcx + dcy * dcy + dcz * dcz)));
        } catch (CameraNotAvailableException e) {
            releaseAnchor();
            publishStatus("相机不可用，AR 已暂停。");
        } catch (RuntimeException e) {
            releaseAnchor();
            publishStatus("AR 帧错误，世界写入已暂停。");
        }
    }

    private String hintStatus(float distanceMeters) {
        int x = hintVoxelX;
        int z = hintVoxelZ;
        String distance = String.format(java.util.Locale.US, "相机距岛心 %.2f m", distanceMeters);
        if (x == Integer.MIN_VALUE || z == Integer.MIN_VALUE) {
            return "小岛已放置 · rev " + world.revision() + " · " + world.countBlocks()
                + " 个方块\n" + distance + " · 点绿色岛面上的格子放置方块";
        }
        int placeY = world.firstEmptyY(x, z);
        String target = placeY >= 0 ? "放方块 y=" + placeY : "拆掉顶部方块";
        return "小岛已放置 · rev " + world.revision() + " · " + world.countBlocks()
            + " 个方块\n" + distance + " · 目标格子 x=" + x + " z=" + z + "（" + target + "）";
    }

    /** Pushes tracking/plane/anchor readiness to the activity's Chinese guidance card. */
    private void publishArState(boolean tracking, int planeCount, boolean anchored) {
        long now = System.currentTimeMillis();
        if (now - lastArStateMs < 200) return;
        lastArStateMs = now;
        activity.onArTrackingState(tracking, planeCount, anchored);
    }

    private void rebuildMesh() {
        meshDirty = false;
        VoxelWorld.Mesh mesh = world.buildMesh(voxelAtlas);
        voxelVertexCount = mesh.vertexCount;
        voxelTexturedVertexCount = voxelAtlas != null ? mesh.texturedVertexCount : 0;
        voxelVertices = directBuffer(mesh.positions);
        voxelColors = directBuffer(mesh.colors);
        voxelUvs = directBuffer(mesh.uvs);
        voxelShades = directBuffer(mesh.shades);
    }

    private void processTap(Session current, Frame frame) {
        // Preview mode is a deliberate inspection session: a stray tap must never anchor the
        // island and replace the camera-relative companion with the anchored one.
        if (previewMode) {
            pendingTap.set(null);
            return;
        }
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
            String message = "点在岛外面了，请点绿色的岛面格子";
            publishStatus(message);
            activity.showArFeedback(message);
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
                publishStatus("放置小岛失败，请再点一次");
                activity.showArFeedback("放置小岛失败，请再点一次");
                return;
            }
            releaseAnchor();
            anchor = newAnchor;
            meshDirty = true;
            publishStatus("已放置小岛");
            activity.showArNotice("已放置小岛：点岛上的格子开始建造吧");
            return;
        }
        tapDiagnostic = planeHits == 0 ? "这里还没识别成平面，再移动一下平板试试"
            : "这里还没识别成完整的桌面，再缓慢移动一下平板试试";
        tapDiagnosticUntilMs = System.currentTimeMillis() + 2500;
        publishStatus(tapDiagnostic);
        activity.showArFeedback(tapDiagnostic);
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
        if (voxelVertexCount == 0) return;
        int textured = voxelTexturedVertexCount;
        if (voxelAtlas != null && voxelAtlas.ready() && textured > 0
            && voxelVertices != null && voxelUvs != null && voxelShades != null) {
            drawVoxelsTextured(textured);
        }
        if (voxelVertexCount > textured && voxelVertices != null && voxelColors != null) {
            drawVoxelsFlat(textured, voxelVertexCount - textured);
        }
    }

    /** Pixel-art atlas path: position + uv + per-face shade, alpha discarded for glass. */
    private void drawVoxelsTextured(int vertexCount) {
        GLES20.glUseProgram(voxelProgram);
        GLES20.glUniformMatrix4fv(voxelMvpHandle, 1, false, mvp, 0);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, voxelAtlas.textureId());
        GLES20.glUniform1i(voxelTextureHandle, 0);
        voxelVertices.position(0);
        GLES20.glEnableVertexAttribArray(voxelPositionHandle);
        GLES20.glVertexAttribPointer(voxelPositionHandle, 3, GLES20.GL_FLOAT, false, 0, voxelVertices);
        voxelUvs.position(0);
        GLES20.glEnableVertexAttribArray(voxelUvHandle);
        GLES20.glVertexAttribPointer(voxelUvHandle, 2, GLES20.GL_FLOAT, false, 0, voxelUvs);
        voxelShades.position(0);
        GLES20.glEnableVertexAttribArray(voxelShadeHandle);
        GLES20.glVertexAttribPointer(voxelShadeHandle, 1, GLES20.GL_FLOAT, false, 0, voxelShades);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, vertexCount);
        GLES20.glDisableVertexAttribArray(voxelPositionHandle);
        GLES20.glDisableVertexAttribArray(voxelUvHandle);
        GLES20.glDisableVertexAttribArray(voxelShadeHandle);
    }

    /** Flat-colour fallback path for blocks absent from the atlas mapping. */
    private void drawVoxelsFlat(int firstVertex, int vertexCount) {
        if (vertexCount <= 0 || voxelColors == null) return;
        GLES20.glUseProgram(program);
        GLES20.glUniformMatrix4fv(mvpHandle, 1, false, mvp, 0);
        voxelVertices.position(firstVertex * 3);
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 0, voxelVertices);
        voxelColors.position(firstVertex * 4);
        GLES20.glEnableVertexAttribArray(colorHandle);
        GLES20.glVertexAttribPointer(colorHandle, 4, GLES20.GL_FLOAT, false, 0, voxelColors);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, vertexCount);
        GLES20.glDisableVertexAttribArray(positionHandle);
        GLES20.glDisableVertexAttribArray(colorHandle);
    }

    private void drawPreviewCompanion(Camera camera) {
        // Place the avatar directly in front of the camera in view space: this keeps it upright
        // on screen no matter how the display is rotated relative to the sensor.
        Matrix.invertM(modelMatrix, 0, viewMatrix, 0);
        Matrix.translateM(modelMatrix, 0, 0f, PREVIEW_VERTICAL_OFFSET, -PREVIEW_DISTANCE);
        Matrix.multiplyMM(modelView, 0, viewMatrix, 0, modelMatrix, 0);
        Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);
        drawCompanion();
    }

    /**
     * Resolves the active action for this frame: the build override wins, then the debug forced
     * action, then the requested action (auto or a Host/UI trigger).
     */
    private void updateActionClock(long now) {
        boolean busy = "building".equals(companionState) || "planning".equals(companionState);
        if (busy != lastBusy) {
            lastBusy = busy;
            if (busy) buildEpochMs = now;
        }
        CompanionAction action;
        long actionStart;
        boolean repeatPhase;
        if (busy) {
            action = actionRegistry.buildAction();
            if (buildEpochMs < 0) buildEpochMs = now;
            actionStart = buildEpochMs;
            repeatPhase = true;
        } else if (forcedAction != null) {
            action = actionRegistry.find(forcedAction);
            if (action == null) action = actionRegistry.find("stand");
            if (forcedEpochMs < 0) forcedEpochMs = now;
            actionStart = forcedEpochMs;
            repeatPhase = forcedPhase < 0f;
        } else {
            String requested = requestedAction;
            if (requested == null || CompanionActionRegistry.AUTO.equals(requested)) {
                if (autoEpochMs < 0) autoEpochMs = now;
                action = actionRegistry.autoAction(now - autoEpochMs, autoStartScratch);
                actionStart = autoEpochMs + autoStartScratch[0];
                repeatPhase = true;
            } else {
                action = actionRegistry.find(requested);
                if (action == null) {
                    requestedAction = CompanionActionRegistry.AUTO;
                    autoEpochMs = -1;
                    return;
                }
                if (actionEpochMs < 0) actionEpochMs = now;
                actionStart = actionEpochMs;
                long elapsed = Math.max(0L, now - actionStart);
                boolean holdActive = now < actionHoldUntilMs;
                boolean expiredHold = actionHoldUntilMs > 0 && !holdActive;
                boolean finishedOneShot = !action.loop && elapsed >= action.durationMs && !holdActive;
                if (expiredHold || finishedOneShot) {
                    requestedAction = CompanionActionRegistry.AUTO;
                    autoEpochMs = now;
                    actionHoldUntilMs = 0;
                    action = actionRegistry.autoAction(0, autoStartScratch);
                    actionStart = now;
                    repeatPhase = true;
                } else {
                    repeatPhase = action.loop || holdActive;
                }
            }
        }
        long elapsed = Math.max(0L, now - actionStart);
        float phase = repeatPhase
            ? (elapsed % action.durationMs) / (float) action.durationMs
            : Math.min(1f, elapsed / (float) action.durationMs);
        if (forcedPhase >= 0f && forcedAction != null && !busy) phase = forcedPhase;
        CompanionAction.Pose pose = action.poseAt(phase);
        currentAction = action;
        currentPose = pose;
        currentBodyYaw = pose.bodyYawDegrees;
        currentBodyLiftHeights = pose.bodyLiftMeters;
        boolean actionChanged = !action.id.equals(lastSkinnedActionId);
        if (vrm != null && (actionChanged || now - lastSkinMs >= SKIN_INTERVAL_MS)) {
            vrm.applyPose(pose.boneRotations, pose.hipsOffset);
            lastSkinnedActionId = action.id;
            lastSkinMs = now;
        }
        if (!action.id.equals(activeActionId)) {
            activeActionId = action.id;
            activity.onCompanionActionChanged(action.id);
        }
    }

    private void drawCompanionModel(VrmModel model) {
        long now = System.currentTimeMillis();
        updateActionClock(now);
        float avatarHeight = previewMode ? PREVIEW_COMPANION_HEIGHT_METERS : COMPANION_HEIGHT_METERS;
        model.normalise(avatarHeight);
        float lift = currentBodyLiftHeights * avatarHeight;

        Matrix.setIdentityM(characterFrame, 0);
        // Preview mode centres the avatar on the camera ray so its silhouette and scale are
        // easy to judge without an anchor.
        float offsetX = previewMode ? 0f : COMPANION_X;
        float offsetY = previewMode ? 0f : COMPANION_Y;
        float offsetZ = previewMode ? 0f : COMPANION_Z;
        Matrix.translateM(characterFrame, 0, offsetX, offsetY + lift, offsetZ);
        // Preview turns the avatar toward the camera so textures and the silhouette can be
        // compared against the model's own thumbnail.
        float baseYaw = previewMode ? 0f : 180f;
        Matrix.rotateM(characterFrame, 0, baseYaw + currentBodyYaw, 0f, 1f, 0f);
        Matrix.multiplyMM(characterFrameWorld, 0, modelMatrix, 0, characterFrame, 0);
        // Anchor the nameplate/bubble on the posed top-of-head vertex so they follow the head
        // through sit/lie/jump instead of assuming the standing height.
        float headLocalX;
        float headLocalY;
        float headLocalZ;
        if (model.hasSkin()) {
            model.headTop(headAnchorModel);
            headLocalX = model.scale() * (headAnchorModel[0] + model.offsetX());
            headLocalY = model.scale() * (headAnchorModel[1] + model.offsetY());
            headLocalZ = model.scale() * (headAnchorModel[2] + model.offsetZ());
        } else {
            headLocalX = 0f;
            headLocalY = avatarHeight;
            headLocalZ = 0f;
        }
        companionHeadWorld[0] = characterFrameWorld[0] * headLocalX + characterFrameWorld[4] * headLocalY
            + characterFrameWorld[8] * headLocalZ + characterFrameWorld[12];
        companionHeadWorld[1] = characterFrameWorld[1] * headLocalX + characterFrameWorld[5] * headLocalY
            + characterFrameWorld[9] * headLocalZ + characterFrameWorld[13];
        companionHeadWorld[2] = characterFrameWorld[2] * headLocalX + characterFrameWorld[6] * headLocalY
            + characterFrameWorld[10] * headLocalZ + characterFrameWorld[14];
        companionVisible = true;

        Matrix.scaleM(characterFrame, 0, model.scale(), model.scale(), model.scale());
        Matrix.translateM(characterFrame, 0, model.offsetX(), model.offsetY(), model.offsetZ());
        System.arraycopy(characterFrame, 0, characterModel, 0, 16);

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
        companionVisible = false;
        VrmModel model = vrm;
        if (model != null) {
            drawCompanionModel(model);
            return;
        }
        CompanionMesh.Mesh mesh = companionMesh;
        if (mesh == null || mesh.vertexCount == 0) return;
        long now = System.currentTimeMillis();
        updateActionClock(now);
        float lift = currentBodyLiftHeights * FALLBACK_COMPANION_HEIGHT_METERS;
        Matrix.setIdentityM(characterFrame, 0);
        Matrix.translateM(characterFrame, 0, COMPANION_X, COMPANION_Y + lift, COMPANION_Z);
        Matrix.rotateM(characterFrame, 0, 180f + currentBodyYaw, 0f, 1f, 0f);
        Matrix.multiplyMM(characterFrameWorld, 0, modelMatrix, 0, characterFrame, 0);
        companionHeadWorld[0] = characterFrameWorld[4] * FALLBACK_COMPANION_HEIGHT_METERS + characterFrameWorld[12];
        companionHeadWorld[1] = characterFrameWorld[5] * FALLBACK_COMPANION_HEIGHT_METERS + characterFrameWorld[13];
        companionHeadWorld[2] = characterFrameWorld[6] * FALLBACK_COMPANION_HEIGHT_METERS + characterFrameWorld[14];
        companionVisible = true;

        Matrix.multiplyMM(characterViewA, 0, viewMatrix, 0, modelMatrix, 0);
        Matrix.multiplyMM(characterViewB, 0, characterViewA, 0, characterFrame, 0);
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

    /**
     * Draws the nameplate and (when speaking) the speech bubble. Both are camera-facing billboards
     * drawn after the avatar with depth testing disabled so they never clip into the model.
     */
    private void drawCompanionBillboards() {
        Billboard quad = billboard;
        Nameplate plate = nameplate;
        if (!companionVisible || quad == null || plate == null) return;
        float dx = cameraPosition[0] - companionHeadWorld[0];
        float dy = cameraPosition[1] - companionHeadWorld[1];
        float dz = cameraPosition[2] - companionHeadWorld[2];
        float distance = (float) Math.sqrt(dx * dx + dy * dy + dz * dz);
        float clampedDistance = Math.max(MIN_BILLBOARD_DISTANCE, Math.min(MAX_BILLBOARD_DISTANCE, distance));

        plate.setText(companionName);
        plate.uploadIfNeeded();

        float namePixelScale = NAME_TEXT_SCREEN_FRACTION / (Nameplate.TEXT_SIZE_PX * FOV_FOCAL_FACTOR);
        float nameHeight = plate.pixelHeight() * namePixelScale * clampedDistance;
        float gap = 0.004f * clampedDistance;
        float nameCenterOffset = nameHeight * 0.5f + gap;
        float nameX = companionHeadWorld[0] + cameraUp[0] * nameCenterOffset;
        float nameY = companionHeadWorld[1] + cameraUp[1] * nameCenterOffset;
        float nameZ = companionHeadWorld[2] + cameraUp[2] * nameCenterOffset;

        float bubbleHeight = 0f;
        SpeechBubble bubble = speechBubble;
        float bubbleBottomOffset = nameHeight + gap * 2f;
        if (bubble != null && bubble.visible()) {
            float bubblePixelScale = BUBBLE_TEXT_SCREEN_FRACTION / (SpeechBubble.TEXT_SIZE_PX * FOV_FOCAL_FACTOR);
            bubbleHeight = bubble.pixelHeight() * bubblePixelScale * clampedDistance * bubble.scale();
            bubbleBottomOffset += (previewMode ? 0.055f : 0.012f) * clampedDistance;
        }

        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);
        GLES20.glEnable(GLES20.GL_BLEND);
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);

        plate.draw(quad, 1f, viewMatrix, projectionMatrix, cameraRight, cameraUp,
            nameX, nameY, nameZ, nameHeight);
        if (bubble != null && bubble.visible() && bubbleHeight > 0f) {
            float bubbleWidth = bubbleHeight * bubble.aspect();
            float bubbleCenterOffset = bubbleBottomOffset + bubbleHeight * 0.5f;
            float bubbleX = companionHeadWorld[0] + cameraUp[0] * bubbleCenterOffset;
            float bubbleY = companionHeadWorld[1] + cameraUp[1] * bubbleCenterOffset;
            float bubbleZ = companionHeadWorld[2] + cameraUp[2] * bubbleCenterOffset;
            quad.draw(bubble.textureId(), bubble.alpha(), viewMatrix, projectionMatrix,
                cameraRight, cameraUp, bubbleX, bubbleY, bubbleZ, bubbleWidth, bubbleHeight);
        }

        GLES20.glDisable(GLES20.GL_BLEND);
        GLES20.glDepthMask(true);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
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
        GLES20.glDeleteShader(vertexShader);
        GLES20.glDeleteShader(fragmentShader);
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
     * Textured voxel shader: one atlas sample per vertex UV, multiplied by the per-face shade so
     * voxel edges stay readable. Alpha is discarded for glass/leaves cut-outs.
     */
    private static final String TEXTURED_VERTEX_SHADER =
        "uniform mat4 u_Mvp; attribute vec3 a_Position; attribute vec2 a_Uv; attribute float a_Shade;"
        + "varying vec2 v_Uv; varying float v_Shade;"
        + "void main(){ gl_Position=u_Mvp*vec4(a_Position,1.0); v_Uv=a_Uv; v_Shade=a_Shade; }";
    private static final String TEXTURED_FRAGMENT_SHADER =
        "precision mediump float; uniform sampler2D u_Tex; varying vec2 v_Uv; varying float v_Shade;"
        + "void main(){ vec4 c=texture2D(u_Tex,v_Uv); if(c.a<0.35) discard;"
        + " gl_FragColor=vec4(c.rgb*v_Shade, 1.0); }";

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
