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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
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
    private int colorAlphaHandle;
    private int surfaceWidth;
    private int surfaceHeight;
    private long lastStatusMs;
    private long lastArStateMs;
    private long lastRotationLogMs;
    private long lastPoseFloorLogMs;
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

    /** Feet rest on the terrain surface: BUILD_MIN_Y voxels above the anchor plane. */
    private static final float COMPANION_Y = VoxelWorld.BUILD_MIN_Y * VoxelWorld.VOXEL_METERS;
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

    // ---- island drop-in, per-block pop-in and proposal highlight animations ------------------
    private boolean animationsEnabled = true;
    private boolean slowAnimations;
    private long dropStartMs = -1;
    private final float[] dropMatrix = new float[16];
    private final float[] dropResult = new float[16];
    private static final long DROP_DURATION_MS = 680L;
    private static final float DROP_START_HEIGHT_METERS = 0.35f;
    private static final long POP_DURATION_MS = 180L;
    private final ArrayList<BlockPop> blockPops = new ArrayList<>();
    private final HashSet<Long> hiddenCells = new HashSet<>();
    private final HashMap<Integer, BlockTemplate> blockTemplates = new HashMap<>();
    private volatile HouseProposal proposal;
    private HouseProposal renderedProposal;
    private long proposalStartMs;
    private int proposalFillVertexCount;
    private int proposalLineVertexCount;
    private FloatBuffer proposalFillPositions;
    private FloatBuffer proposalFillColors;
    private FloatBuffer proposalLinePositions;
    private FloatBuffer proposalLineColors;
    private final float[] proposalPopLocal = new float[16];
    private final float[] proposalPopMvp = new float[16];
    private long lastDropLogMs;

    private static final class BlockPop {
        final int x;
        final int y;
        final int z;
        final long startMs;
        boolean logged;

        BlockPop(int x, int y, int z, long startMs) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.startMs = startMs;
        }
    }

    private static final class BlockTemplate {
        final FloatBuffer positions;
        final FloatBuffer colors;
        final FloatBuffer uvs;
        final FloatBuffer shades;
        final int vertexCount;
        final int texturedVertexCount;

        BlockTemplate(FloatBuffer positions, FloatBuffer colors, FloatBuffer uvs, FloatBuffer shades,
                      int vertexCount, int texturedVertexCount) {
            this.positions = positions;
            this.colors = colors;
            this.uvs = uvs;
            this.shades = shades;
            this.vertexCount = vertexCount;
            this.texturedVertexCount = texturedVertexCount;
        }
    }

    // ---- companion locomotion (island-local position / facing / steps) ----------------------
    private final CompanionLocomotion locomotion = new CompanionLocomotion();
    private final float[] inverseIslandMatrix = new float[16];
    private float lastBuildX;
    private float lastBuildZ;
    private long lastBuildMs = -1L;
    private String lastSeatAction = "";

    // ---- emote bubble while the companion sits / sleeps --------------------------------------
    private EmoteBubble emoteBubble;
    private long nextEmoteMs;
    private static final String SLEEP_EMOTE = "💤";
    private static final String[] SIT_EMOTES = {"♪", "❤️", "✨", "💤"};
    /** Fraction of screen height the emote glyph should cover; matches its bitmap text size. */
    private static final float EMOTE_HEIGHT_SCREEN_FRACTION = 0.016f;

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

    /** True once the island anchor exists (or the debug virtual anchor is active). */
    private volatile boolean islandPlaced;

    boolean isIslandPlaced() { return islandPlaced; }

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

    /** Registers the cells of a commit so each newly placed block pops in on its own. */
    void onBlocksCommitted(int[] placedCells) {
        if (placedCells == null || placedCells.length < 3) {
            meshDirty = true;
            return;
        }
        if (!animationsEnabled) {
            meshDirty = true;
            return;
        }
        long now = System.currentTimeMillis();
        for (int index = 0; index + 2 < placedCells.length; index += 3) {
            int x = placedCells[index];
            int y = placedCells[index + 1];
            int z = placedCells[index + 2];
            float cellX = (x + 0.5f) * VoxelWorld.VOXEL_METERS;
            float cellZ = (z + 0.5f) * VoxelWorld.VOXEL_METERS;
            lastBuildX = cellX;
            lastBuildZ = cellZ;
            lastBuildMs = now;
            // If the new block is out of reach, hide it and delay the visual pop until the
            // companion has walked closer (the companion must not place blocks from afar).
            long travelDelay = locomotion.extraTravelDelayMs(cellX, cellZ);
            blockPops.add(new BlockPop(x, y, z, now + travelDelay));
            hiddenCells.add(VoxelWorld.cellKey(x, y, z));
            android.util.Log.i("BlockPop", "cell=" + x + "," + y + "," + z + " travelDelayMs=" + travelDelay
                + " reach=" + locomotion.withinReach(cellX, cellZ));
        }
        meshDirty = true;
    }

    /** Shows the pending house proposal footprint highlight; {@code null} hides it. */
    void setProposal(HouseProposal newProposal) {
        if (newProposal == null) {
            proposal = null;
            renderedProposal = null;
            proposalFillVertexCount = 0;
            proposalLineVertexCount = 0;
            return;
        }
        proposal = newProposal;
        renderedProposal = null; // rebuild in the next frame
        proposalStartMs = System.currentTimeMillis();
    }

    /** Debug (`--ez noanim true`): disables drop/pop/pulse/emote animations. */
    void setAnimationsEnabled(boolean enabled) {
        animationsEnabled = enabled;
        if (!enabled) {
            dropStartMs = -1;
            blockPops.clear();
            if (!hiddenCells.isEmpty()) {
                hiddenCells.clear();
                meshDirty = true;
            }
        }
    }

    /** Debug (`--ez slowanim true`): slows the drop/pop timing for frame capture. */
    void setSlowAnimations(boolean slow) { slowAnimations = slow; }

    /**
     * Debug (`--ez demoAnchor true`): draw the island at a fixed camera-relative pose instead of an
     * ARCore anchor, so the drop-in/pop-in animations can be captured with good framing even when
     * no usable plane is in front of the camera.
     */
    void setDemoAnchor(boolean enabled) { demoAnchor = enabled; }

    /** Debug (`--ez demoLow true`): lower the virtual anchor to eye level for low-angle shots. */
    void setDemoLowAngle(boolean enabled) { demoLowAngle = enabled; }

    private volatile boolean demoAnchor;
    private volatile boolean demoLowAngle;
    private boolean virtualDropStarted;

    /** Working distance the companion walks to before a block is placed (its "arm's length"). */
    private static final float BUILD_WORK_DISTANCE = 0.14f;

    private long animationDuration(long baseMs) {
        return slowAnimations ? baseMs * 3L : baseMs;
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
            colorAlphaHandle = GLES20.glGetUniformLocation(program, "u_Alpha");
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
            emoteBubble = new EmoteBubble();
            blockTemplates.clear();
            hiddenCells.clear();
            blockPops.clear();
            dropStartMs = -1;
            virtualDropStarted = false;
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
        int rotation = activity.getWindowManager().getDefaultDisplay().getRotation();
        android.util.Log.i("Rotation", "surfaceChanged " + width + "x" + height + " rotation=" + rotation
            + " session=" + (session != null));
        if (session != null) {
            try { session.setDisplayGeometry(rotation, width, height); }
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
            long rotationLogNow = System.currentTimeMillis();
            if (rotationLogNow - lastRotationLogMs > 1500L) {
                lastRotationLogMs = rotationLogNow;
                android.util.Log.i("Rotation", "frame surface=" + surfaceWidth + "x" + surfaceHeight
                    + " displayRotation=" + activity.getWindowManager().getDefaultDisplay().getRotation()
                    + " cameraTracking=" + camera.getTrackingState());
            }
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
            updateAnimations(now);
            if (previewMode) {
                if (demoAnchor) {
                    // Debug-only virtual anchor: island + companion drawn at a fixed camera-relative
                    // pose so drop-in/pop-in animations can be captured with good framing.
                    Matrix.invertM(modelMatrix, 0, viewMatrix, 0);
                    if (demoLowAngle) {
                        Matrix.translateM(modelMatrix, 0, 0f, -0.055f, -0.85f);
                    } else {
                        Matrix.translateM(modelMatrix, 0, 0f, -0.18f, -0.92f);
                    }
                    if (!virtualDropStarted) {
                        virtualDropStarted = true;
                        dropStartMs = now;
                    }
                    if (!islandPlaced) {
                        islandPlaced = true;
                        activity.setIslandPlaced(true);
                    }
                    applyIslandDrop(modelMatrix, now);
                    Matrix.multiplyMM(modelView, 0, viewMatrix, 0, modelMatrix, 0);
                    Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);
                    if (meshDirty) rebuildMesh();
                    drawVoxels();
                    drawProposalHighlight(now);
                    drawBlockPops(now);
                    drawCompanion();
                    drawCompanionBillboards(now);
                    publishArState(true, -1, true);
                    publishStatus("预览模式（演示锚点）：小岛落桌 / 方块逐个弹出");
                    return;
                }
                // Preview inspection is immune to stray taps and to an existing anchor: it always
                // draws the companion in front of the camera (and the island when one is up).
                boolean anchored = anchor != null && anchor.getTrackingState() == TrackingState.TRACKING;
                if (!islandPlaced) {
                    islandPlaced = true;
                    activity.setIslandPlaced(true);
                }
                if (anchored) {
                    buildAnchorContentMatrix(now);
                    if (meshDirty) rebuildMesh();
                    drawVoxels();
                    drawProposalHighlight(now);
                    drawBlockPops(now);
                }
                drawPreviewCompanion(camera);
                drawCompanionBillboards(now);
                publishArState(true, -1, anchored);
                publishStatus("预览模式：仅用于检查动作与模型，点击不会放置小岛");
                return;
            }
            if (anchor == null || anchor.getTrackingState() != TrackingState.TRACKING) {
                if (islandPlaced) {
                    islandPlaced = false;
                    activity.setIslandPlaced(false);
                }
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
            buildAnchorContentMatrix(now);
            if (meshDirty) rebuildMesh();
            drawVoxels();
            drawProposalHighlight(now);
            drawBlockPops(now);
            drawCompanion();
            drawCompanionBillboards(now);
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
        VoxelWorld.Mesh mesh = world.buildMesh(voxelAtlas, hiddenCells);
        voxelVertexCount = mesh.vertexCount;
        voxelTexturedVertexCount = voxelAtlas != null ? mesh.texturedVertexCount : 0;
        voxelVertices = directBuffer(mesh.positions);
        voxelColors = directBuffer(mesh.colors);
        voxelUvs = directBuffer(mesh.uvs);
        voxelShades = directBuffer(mesh.shades);
    }

    /**
     * Builds the anchor pose plus the island drop-in animation into {@link #modelMatrix} and its
     * MVP. The drop is object-level only: the whole island (and the companion riding on it) starts
     * ~35 cm above the table, falls with an ease-in, bounces once and squashes briefly on impact.
     */
    private void buildAnchorContentMatrix(long now) {
        anchor.getPose().toMatrix(modelMatrix, 0);
        applyIslandDrop(modelMatrix, now);
        Matrix.multiplyMM(modelView, 0, viewMatrix, 0, modelMatrix, 0);
        Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);
    }

    private void applyIslandDrop(float[] matrix, long now) {
        if (dropStartMs < 0 || !animationsEnabled) return;
        long duration = animationDuration(DROP_DURATION_MS);
        long elapsed = now - dropStartMs;
        if (elapsed >= duration) {
            dropStartMs = -1;
            return;
        }
        float t = elapsed / (float) duration;
        float liftMeters;
        float squash;
        if (t < 0.55f) {
            // Ease-in fall: slow at first, then accelerating down (gravity feel).
            float u = t / 0.55f;
            liftMeters = DROP_START_HEIGHT_METERS * (1f - u * u);
            squash = 0f;
        } else {
            // Impact at t=0.55: brief squash plus a small bounce that settles.
            float u = (t - 0.55f) / 0.45f;
            liftMeters = u < 0.5f ? 0.045f * (float) Math.sin(Math.PI * u / 0.5f) : 0f;
            squash = (float) Math.exp(-Math.pow((t - 0.55f) / 0.06f, 2.0));
        }
        Matrix.setIdentityM(dropMatrix, 0);
        Matrix.translateM(dropMatrix, 0, 0f, liftMeters, 0f);
        Matrix.scaleM(dropMatrix, 0, 1f + 0.10f * squash, 1f - 0.16f * squash, 1f + 0.10f * squash);
        Matrix.multiplyMM(dropResult, 0, matrix, 0, dropMatrix, 0);
        System.arraycopy(dropResult, 0, matrix, 0, 16);
        if (now - lastDropLogMs > 120L) {
            lastDropLogMs = now;
            android.util.Log.i("IslandDrop", String.format(java.util.Locale.US,
                "t=%.2f lift=%.3f squash=%.2f", t, liftMeters, squash));
        }
    }

    /** Advances pop completion, proposal expiry and the sit/sleep emote scheduler. */
    private void updateAnimations(long now) {
        if (!blockPops.isEmpty()) {
            boolean changed = false;
            long popDuration = animationDuration(POP_DURATION_MS);
            for (Iterator<BlockPop> iterator = blockPops.iterator(); iterator.hasNext(); ) {
                BlockPop pop = iterator.next();
                if (now - pop.startMs >= popDuration) {
                    iterator.remove();
                    hiddenCells.remove(VoxelWorld.cellKey(pop.x, pop.y, pop.z));
                    changed = true;
                }
            }
            if (changed) meshDirty = true;
        }
        HouseProposal active = proposal;
        if (active != null && active.expired(now)) {
            setProposal(null);
            activity.onProposalExpired();
        }
    }

    /** Draws one 180 ms scale-up pop for every newly committed block. */
    private void drawBlockPops(long now) {
        if (blockPops.isEmpty() || !animationsEnabled) return;
        long popDuration = animationDuration(POP_DURATION_MS);
        for (BlockPop pop : blockPops) {
            if (now < pop.startMs) continue; // waiting for the companion to walk into reach
            float t = (now - pop.startMs) / (float) popDuration;
            if (t >= 1f) continue;
            int code = world.blockAt(pop.x, pop.y, pop.z) & 0xff;
            if (code == 0) continue;
            BlockTemplate template = blockTemplate(code);
            if (template == null) continue;
            // Pop scale in voxel units: the cached template is a unit cube centred on the origin,
            // so the matrix must be `anchor * T(block centre) * S(voxelSize * popScale)`. This is
            // exactly the same anchor composition as the voxel mesh, only with a temporary scale
            // about the block centre; the scale is clamped so a popping block can never exceed a
            // little over one voxel (the earlier bug scaled the unit cube by ~1 metre).
            float popScale = Math.min(1.05f, 0.35f + 0.70f * CompanionPoseMath.easeOutBack(t));
            float size = VoxelWorld.VOXEL_METERS * popScale;
            if (!pop.logged) {
                pop.logged = true;
                android.util.Log.i("BlockPop", String.format(java.util.Locale.US,
                    "pop draw cell=%d,%d,%d sizeMeters=%.4f popScale=%.2f", pop.x, pop.y, pop.z, size, popScale));
            }
            Matrix.setIdentityM(proposalPopLocal, 0);
            Matrix.translateM(proposalPopLocal, 0,
                (pop.x + 0.5f) * VoxelWorld.VOXEL_METERS,
                (pop.y + 0.5f) * VoxelWorld.VOXEL_METERS,
                (pop.z + 0.5f) * VoxelWorld.VOXEL_METERS);
            Matrix.scaleM(proposalPopLocal, 0, size, size, size);
            Matrix.multiplyMM(proposalPopMvp, 0, mvp, 0, proposalPopLocal, 0);
            if (template.texturedVertexCount > 0) {
                drawTexturedMesh(template.positions, template.uvs, template.shades,
                    template.texturedVertexCount, proposalPopMvp);
            }
            int flatCount = template.vertexCount - template.texturedVertexCount;
            if (flatCount > 0) {
                drawFlatMesh(template.positions, template.colors, template.texturedVertexCount,
                    flatCount, proposalPopMvp);
            }
        }
    }

    /** Builds and caches the unit-cube template used for pop-in blocks of one block id. */
    private BlockTemplate blockTemplate(int code) {
        BlockTemplate cached = blockTemplates.get(code);
        if (cached != null) return cached;
        VoxelWorld.Mesh mesh = world.buildBlockMesh(voxelAtlas, code);
        if (mesh.vertexCount == 0) return null;
        BlockTemplate template = new BlockTemplate(
            directBuffer(mesh.positions), directBuffer(mesh.colors),
            directBuffer(mesh.uvs), directBuffer(mesh.shades),
            mesh.vertexCount, voxelAtlas != null ? mesh.texturedVertexCount : 0);
        blockTemplates.put(code, template);
        return template;
    }

    /**
     * Rebuilds the proposal footprint highlight: a translucent warm fill over the top face of the
     * proposed cells plus brighter edge lines, with a slow pulse.
     */
    private void buildProposalBuffers(HouseProposal active) {
        int cells = active.footprintCells();
        if (cells <= 0) {
            proposalFillVertexCount = 0;
            proposalLineVertexCount = 0;
            return;
        }
        final float s = VoxelWorld.VOXEL_METERS;
        float topY = active.maxY * s + 0.0016f;
        float edgeY = topY + 0.0008f;
        float[] fillPositions = new float[cells * 6 * 3];
        float[] fillColors = new float[cells * 6 * 4];
        float[] linePositions = new float[cells * 8 * 3];
        float[] lineColors = new float[cells * 8 * 4];
        int fillCursor = 0;
        int colorCursor = 0;
        int lineCursor = 0;
        int lineColorCursor = 0;
        for (int x = active.minX; x < active.maxX; x += 1) {
            for (int z = active.minZ; z < active.maxZ; z += 1) {
                float x0 = x * s;
                float x1 = (x + 1) * s;
                float z0 = z * s;
                float z1 = (z + 1) * s;
                // Two triangles for the cell's top face.
                float[][] corners = {
                    {x0, topY, z0}, {x0, topY, z1}, {x1, topY, z1},
                    {x0, topY, z0}, {x1, topY, z1}, {x1, topY, z0},
                };
                for (float[] corner : corners) {
                    fillPositions[fillCursor++] = corner[0];
                    fillPositions[fillCursor++] = corner[1];
                    fillPositions[fillCursor++] = corner[2];
                    fillColors[colorCursor++] = 1.0f;
                    fillColors[colorCursor++] = 0.72f;
                    fillColors[colorCursor++] = 0.26f;
                    fillColors[colorCursor++] = 1.0f;
                }
                // Perimeter lines per cell on the top face (four edges -> 8 vertices for GL_LINES).
                float[][] edges = {
                    {x0, edgeY, z0}, {x1, edgeY, z0},
                    {x1, edgeY, z0}, {x1, edgeY, z1},
                    {x1, edgeY, z1}, {x0, edgeY, z1},
                    {x0, edgeY, z1}, {x0, edgeY, z0},
                };
                for (float[] point : edges) {
                    linePositions[lineCursor++] = point[0];
                    linePositions[lineCursor++] = point[1];
                    linePositions[lineCursor++] = point[2];
                    lineColors[lineColorCursor++] = 1.0f;
                    lineColors[lineColorCursor++] = 0.92f;
                    lineColors[lineColorCursor++] = 0.62f;
                    lineColors[lineColorCursor++] = 1.0f;
                }
            }
        }
        proposalFillPositions = directBuffer(fillPositions);
        proposalFillColors = directBuffer(fillColors);
        proposalLinePositions = directBuffer(linePositions);
        proposalLineColors = directBuffer(lineColors);
        proposalFillVertexCount = cells * 6;
        proposalLineVertexCount = cells * 8;
    }

    private void drawProposalHighlight(long now) {
        HouseProposal active = proposal;
        if (active == null || active.footprintCells() <= 0) return;
        if (renderedProposal != active) {
            buildProposalBuffers(active);
            renderedProposal = active;
        }
        if (proposalFillVertexCount == 0 || proposalFillPositions == null) return;
        float alpha = animationsEnabled
            ? 0.30f + 0.12f * (float) Math.sin((now - proposalStartMs) * 0.0044f)
            : 0.34f;
        GLES20.glUseProgram(program);
        GLES20.glUniformMatrix4fv(mvpHandle, 1, false, mvp, 0);
        GLES20.glEnable(GLES20.GL_BLEND);
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);
        GLES20.glDepthMask(false);
        // Translucent pulsing fill.
        GLES20.glUniform1f(colorAlphaHandle, alpha);
        proposalFillPositions.position(0);
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 0, proposalFillPositions);
        proposalFillColors.position(0);
        GLES20.glEnableVertexAttribArray(colorHandle);
        GLES20.glVertexAttribPointer(colorHandle, 4, GLES20.GL_FLOAT, false, 0, proposalFillColors);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, proposalFillVertexCount);
        // Brighter edge lines.
        GLES20.glUniform1f(colorAlphaHandle, 1f);
        GLES20.glLineWidth(2f);
        proposalLinePositions.position(0);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 0, proposalLinePositions);
        proposalLineColors.position(0);
        GLES20.glVertexAttribPointer(colorHandle, 4, GLES20.GL_FLOAT, false, 0, proposalLineColors);
        GLES20.glDrawArrays(GLES20.GL_LINES, 0, proposalLineVertexCount);
        GLES20.glDisableVertexAttribArray(positionHandle);
        GLES20.glDisableVertexAttribArray(colorHandle);
        GLES20.glDepthMask(true);
        GLES20.glDisable(GLES20.GL_BLEND);
        GLES20.glUniform1f(colorAlphaHandle, 1f);
    }

    /**
     * Schedules the emote bubble while the companion sits ("♪"/"❤️"/"✨"/"💤" occasionally) or
     * lies down ("💤" sleep emote). Uses the existing action registry ids, no new poses.
     */
    private void updateEmote(long now) {
        EmoteBubble bubble = emoteBubble;
        if (bubble == null) return;
        boolean sitting = "sit".equals(activeActionId);
        boolean sleeping = "lie".equals(activeActionId);
        if (!sitting && !sleeping) {
            bubble.hide();
            nextEmoteMs = 0;
            return;
        }
        bubble.update(now);
        if (bubble.visible() || now < nextEmoteMs) return;
        String emote = sleeping
            ? SLEEP_EMOTE
            : SIT_EMOTES[(int) (Math.random() * SIT_EMOTES.length)];
        bubble.show(emote, now);
        nextEmoteMs = now + (sleeping ? 3400L : 2600L + (long) (Math.random() * 1400));
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
        android.util.Log.i("TapMap", "tap surface=" + surfaceWidth + "x" + surfaceHeight
            + " rotation=" + activity.getWindowManager().getDefaultDisplay().getRotation()
            + " -> column x=" + column[0] + " z=" + column[1]);
        // Tapping the highlighted proposal footprint is equivalent to pressing 「好呀」.
        HouseProposal active = proposal;
        if (active != null && !active.expired(System.currentTimeMillis()) && active.containsColumn(column[0], column[1])) {
            activity.onProposalAreaTapped();
            return;
        }
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
            dropStartMs = System.currentTimeMillis();
            // Requirement: on spawn/re-anchor the companion is teleported to the island centre and
            // faces the user (its facing is recomputed from the camera on the first frame).
            locomotion.resetToCentre();
            lastBuildMs = -1L;
            lastSeatAction = "";
            // Start from a clean companion state: the drop-in animation is the first thing the
            // user sees, then normal idle behaviour, regardless of frames received earlier.
            requestedAction = CompanionActionRegistry.AUTO;
            autoEpochMs = -1;
            actionEpochMs = 0;
            actionHoldUntilMs = 0;
            forcedAction = null;
            activeActionId = "";
            islandPlaced = true;
            activity.setIslandPlaced(true);
            float adx = cameraPosition[0] - newAnchor.getPose().tx();
            float ady = cameraPosition[1] - newAnchor.getPose().ty();
            float adz = cameraPosition[2] - newAnchor.getPose().tz();
            android.util.Log.i("IslandDrop", String.format(java.util.Locale.US,
                "anchor created dist=%.2f — replaying drop-in animation",
                Math.sqrt(adx * adx + ady * ady + adz * adz)));
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
        drawTexturedMesh(voxelVertices, voxelUvs, voxelShades, vertexCount, mvp);
    }

    private void drawTexturedMesh(FloatBuffer positions, FloatBuffer uvs, FloatBuffer shades,
                                  int vertexCount, float[] mvpMatrix) {
        if (voxelAtlas == null || !voxelAtlas.ready()) return;
        GLES20.glUseProgram(voxelProgram);
        GLES20.glUniformMatrix4fv(voxelMvpHandle, 1, false, mvpMatrix, 0);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, voxelAtlas.textureId());
        GLES20.glUniform1i(voxelTextureHandle, 0);
        positions.position(0);
        GLES20.glEnableVertexAttribArray(voxelPositionHandle);
        GLES20.glVertexAttribPointer(voxelPositionHandle, 3, GLES20.GL_FLOAT, false, 0, positions);
        uvs.position(0);
        GLES20.glEnableVertexAttribArray(voxelUvHandle);
        GLES20.glVertexAttribPointer(voxelUvHandle, 2, GLES20.GL_FLOAT, false, 0, uvs);
        shades.position(0);
        GLES20.glEnableVertexAttribArray(voxelShadeHandle);
        GLES20.glVertexAttribPointer(voxelShadeHandle, 1, GLES20.GL_FLOAT, false, 0, shades);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, vertexCount);
        GLES20.glDisableVertexAttribArray(voxelPositionHandle);
        GLES20.glDisableVertexAttribArray(voxelUvHandle);
        GLES20.glDisableVertexAttribArray(voxelShadeHandle);
    }

    /** Flat-colour fallback path for blocks absent from the atlas mapping. */
    private void drawVoxelsFlat(int firstVertex, int vertexCount) {
        drawFlatMesh(voxelVertices, voxelColors, firstVertex, vertexCount, mvp);
    }

    private void drawFlatMesh(FloatBuffer positions, FloatBuffer colors, int firstVertex,
                              int vertexCount, float[] mvpMatrix) {
        if (vertexCount <= 0 || positions == null || colors == null) return;
        GLES20.glUseProgram(program);
        GLES20.glUniformMatrix4fv(mvpHandle, 1, false, mvpMatrix, 0);
        GLES20.glUniform1f(colorAlphaHandle, 1f);
        positions.position(firstVertex * 3);
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 0, positions);
        colors.position(firstVertex * 4);
        GLES20.glEnableVertexAttribArray(colorHandle);
        GLES20.glVertexAttribPointer(colorHandle, 4, GLES20.GL_FLOAT, false, 0, colors);
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

    /**
     * Surface the companion rests on: the grass top, or the top of the highest block in its current
     * column (used for the stairs seat and for climbing onto built blocks).
     */
    private float companionFloorY() {
        int voxelX = (int) Math.floor(locomotion.x / VoxelWorld.VOXEL_METERS);
        int voxelZ = (int) Math.floor(locomotion.z / VoxelWorld.VOXEL_METERS);
        int top = world.topSolidY(voxelX, voxelZ);
        if (top < 0) return COMPANION_Y;
        return Math.max(COMPANION_Y, (top + 1) * VoxelWorld.VOXEL_METERS);
    }

    /**
     * Updates the companion's island-local behaviour for this frame: face the camera and slowly
     * sway while idle, walk toward and face the cell currently being built, and walk to a nearby
     * free spot before sitting/lying down. Keeps the avatar out of occupied cells (see
     * {@link CompanionLocomotion}).
     */
    private void updateCompanionBehaviour(long now) {
        boolean busy = "building".equals(companionState) || "planning".equals(companionState);
        boolean recentBuild = lastBuildMs > 0L && now - lastBuildMs < 2200L;
        Matrix.invertM(inverseIslandMatrix, 0, modelMatrix, 0);
        float localCameraX = inverseIslandMatrix[0] * cameraPosition[0]
            + inverseIslandMatrix[4] * cameraPosition[1]
            + inverseIslandMatrix[8] * cameraPosition[2]
            + inverseIslandMatrix[12];
        float localCameraZ = inverseIslandMatrix[2] * cameraPosition[0]
            + inverseIslandMatrix[6] * cameraPosition[1]
            + inverseIslandMatrix[10] * cameraPosition[2]
            + inverseIslandMatrix[14];
        float idleSway = (float) Math.sin(now * 0.00063f) * 12f;
        if (recentBuild || busy) {
            // Leaving a seat flow (e.g. after the build) must re-arm the seat walk next time the
            // companion sits down.
            lastSeatAction = "";
            locomotion.faceTowards(lastBuildX, lastBuildZ);
            if (!locomotion.moving() && !locomotion.withinDistance(lastBuildX, lastBuildZ, BUILD_WORK_DISTANCE)) {
                locomotion.walkNear(lastBuildX, lastBuildZ, now, world, BUILD_WORK_DISTANCE);
            }
        } else {
            if ("sit".equals(activeActionId) || "lie".equals(activeActionId)) {
                if (!activeActionId.equals(lastSeatAction)) {
                    lastSeatAction = activeActionId;
                    // Prefer the finished house's stairs block as the seat; fall back to any free
                    // spot on the grass.
                    if (!locomotion.walkToNearestSeat(now, world)) {
                        locomotion.walkToNearestFreeSpot(now, world);
                    }
                }
            } else {
                lastSeatAction = "";
            }
            locomotion.faceCamera(localCameraX, localCameraZ, idleSway);
        }
        locomotion.update(now, world);
    }

    private void drawCompanionModel(VrmModel model) {
        long now = System.currentTimeMillis();
        updateActionClock(now);
        // The enlarged camera-relative preview model is only for pose inspection; when drawing on
        // the debug virtual anchor the companion keeps its real island scale/facing.
        boolean bigPreview = previewMode && !demoAnchor;
        float avatarHeight = bigPreview ? PREVIEW_COMPANION_HEIGHT_METERS : COMPANION_HEIGHT_METERS;
        model.normalise(avatarHeight);
        updateCompanionBehaviour(now);
        float baseY = bigPreview ? 0f : companionFloorY();
        float poseLift = currentBodyLiftHeights * avatarHeight;
        float hopLift = locomotion.lift;
        // Bidirectional floor clamp: the lowest posed skinned vertex must rest exactly on the
        // surface under the companion (grass, a stairs seat, or any block top). The correction is
        // applied to the resting transform and can be negative (lie pose was left hovering by the
        // old lift-only clamp); intentional lifts (jump arc, walk hop/bob) are added afterwards.
        float minModelY = model.hasSkin() ? model.posedMinY() : 0f;
        float lowestOffset = model.scale() * (minModelY + model.offsetY());
        float floorY = bigPreview ? 0f : baseY;
        float correction = (floorY + 0.002f) - (baseY + lowestOffset);
        float lift = poseLift + hopLift + correction;
        if (now - lastPoseFloorLogMs > 700L) {
            lastPoseFloorLogMs = now;
            android.util.Log.i("PoseFloor", String.format(java.util.Locale.US,
                "action=%s floor=%.3f baseY=%.3f minModelY=%.3f lowestOffset=%.3f correction=%+.3f poseLift=%.3f x=%.3f z=%.3f",
                activeActionId, floorY, baseY, minModelY, lowestOffset, correction, poseLift,
                locomotion.x, locomotion.z));
        }
        Matrix.setIdentityM(characterFrame, 0);
        Matrix.translateM(characterFrame, 0, locomotion.x, baseY + lift, locomotion.z);
        Matrix.rotateM(characterFrame, 0, locomotion.yawDeg + currentBodyYaw, 0f, 1f, 0f);
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
        updateCompanionBehaviour(now);
        float lift = currentBodyLiftHeights * FALLBACK_COMPANION_HEIGHT_METERS + locomotion.lift;
        float baseY = companionFloorY();
        lift += (baseY + 0.002f) - (baseY + lift);
        Matrix.setIdentityM(characterFrame, 0);
        Matrix.translateM(characterFrame, 0, locomotion.x, baseY + lift, locomotion.z);
        Matrix.rotateM(characterFrame, 0, locomotion.yawDeg + currentBodyYaw, 0f, 1f, 0f);
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
        GLES20.glUniform1f(colorAlphaHandle, 1f);
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
     * Draws the nameplate, the sit/sleep emote bubble and (when speaking) the speech bubble. All
     * are camera-facing billboards drawn after the avatar with depth testing disabled so they
     * never clip into the model.
     */
    private void drawCompanionBillboards(long now) {
        Billboard quad = billboard;
        Nameplate plate = nameplate;
        if (!companionVisible || quad == null || plate == null) return;
        updateEmote(now);
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

        SpeechBubble bubble = speechBubble;
        boolean bubbleVisible = bubble != null && bubble.visible();
        float bubbleHeight = 0f;
        float bubbleBottomOffset = nameHeight + gap * 2f;
        if (bubbleVisible) {
            float bubblePixelScale = BUBBLE_TEXT_SCREEN_FRACTION / (SpeechBubble.TEXT_SIZE_PX * FOV_FOCAL_FACTOR);
            bubbleHeight = bubble.pixelHeight() * bubblePixelScale * clampedDistance * bubble.scale();
            bubbleBottomOffset += (previewMode ? 0.055f : 0.012f) * clampedDistance;
        }

        EmoteBubble emote = emoteBubble;
        float emoteHeight = 0f;
        float emoteOffset = 0f;
        if (emote != null && emote.visible() && !bubbleVisible) {
            float emotePixelScale = EMOTE_HEIGHT_SCREEN_FRACTION / (EmoteBubble.TEXT_SIZE_PX * FOV_FOCAL_FACTOR);
            emoteHeight = emote.pixelHeight() * emotePixelScale * clampedDistance * emote.scale();
            float bob = animationsEnabled
                ? (float) Math.sin(now * 0.006) * 0.004f * clampedDistance
                : 0f;
            emoteOffset = nameHeight + gap * 2f + (previewMode ? 0.02f : 0.004f) * clampedDistance + bob;
        }

        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);
        GLES20.glEnable(GLES20.GL_BLEND);
        GLES20.glBlendFunc(GLES20.GL_SRC_ALPHA, GLES20.GL_ONE_MINUS_SRC_ALPHA);

        plate.draw(quad, 1f, viewMatrix, projectionMatrix, cameraRight, cameraUp,
            nameX, nameY, nameZ, nameHeight);
        if (emoteHeight > 0f) {
            float emoteWidth = emoteHeight * emote.aspect();
            float emoteCenterOffset = emoteOffset + emoteHeight * 0.5f;
            float emoteX = companionHeadWorld[0] + cameraUp[0] * emoteCenterOffset;
            float emoteY = companionHeadWorld[1] + cameraUp[1] * emoteCenterOffset;
            float emoteZ = companionHeadWorld[2] + cameraUp[2] * emoteCenterOffset;
            quad.draw(emote.textureId(), emote.alpha(), viewMatrix, projectionMatrix,
                cameraRight, cameraUp, emoteX, emoteY, emoteZ, emoteWidth, emoteHeight);
        }
        if (bubbleVisible && bubbleHeight > 0f) {
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
        dropStartMs = -1;
        if (islandPlaced) {
            islandPlaced = false;
            activity.setIslandPlaced(false);
        }
        if (!blockPops.isEmpty() || !hiddenCells.isEmpty()) {
            blockPops.clear();
            hiddenCells.clear();
            meshDirty = true;
        }
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
        "precision mediump float; uniform float u_Alpha; varying vec4 v_Color;"
        + "void main(){ gl_FragColor=vec4(v_Color.rgb, v_Color.a*u_Alpha); }";

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
