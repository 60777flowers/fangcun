package org.fangcun.ar.poc;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import androidx.annotation.NonNull;

import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import com.google.ar.core.exceptions.UnavailableArcoreNotInstalledException;
import com.google.ar.core.exceptions.UnavailableApkTooOldException;
import com.google.ar.core.exceptions.UnavailableSdkTooOldException;
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException;

import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native AR client slice for Fangcun.
 *
 * Renders the Host's authoritative voxel world at a tabletop anchor and forwards taps as
 * world intents. Transport is the loopback Host reached through `adb reverse`; LAN TLS,
 * certificate pinning and QR pairing are the next hardening step, not implemented here.
 *
 * <p>The tablet overlay is deliberately lightweight: a compact translucent status card, small
 * floating buttons, and two panels (settings and chat history) that are hidden by default so the
 * AR camera view and its tap handling stay unobstructed. Companion dialogue is shown as a 3D
 * speech bubble above the avatar's head by the renderer; this activity only keeps the history.</p>
 */
public final class ArPocActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 100;
    private static final String HOST = "127.0.0.1";
    private static final int PORT = 8765;
    private static final int CHAT_HISTORY_LIMIT = 8;

    private static final int COLOR_TEXT = 0xFFF3F7F4;
    private static final int COLOR_MUTED = 0xFFB6C6BD;
    private static final int COLOR_ACCENT = 0xFFFFD28A;
    private static final int COLOR_CARD = 0xB3141F1A;
    private static final int COLOR_DOT_ONLINE = 0xFF7BD88F;
    private static final int COLOR_DOT_CONNECTING = 0xFFFFD28A;
    private static final int COLOR_DOT_OFFLINE = 0xFFFF7B72;
    private static final int COLOR_DOT_IDLE = 0xFF9AA79E;

    private volatile Session session;
    private ArPocView arView;
    private boolean installRequested;

    private final VoxelWorld world = new VoxelWorld();
    private final ExecutorService hostExecutor = Executors.newSingleThreadExecutor();
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private android.content.SharedPreferences prefs;
    private HostClient hostClient;

    private String arStatus = "Starting…";
    private String hostStatus = "Not connected";
    private String companionName = "大肥鱼";
    private String intentCompanionName;
    private int linkState = HostClient.LINK_IDLE;
    private int worldRev = -1;
    private int worldBlocks;
    private String currentActionId = "auto";
    private String requestedActionId = "auto";
    private boolean paired;
    private final ArrayDeque<String> chatHistory = new ArrayDeque<>();

    private View connectionDot;
    private TextView statusMeta;
    private TextView statusAction;
    private TextView hintText;
    private TextView guidanceText;
    private TextView chipTracking;
    private TextView chipPlanes;
    private TextView chipPlaced;
    private View coachOverlay;
    private boolean arReady;
    private boolean arTracking;
    private int arPlaneCount = -1;
    private boolean islandAnchored;
    private boolean cameraPermissionDenied;
    private String arError;
    private boolean previewMode;
    private TextView banner;
    private LinearLayout settingsPanel;
    private TextView settingsName;
    private LinearLayout pairSection;
    private EditText codeField;
    private final Map<String, TextView> actionChips = new LinkedHashMap<>();
    private LinearLayout chatPanel;
    private LinearLayout chatList;
    private ScrollView chatScroll;
    private View chatUnreadDot;
    private boolean settingsOpen;
    private boolean chatOpen;
    /** Debug (`--ez notouch true`): ignore taps so a preview inspection session cannot anchor. */
    private boolean ignoreTaps;

    // ---- video-demo feature state ----
    private Animalese animalese;
    private boolean voiceMuted;
    private TextView voiceChip;
    private HouseProposal pendingProposal;
    /** Proposal that arrived before the island existed; shown once the anchor is placed. */
    private HouseProposal proposalBeforeAnchor;
    /** True once the island anchor exists (set by the renderer); gates all companion life. */
    private volatile boolean islandPlaced;
    private String voicePendingBeforeAnchor;
    private LinearLayout proposalCard;
    private TextView proposalText;
    private boolean animationsEnabled = true;
    private final Runnable clearProposalRunnable = () -> clearProposal(false);
    /** Debug (`--ez demo true`): local demo island + simulated single-block commits, no Host. */
    private boolean demoMode;
    /** Demo build cells spread across the island corners, so the companion has to walk/hop. */
    private final int[][] demoBuildCells = {
        {-7, 1, -7}, {-7, 1, 6}, {6, 1, 6}, {6, 1, -7},
        {-7, 2, -7}, {6, 2, 6}, {-7, 2, 6}, {6, 2, -7},
    };

    private final Runnable hideBanner = () -> {
        if (banner != null) banner.setVisibility(View.GONE);
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences("fangcun", MODE_PRIVATE);
        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN, android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);

        FrameLayout root = new FrameLayout(this);
        arView = new ArPocView(this, world);
        root.addView(arView, new FrameLayout.LayoutParams(-1, -1));

        previewMode = getIntent().getBooleanExtra("preview", false);
        animationsEnabled = !getIntent().getBooleanExtra("noanim", false);
        arView.setAnimationsEnabled(animationsEnabled);
        arView.setSlowAnimations(getIntent().getBooleanExtra("slowanim", false));
        arView.setDemoAnchor(getIntent().getBooleanExtra("demoAnchor", false));
        arView.setDemoLowAngle(getIntent().getBooleanExtra("demoLow", false));
        animalese = new Animalese();
        if (getIntent().hasExtra("voicePitch")) {
            // Debug tuning hook: e.g. `--ef voicePitch 1.35` changes the animalese base pitch.
            animalese.setPitchScale(getIntent().getFloatExtra("voicePitch", 1f));
        }
        voiceMuted = prefs.getBoolean("voiceMuted", false) || getIntent().getBooleanExtra("mute", false);
        animalese.setMuted(voiceMuted);
        demoMode = getIntent().getBooleanExtra("demo", false)
            || getIntent().getBooleanExtra("demoBuild", false);
        if (demoMode) {
            // Debug: seed a local island and later simulate one-block commits so the drop-in and
            // pop-in animations can be verified without a Host snapshot.
            world.debugSeedIsland();
            arView.markWorldDirty();
            if (getIntent().getBooleanExtra("demoStairs", false)) {
                // Debug: pre-place the seat block so lie/sit-on-stairs can be checked immediately.
                if (world.debugPlace("stairs", 0, 1, 0)) arView.markWorldDirty();
            }
            uiHandler.postDelayed(this::runDemoBuild, 10000L);
        }

        buildStatusArea(root);
        buildBanner(root);
        buildSettingsPanel(root);
        // Explicit manual orientation (fallback for devices whose auto-rotation is unreliable).
        // The activity declares the full configChanges set, so forcing an orientation must not
        // recreate it and must keep the ARCore session alive.
        orientationMode = prefs.getInt("orientationMode", ORIENT_AUTO);
        applyOrientation(false);
        buildChatPanel(root);
        buildFloatingButtons(root);
        buildProposalCard(root);
        buildCoachOverlay(root);
        setContentView(root);

        arView.setOnTouchListener((view, event) -> {
            if (!ignoreTaps && event.getAction() == MotionEvent.ACTION_UP && session != null) {
                arView.queueTap(event.getX(), event.getY());
                return true;
            }
            if (!ignoreTaps && event.getAction() == MotionEvent.ACTION_UP) arView.clearPendingTap();
            return true;
        });

        hostClient = new HostClient(HOST, PORT, "tablet-1", world, new HostClient.Listener() {
            @Override public void onStatus(String text) {
                setHostStatus(text);
            }

            @Override public void onLinkState(int state) {
                runOnUiThread(() -> {
                    linkState = state;
                    updateConnectionDot();
                    updatePairSection();
                });
            }

            @Override public void onWorldLoaded(int rev) {
                worldRev = rev;
                worldBlocks = world.countBlocks();
                paired = true;
                updatePairSection();
                arView.markWorldDirty();
                setHostStatus("World loaded · rev " + rev + " · " + worldBlocks + " blocks");
            }

            @Override public void onCommitApplied(int rev, int[] placedCells) {
                worldRev = rev;
                worldBlocks = world.countBlocks();
                arView.markWorldDirty();
                arView.onBlocksCommitted(placedCells);
                setHostStatus("Synced · rev " + rev + " · " + worldBlocks + " blocks");
            }

            @Override public void onPaired(String token, String worldId) {
                prefs.edit().putString("token", token).putString("worldId", worldId).apply();
                runOnUiThread(() -> {
                    paired = true;
                    updatePairSection();
                });
            }

            @Override public void onCompanionState(String state) {
                arView.setCompanionState(state);
            }

            @Override public void onCompanionSay(String text) {
                showCompanionSpeech(text);
            }

            @Override public void onCompanionAction(String actionId, long expiresAtMs) {
                runOnUiThread(() -> {
                    if (actionId == null || actionId.isEmpty()) return;
                    if (!islandPlaced) return; // no companion life before the island exists
                    if (CompanionActionRegistry.get().find(actionId) == null) return;
                    requestedActionId = actionId;
                    arView.playTimedAction(actionId, expiresAtMs);
                    updateActionChips();
                });
            }

            @Override public void onCompanionProfile(String displayName) {
                runOnUiThread(() -> {
                    // An explicit --es name wins over the Host's persona display name.
                    if (intentCompanionName == null && displayName != null && !displayName.isEmpty()) {
                        setCompanionNameInternal(displayName);
                    }
                });
            }

            @Override public void onBuildProposal(HouseProposal proposal) {
                runOnUiThread(() -> handleBuildProposal(proposal));
            }
        });

        String preset = getIntent().getStringExtra("code");
        if (previewMode) arView.setPreviewMode(true);
        if (getIntent().hasExtra("flipv")) arView.setFlipV(getIntent().getBooleanExtra("flipv", true));
        ignoreTaps = getIntent().getBooleanExtra("notouch", false);
        String pose = getIntent().getStringExtra("pose");
        if (pose != null && !pose.isEmpty()) arView.setForcedPose(pose);
        if (getIntent().hasExtra("posePhase")) arView.setForcedPhase(getIntent().getFloatExtra("posePhase", -1f));
        if (getIntent().hasExtra("liePitch")) {
            CompanionActionRegistry.debugLiePitch = getIntent().getFloatExtra("liePitch", -88f);
        }
        if (getIntent().hasExtra("lieRoll")) {
            CompanionActionRegistry.debugLieRoll = getIntent().getFloatExtra("lieRoll", 180f);
        }
        if (getIntent().hasExtra("lieDrop")) {
            CompanionActionRegistry.debugLieDrop = getIntent().getFloatExtra("lieDrop", -0.90f);
        }
        String debugProposal = getIntent().getStringExtra("proposal");
        if (debugProposal != null && !debugProposal.trim().isEmpty()) {
            // Debug (`--es proposal "x,y,z"`): synthesise a CompanionBuildProposal-shaped object
            // (3x3 footprint from that origin, 24 blocks) and dispatch it through exactly the same
            // handler as an incoming Host frame, so the highlight/card/decide path can be tested
            // without the Host. `--ef proposalTtl <seconds>` overrides the 120 s TTL.
            HouseProposal fake = parseDebugProposal(debugProposal.trim());
            if (fake != null) handleBuildProposal(fake);
        } else if (getIntent().getBooleanExtra("demoProposal", false)) {
            HouseProposal fake = buildDebugProposal(-6, 1, -6);
            if (fake != null) handleBuildProposal(fake);
        }
        String nameExtra = getIntent().getStringExtra("name");
        if (nameExtra != null && !nameExtra.trim().isEmpty()) {
            intentCompanionName = nameExtra.trim();
            setCompanionNameInternal(intentCompanionName);
        } else {
            arView.setCompanionName(companionName);
        }
        String sayExtra = getIntent().getStringExtra("say");
        if (sayExtra != null && !sayExtra.trim().isEmpty()) {
            // Debug (`--es say "..."`): plays one companion line without a Host broadcast, useful
            // for bubble/animalese/mute verification.
            final String line = sayExtra.trim();
            uiHandler.postDelayed(() -> showCompanionSpeech(line), 2600L);
        }

        String savedToken = prefs.getString("token", null);
        String savedWorld = prefs.getString("worldId", null);
        boolean offlineDebug = getIntent().getBooleanExtra("offline", false);
        if (offlineDebug) {
            // Debug (`--ez offline true`): keep the locally seeded demo world, never contact the
            // Host. Used for deterministic animation/pose screenshots.
            paired = false;
            updatePairSection();
            setHostStatus("（调试）离线模式：使用本地演示世界");
        } else if (preset != null && !preset.isEmpty()) {
            codeField.setText(preset);
            paired = true;
            updatePairSection();
            connectToHost();
        } else if (savedToken != null && savedWorld != null) {
            paired = true;
            updatePairSection();
            setHostStatus("Reconnecting with the saved session…");
            hostExecutor.execute(() -> hostClient.connectWithToken(savedToken, savedWorld));
        } else {
            // No credential yet: open settings so the pairing input is right there.
            setSettingsOpen(true);
        }
        renderStatus();
        updateGuidance();
    }

    // ------------------------------------------------------------------------------------
    // Overlay views
    // ------------------------------------------------------------------------------------

    /** Top-left translucent status card (connection dot, revision, block count, action). */
    private void buildStatusArea(FrameLayout root) {
        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(13), dp(10), dp(15), dp(11));
        card.setBackground(rounded(COLOR_CARD, 15, 0x2EFFFFFF, 1));

        LinearLayout titleRow = new LinearLayout(this);
        titleRow.setOrientation(LinearLayout.HORIZONTAL);
        titleRow.setGravity(Gravity.CENTER_VERTICAL);
        connectionDot = new View(this);
        connectionDot.setBackground(circle(COLOR_DOT_IDLE));
        LinearLayout.LayoutParams dotParams = new LinearLayout.LayoutParams(dp(9), dp(9));
        dotParams.rightMargin = dp(8);
        titleRow.addView(connectionDot, dotParams);
        TextView title = new TextView(this);
        title.setText("Fangcun AR");
        title.setTextColor(COLOR_TEXT);
        title.setTextSize(12.5f);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        titleRow.addView(title);
        card.addView(titleRow);

        statusMeta = new TextView(this);
        statusMeta.setTextColor(COLOR_MUTED);
        statusMeta.setTextSize(10.5f);
        LinearLayout.LayoutParams metaParams = new LinearLayout.LayoutParams(-2, -2);
        metaParams.topMargin = dp(4);
        card.addView(statusMeta, metaParams);

        statusAction = new TextView(this);
        statusAction.setTextColor(COLOR_ACCENT);
        statusAction.setTextSize(10.5f);
        LinearLayout.LayoutParams actionParams = new LinearLayout.LayoutParams(-2, -2);
        actionParams.topMargin = dp(2);
        card.addView(statusAction, actionParams);

        container.addView(card);

        // Guidance card: state-driven Chinese next-step hint plus at-a-glance readiness chips.
        LinearLayout guidanceCard = new LinearLayout(this);
        guidanceCard.setOrientation(LinearLayout.VERTICAL);
        guidanceCard.setPadding(dp(13), dp(10), dp(14), dp(10));
        guidanceCard.setBackground(rounded(COLOR_CARD, 14, 0x2EFFFFFF, 1));

        LinearLayout readinessRow = new LinearLayout(this);
        readinessRow.setOrientation(LinearLayout.HORIZONTAL);
        readinessRow.setGravity(Gravity.CENTER_VERTICAL);
        chipTracking = readinessChip("追踪");
        chipPlanes = readinessChip("平面");
        chipPlaced = readinessChip("已放置");
        LinearLayout.LayoutParams chipOne = new LinearLayout.LayoutParams(-2, -2);
        chipOne.rightMargin = dp(6);
        readinessRow.addView(chipTracking, chipOne);
        LinearLayout.LayoutParams chipTwo = new LinearLayout.LayoutParams(-2, -2);
        chipTwo.rightMargin = dp(6);
        readinessRow.addView(chipPlanes, chipTwo);
        readinessRow.addView(chipPlaced);
        guidanceCard.addView(readinessRow);

        guidanceText = new TextView(this);
        guidanceText.setTextColor(COLOR_TEXT);
        guidanceText.setTextSize(12.5f);
        guidanceText.setMaxLines(3);
        guidanceText.setLineSpacing(dp(1), 1f);
        LinearLayout.LayoutParams guidanceParams = new LinearLayout.LayoutParams(-2, -2);
        guidanceParams.topMargin = dp(7);
        guidanceCard.addView(guidanceText, guidanceParams);

        hintText = new TextView(this);
        hintText.setTextColor(COLOR_MUTED);
        hintText.setTextSize(10f);
        hintText.setMaxLines(2);
        LinearLayout.LayoutParams hintParams = new LinearLayout.LayoutParams(-2, -2);
        hintParams.topMargin = dp(4);
        guidanceCard.addView(hintText, hintParams);

        LinearLayout.LayoutParams guidanceCardParams = new LinearLayout.LayoutParams(-2, -2);
        guidanceCardParams.topMargin = dp(8);
        guidanceCardParams.rightMargin = dp(6);
        container.addView(guidanceCard, guidanceCardParams);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-2, -2);
        params.gravity = Gravity.TOP | Gravity.START;
        params.topMargin = dp(12);
        params.leftMargin = dp(12);
        params.rightMargin = dp(72);
        root.addView(container, params);
    }

    private TextView readinessChip(String label) {
        TextView chip = new TextView(this);
        chip.setText(label);
        chip.setTextColor(COLOR_MUTED);
        chip.setTextSize(9.5f);
        chip.setPadding(dp(7), dp(3), dp(7), dp(3));
        chip.setBackground(rounded(0x22FFFFFF, 8));
        return chip;
    }

    private void updateReadinessChip(TextView chip, String label, boolean ok, String detail) {
        if (chip == null) return;
        String suffix = detail != null ? detail : (ok ? "✓" : "—");
        chip.setText(label + " " + suffix);
        chip.setTextColor(ok ? COLOR_DOT_ONLINE : COLOR_MUTED);
        chip.setBackground(rounded(ok ? 0x2A4CAF6E : 0x22FFFFFF, 8));
    }

    /**
     * One-time first-run coach overlay. It is only shown until dismissed and the flag is stored
     * in SharedPreferences, so the default screen stays uncluttered afterwards. The
     * {@code --ez coach true} debug extra forces it for demos/screenshots.
     */
    private void buildCoachOverlay(FrameLayout root) {
        boolean forceCoach = getIntent().getBooleanExtra("coach", false);
        if (!forceCoach && prefs.getBoolean("coachSeen", false)) return;
        FrameLayout overlay = new FrameLayout(this);
        overlay.setBackgroundColor(0xD9000000);
        overlay.setClickable(true);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(22), dp(20), dp(22), dp(18));
        card.setBackground(rounded(0xF2FFF8E7, 20));
        TextView title = new TextView(this);
        title.setText("先学三招");
        title.setTextColor(0xFF4A3625);
        title.setTextSize(17f);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        card.addView(title);
        String[] lines = {
            "① 把平板对准桌面，等提示「已检测到平面」",
            "② 点一下桌面，把小岛放在那里",
            "③ 点岛上的格子盖房子，点列顶拆方块",
        };
        for (int index = 0; index < lines.length; index += 1) {
            TextView line = new TextView(this);
            line.setText(lines[index]);
            line.setTextColor(0xFF5B4632);
            line.setTextSize(13.5f);
            line.setLineSpacing(dp(2), 1f);
            LinearLayout.LayoutParams lineParams = new LinearLayout.LayoutParams(-2, -2);
            lineParams.topMargin = index == 0 ? dp(12) : dp(8);
            card.addView(line, lineParams);
        }
        TextView dismiss = pill("知道了", 0xFF3E6B52, 0xFFEAF7EE);
        dismiss.setOnClickListener(view -> {
            overlay.setVisibility(View.GONE);
            prefs.edit().putBoolean("coachSeen", true).apply();
            updateGuidance();
        });
        LinearLayout.LayoutParams dismissParams = new LinearLayout.LayoutParams(-1, -2);
        dismissParams.topMargin = dp(16);
        card.addView(dismiss, dismissParams);

        FrameLayout.LayoutParams cardParams = new FrameLayout.LayoutParams(dp(310), -2);
        cardParams.gravity = Gravity.CENTER;
        overlay.addView(card, cardParams);

        coachOverlay = overlay;
        root.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
    }

    /** Transient banner for host errors/info that must not live in the compact card. */
    private void buildBanner(FrameLayout root) {
        banner = new TextView(this);
        banner.setTextColor(0xFFFFF3EE);
        banner.setTextSize(11.5f);
        banner.setPadding(dp(14), dp(9), dp(14), dp(9));
        banner.setMaxLines(3);
        banner.setVisibility(View.GONE);
        banner.setBackground(rounded(0xE6A33E36, 12));
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-2, -2);
        params.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        params.topMargin = dp(12);
        root.addView(banner, params);
    }

    /** Small circular buttons; kept at the edges so they never swallow the AR tap. */
    private void buildFloatingButtons(FrameLayout root) {
        TextView gear = circularButton("⚙");
        gear.setOnClickListener(view -> setSettingsOpen(!settingsOpen));
        FrameLayout.LayoutParams gearParams = new FrameLayout.LayoutParams(dp(44), dp(44));
        gearParams.gravity = Gravity.TOP | Gravity.END;
        gearParams.topMargin = dp(12);
        gearParams.rightMargin = dp(12);
        root.addView(gear, gearParams);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.VERTICAL);
        buttons.setGravity(Gravity.CENTER_HORIZONTAL);

        FrameLayout chatWrapper = new FrameLayout(this);
        TextView chatButton = circularButton("💬");
        chatButton.setOnClickListener(view -> setChatOpen(!chatOpen));
        chatWrapper.addView(chatButton, new FrameLayout.LayoutParams(dp(46), dp(46)));
        chatUnreadDot = new View(this);
        chatUnreadDot.setBackground(circle(0xFFFF7B72));
        chatUnreadDot.setVisibility(View.GONE);
        FrameLayout.LayoutParams dotParams = new FrameLayout.LayoutParams(dp(11), dp(11));
        dotParams.gravity = Gravity.TOP | Gravity.END;
        chatWrapper.addView(chatUnreadDot, dotParams);
        LinearLayout.LayoutParams chatParams = new LinearLayout.LayoutParams(dp(46), dp(46));
        chatParams.bottomMargin = dp(10);
        buttons.addView(chatWrapper, chatParams);

        TextView anchorButton = circularButton("⌖");
        anchorButton.setOnClickListener(view -> {
            arView.resetAnchor();
            islandAnchored = false;
            updateGuidance();
            setHostStatus("已清除小岛位置，点一下桌面重新放置。");
        });
        buttons.addView(anchorButton, new LinearLayout.LayoutParams(dp(46), dp(46)));

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-2, -2);
        params.gravity = Gravity.BOTTOM | Gravity.END;
        params.bottomMargin = dp(20);
        params.rightMargin = dp(14);
        root.addView(buttons, params);
    }

    /** Settings: pairing (only when unpaired) plus the action triggers and re-anchor. */
    private void buildSettingsPanel(FrameLayout root) {
        settingsPanel = new LinearLayout(this);
        settingsPanel.setOrientation(LinearLayout.VERTICAL);
        settingsPanel.setPadding(dp(16), dp(13), dp(16), dp(16));
        settingsPanel.setBackground(rounded(0xE616231D, 18, 0x33FFFFFF, 1));
        settingsPanel.setVisibility(View.GONE);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("设置");
        title.setTextColor(COLOR_TEXT);
        title.setTextSize(14f);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView close = pill("✕", 0x22FFFFFF, COLOR_MUTED);
        close.setOnClickListener(view -> setSettingsOpen(false));
        header.addView(close);
        settingsPanel.addView(header);

        settingsName = new TextView(this);
        settingsName.setText("名字 · " + companionName);
        settingsName.setTextColor(COLOR_MUTED);
        settingsName.setTextSize(11f);
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(-2, -2);
        nameParams.topMargin = dp(6);
        settingsPanel.addView(settingsName, nameParams);

        pairSection = new LinearLayout(this);
        pairSection.setOrientation(LinearLayout.VERTICAL);
        LinearLayout.LayoutParams pairParams = new LinearLayout.LayoutParams(-1, -2);
        pairParams.topMargin = dp(12);
        settingsPanel.addView(pairSection, pairParams);

        TextView pairLabel = new TextView(this);
        pairLabel.setText("与 Host 配对");
        pairLabel.setTextColor(COLOR_MUTED);
        pairLabel.setTextSize(11f);
        pairSection.addView(pairLabel);

        LinearLayout pairRow = new LinearLayout(this);
        pairRow.setOrientation(LinearLayout.HORIZONTAL);
        pairRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams pairRowParams = new LinearLayout.LayoutParams(-1, -2);
        pairRowParams.topMargin = dp(6);
        pairSection.addView(pairRow, pairRowParams);

        codeField = new EditText(this);
        codeField.setHint("配对码");
        codeField.setTextColor(Color.WHITE);
        codeField.setHintTextColor(0xFF8FA39B);
        codeField.setTextSize(14f);
        codeField.setSingleLine(true);
        codeField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        codeField.setFilters(new InputFilter[]{new InputFilter.LengthFilter(12)});
        codeField.setBackground(rounded(0x33FFFFFF, 10));
        codeField.setPadding(dp(12), dp(8), dp(12), dp(8));
        pairRow.addView(codeField, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView connect = pill("连接", 0xFF3E6B52, 0xFFEAF7EE);
        connect.setOnClickListener(view -> connectToHost());
        LinearLayout.LayoutParams connectParams = new LinearLayout.LayoutParams(-2, -2);
        connectParams.leftMargin = dp(8);
        pairRow.addView(connect, connectParams);

        TextView reanchor = pill("重新锚定", 0x22FFFFFF, 0xFFDCE8E1);
        reanchor.setOnClickListener(view -> {
            arView.resetAnchor();
            islandAnchored = false;
            updateGuidance();
            setSettingsOpen(false);
            setHostStatus("已清除小岛位置，点一下桌面重新放置。");
        });
        LinearLayout.LayoutParams reanchorParams = new LinearLayout.LayoutParams(-1, -2);
        reanchorParams.topMargin = dp(12);
        settingsPanel.addView(reanchor, reanchorParams);

        // Animalese voice toggle (default ON; persisted in SharedPreferences).
        LinearLayout voiceRow = new LinearLayout(this);
        voiceRow.setOrientation(LinearLayout.HORIZONTAL);
        voiceRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams voiceRowParams = new LinearLayout.LayoutParams(-1, -2);
        voiceRowParams.topMargin = dp(10);
        settingsPanel.addView(voiceRow, voiceRowParams);
        TextView voiceLabel = new TextView(this);
        voiceLabel.setText("兽语配音");
        voiceLabel.setTextColor(COLOR_MUTED);
        voiceLabel.setTextSize(11f);
        voiceRow.addView(voiceLabel, new LinearLayout.LayoutParams(0, -2, 1f));
        voiceChip = pill("开", 0xFF3E6B52, 0xFFEAF7EE);
        voiceChip.setOnClickListener(view -> setVoiceMuted(!voiceMuted));
        voiceRow.addView(voiceChip);
        updateVoiceChip();

        // Screen orientation fallback: follow system / force landscape / force portrait.
        LinearLayout orientationRow = new LinearLayout(this);
        orientationRow.setOrientation(LinearLayout.HORIZONTAL);
        orientationRow.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout.LayoutParams orientationRowParams = new LinearLayout.LayoutParams(-1, -2);
        orientationRowParams.topMargin = dp(10);
        settingsPanel.addView(orientationRow, orientationRowParams);
        TextView orientationLabel = new TextView(this);
        orientationLabel.setText("屏幕方向");
        orientationLabel.setTextColor(COLOR_MUTED);
        orientationLabel.setTextSize(11f);
        orientationRow.addView(orientationLabel, new LinearLayout.LayoutParams(0, -2, 1f));
        orientationChip = pill("跟随系统", 0x22FFFFFF, COLOR_TEXT);
        orientationChip.setOnClickListener(view -> {
            orientationMode = (orientationMode + 1) % 3;
            applyOrientation(true);
        });
        orientationRow.addView(orientationChip);
        updateOrientationChip();

        TextView actionsLabel = new TextView(this);
        actionsLabel.setText("动作");
        actionsLabel.setTextColor(COLOR_MUTED);
        actionsLabel.setTextSize(11f);
        LinearLayout.LayoutParams actionsLabelParams = new LinearLayout.LayoutParams(-2, -2);
        actionsLabelParams.topMargin = dp(14);
        settingsPanel.addView(actionsLabel, actionsLabelParams);

        CompanionActionRegistry registry = CompanionActionRegistry.get();
        String[] ids = registry.publicActionIds();
        String[] labels = registry.publicActionLabels();
        LinearLayout row = null;
        for (int index = 0; index < ids.length; index += 1) {
            if (index % 4 == 0) {
                row = new LinearLayout(this);
                row.setOrientation(LinearLayout.HORIZONTAL);
                LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(-1, -2);
                rowParams.topMargin = dp(6);
                settingsPanel.addView(row, rowParams);
            }
            TextView chip = actionChip(labels[index], ids[index]);
            LinearLayout.LayoutParams chipParams = new LinearLayout.LayoutParams(0, -2, 1f);
            chipParams.rightMargin = index % 4 == 3 ? 0 : dp(6);
            row.addView(chip, chipParams);
            actionChips.put(ids[index], chip);
        }

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(318), -2);
        params.gravity = Gravity.TOP | Gravity.END;
        params.topMargin = dp(64);
        params.rightMargin = dp(12);
        root.addView(settingsPanel, params);
        updateActionChips();
        updatePairSection();
    }

    /** Chat history: last few lines in a small scrollable card above the buttons. */
    private void buildChatPanel(FrameLayout root) {
        chatPanel = new LinearLayout(this);
        chatPanel.setOrientation(LinearLayout.VERTICAL);
        chatPanel.setPadding(dp(14), dp(11), dp(14), dp(12));
        chatPanel.setBackground(rounded(0xE616231D, 16, 0x33FFFFFF, 1));
        chatPanel.setVisibility(View.GONE);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("对话记录");
        title.setTextColor(COLOR_TEXT);
        title.setTextSize(12.5f);
        title.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView close = pill("✕", 0x22FFFFFF, COLOR_MUTED);
        close.setOnClickListener(view -> setChatOpen(false));
        header.addView(close);
        chatPanel.addView(header);

        chatScroll = new ScrollView(this);
        chatScroll.setVerticalScrollBarEnabled(true);
        chatList = new LinearLayout(this);
        chatList.setOrientation(LinearLayout.VERTICAL);
        chatScroll.addView(chatList, new ViewGroup.LayoutParams(-1, -2));
        LinearLayout.LayoutParams scrollParams = new LinearLayout.LayoutParams(-1, dp(176));
        scrollParams.topMargin = dp(8);
        chatPanel.addView(chatScroll, scrollParams);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(300), -2);
        params.gravity = Gravity.BOTTOM | Gravity.END;
        params.bottomMargin = dp(136);
        params.rightMargin = dp(14);
        root.addView(chatPanel, params);
    }

    // ------------------------------------------------------------------------------------
    // UI state
    // ------------------------------------------------------------------------------------

    /**
     * Compact "may I build here?" card for a pending house proposal. Non-clickable except for its
     * two buttons, so it does not swallow AR taps.
     */
    private void buildProposalCard(FrameLayout root) {
        proposalCard = new LinearLayout(this);
        proposalCard.setOrientation(LinearLayout.VERTICAL);
        proposalCard.setPadding(dp(15), dp(12), dp(15), dp(13));
        proposalCard.setBackground(rounded(0xF02E2513, 16, 0xCCFFB74A, 1));
        proposalCard.setVisibility(View.GONE);

        proposalText = new TextView(this);
        proposalText.setTextColor(0xFFFFF3D6);
        proposalText.setTextSize(12.5f);
        proposalText.setLineSpacing(dp(1), 1f);
        proposalCard.addView(proposalText);

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams buttonsParams = new LinearLayout.LayoutParams(-1, -2);
        buttonsParams.topMargin = dp(10);
        proposalCard.addView(buttons, buttonsParams);
        TextView approve = pill("好呀", 0xFF3E6B52, 0xFFEAF7EE);
        approve.setOnClickListener(view -> decideProposal(true));
        buttons.addView(approve, new LinearLayout.LayoutParams(0, -2, 1f));
        TextView reject = pill("先不要", 0x33FFFFFF, 0xFFDCE8E1);
        reject.setOnClickListener(view -> decideProposal(false));
        LinearLayout.LayoutParams rejectParams = new LinearLayout.LayoutParams(0, -2, 1f);
        rejectParams.leftMargin = dp(8);
        buttons.addView(reject, rejectParams);

        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(dp(300), -2);
        params.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        params.bottomMargin = dp(120);
        root.addView(proposalCard, params);
    }

    /** Shows the highlight + prompt card for a Host proposal (or the debug fake one). */
    private void showProposal(HouseProposal proposal) {
        if (proposal == null) return;
        pendingProposal = proposal;
        android.util.Log.i("HouseProposal", "shown id=" + proposal.proposalId
            + " blocks=" + proposal.blockCount + " debug=" + proposal.debug
            + " ttlMs=" + (proposal.expiresAtMs - System.currentTimeMillis()));
        if (proposalCard == null) return;
        proposalText.setText("小鱼想在这里盖一间小房子（" + proposal.blockCount + " 块），可以吗？");
        proposalCard.setVisibility(View.VISIBLE);
        arView.setProposal(proposal);
        uiHandler.removeCallbacks(clearProposalRunnable);
        long delay = proposal.expiresAtMs > 0L
            ? Math.max(1200L, proposal.expiresAtMs - System.currentTimeMillis() - 300L)
            : 120000L;
        uiHandler.postDelayed(clearProposalRunnable, delay);
    }

    /** Same entry point as an incoming {@code companion_build_proposal} Host frame. */
    private void handleBuildProposal(HouseProposal proposal) {
        if (proposal == null) return;
        if (proposal.expired(System.currentTimeMillis())) {
            onProposalExpired();
            return;
        }
        if (!islandPlaced) {
            // No island yet: hold the proposal quietly, do not show highlight/card.
            proposalBeforeAnchor = proposal;
            return;
        }
        showProposal(proposal);
    }

    /** Parses `--es proposal` either as an origin "x,y,z" or the legacy full-bounds form. */
    private HouseProposal parseDebugProposal(String raw) {
        try {
            String[] parts = raw.split(",");
            if (parts.length >= 7) {
                return new HouseProposal("debug-proposal",
                    Integer.parseInt(parts[0].trim()), Integer.parseInt(parts[1].trim()), Integer.parseInt(parts[2].trim()),
                    Integer.parseInt(parts[3].trim()), Integer.parseInt(parts[4].trim()), Integer.parseInt(parts[5].trim()),
                    Integer.parseInt(parts[6].trim()), System.currentTimeMillis() + 180000L, true);
            }
            if (parts.length >= 3) {
                return buildDebugProposal(Integer.parseInt(parts[0].trim()),
                    Integer.parseInt(parts[1].trim()), Integer.parseInt(parts[2].trim()));
            }
        } catch (RuntimeException ignored) {
            // Malformed debug extra: ignore.
        }
        return null;
    }

    /** CompanionBuildProposal-shaped debug object: 3x3 footprint, 24 blocks, now + TTL. */
    private HouseProposal buildDebugProposal(int originX, int originY, int originZ) {
        float ttlSeconds = getIntent().getFloatExtra("proposalTtl", 120f);
        long expiresAtMs = System.currentTimeMillis() + (long) (Math.max(2f, ttlSeconds) * 1000f);
        return new HouseProposal("debug-proposal", originX, originY, originZ,
            originX + 3, originY + 3, originZ + 3, 24, expiresAtMs, true);
    }

    /** Clears the highlight/card. {@code decided} is unused today but keeps the call sites clear. */
    private void clearProposal(boolean decided) {
        if (pendingProposal != null) {
            android.util.Log.i("HouseProposal", "cleared id=" + pendingProposal.proposalId
                + " decided=" + decided);
        }
        pendingProposal = null;
        uiHandler.removeCallbacks(clearProposalRunnable);
        if (proposalCard != null) proposalCard.setVisibility(View.GONE);
        if (arView != null) arView.clearProposal();
    }

    /** Posts the decision to the Host ({@code approve=true|false}) and clears the highlight. */
    private void decideProposal(boolean approve) {
        HouseProposal proposal = pendingProposal;
        if (proposal == null) return;
        clearProposal(true);
        android.util.Log.i("HouseDecide", "decision approve=" + approve
            + " proposalId=" + proposal.proposalId + " debug=" + proposal.debug);
        hostExecutor.execute(() -> {
            boolean ok = hostClient.decideHouseProposal(proposal.proposalId, approve);
            runOnUiThread(() -> {
                if (ok) {
                    showTransient(approve ? "已同意：小鱼开始盖房子啦" : "已回复：这次先不盖", false);
                } else {
                    showTransient("提案处理失败，请稍后再试", true);
                }
            });
        });
    }

    /** Called from the GL thread when the user taps inside the highlighted footprint. */
    void onProposalAreaTapped() {
        runOnUiThread(() -> decideProposal(true));
    }

    /** Called from the GL thread when a proposal expired without a decision. */
    void onProposalExpired() {
        runOnUiThread(() -> {
            if (pendingProposal != null) {
                android.util.Log.i("HouseProposal", "expired id=" + pendingProposal.proposalId);
                clearProposal(false);
                showTransient("盖房子的提案已过期", false);
            }
        });
    }

    /** Debug (`--ez demo true`): places local demo blocks one at a time with 700 ms gaps. */
    private void runDemoBuild() {
        arView.setCompanionState("building");
        for (int index = 0; index < demoBuildCells.length; index += 1) {
            final int cell = index;
            uiHandler.postDelayed(() -> {
                int[] target = demoBuildCells[cell];
                if (world.debugPlace("planks", target[0], target[1], target[2])) {
                    arView.markWorldDirty();
                    arView.onBlocksCommitted(new int[]{target[0], target[1], target[2]});
                    setHostStatus("（调试）第 " + (cell + 1) + " 块方块落下");
                }
            }, index * 700L);
        }
        // Finish the debug build like the Host does: place a stairs seat, then sit + speak.
        uiHandler.postDelayed(() -> {
            arView.setCompanionState("idle");
            if (world.debugPlace("stairs", 0, 1, 0)) {
                arView.markWorldDirty();
                arView.onBlocksCommitted(new int[]{0, 1, 0});
            }
            arView.setAction("sit");
            arView.setCompanionSay("房子盖好啦，我先坐一会儿~");
            setHostStatus("（调试）坐在楼梯座上并显示表情");
        }, demoBuildCells.length * 700L + 900L);
    }

    private void setVoiceMuted(boolean muted) {
        voiceMuted = muted;
        prefs.edit().putBoolean("voiceMuted", muted).apply();
        animalese.setMuted(muted);
        updateVoiceChip();
    }

    private void updateVoiceChip() {
        if (voiceChip == null) return;
        voiceChip.setText(voiceMuted ? "关" : "开");
        voiceChip.setBackground(rounded(voiceMuted ? 0x22FFFFFF : 0xFF3E6B52, 11));
        voiceChip.setTextColor(voiceMuted ? COLOR_MUTED : 0xFFEAF7EE);
    }

    // ---- manual screen orientation (fallback for unreliable auto-rotation) --------------------
    private static final int ORIENT_AUTO = 0;
    private static final int ORIENT_LANDSCAPE = 1;
    private static final int ORIENT_PORTRAIT = 2;
    private int orientationMode = ORIENT_AUTO;
    private TextView orientationChip;

    /** Applies the saved orientation choice; persist=true also stores it. */
    private void applyOrientation(boolean persist) {
        if (persist) prefs.edit().putInt("orientationMode", orientationMode).apply();
        int requested = orientationMode == ORIENT_LANDSCAPE
            ? ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            : orientationMode == ORIENT_PORTRAIT
                ? ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        setRequestedOrientation(requested);
        updateOrientationChip();
    }

    private void updateOrientationChip() {
        if (orientationChip == null) return;
        String label = orientationMode == ORIENT_LANDSCAPE ? "强制横屏"
            : orientationMode == ORIENT_PORTRAIT ? "强制竖屏" : "跟随系统";
        orientationChip.setText(label);
        boolean forced = orientationMode != ORIENT_AUTO;
        orientationChip.setBackground(rounded(forced ? 0xFF3E6B52 : 0x22FFFFFF, 11));
        orientationChip.setTextColor(forced ? 0xFFEAF7EE : COLOR_TEXT);
    }

    private void setSettingsOpen(boolean open) {
        settingsOpen = open;
        if (settingsPanel != null) settingsPanel.setVisibility(open ? View.VISIBLE : View.GONE);
    }

    private void setChatOpen(boolean open) {
        chatOpen = open;
        if (chatPanel != null) chatPanel.setVisibility(open ? View.VISIBLE : View.GONE);
        if (open) {
            setChatUnread(false);
            rebuildChatHistory();
        }
    }

    private void setChatUnread(boolean unread) {
        if (chatUnreadDot != null) chatUnreadDot.setVisibility(unread ? View.VISIBLE : View.GONE);
    }

    private void updateConnectionDot() {
        if (connectionDot == null) return;
        int color;
        switch (linkState) {
            case HostClient.LINK_ONLINE: color = COLOR_DOT_ONLINE; break;
            case HostClient.LINK_CONNECTING: color = COLOR_DOT_CONNECTING; break;
            case HostClient.LINK_OFFLINE: color = COLOR_DOT_OFFLINE; break;
            default: color = COLOR_DOT_IDLE; break;
        }
        connectionDot.setBackground(circle(color));
    }

    private void updatePairSection() {
        if (pairSection == null) return;
        // Hide the pairing input only when a saved credential is actually online; a stale token
        // left over from before a Host restart must reopen it instead of hiding the only way in.
        boolean connected = paired && linkState == HostClient.LINK_ONLINE;
        pairSection.setVisibility(connected ? View.GONE : View.VISIBLE);
    }

    private void updateActionChips() {
        for (Map.Entry<String, TextView> entry : actionChips.entrySet()) {
            boolean selected = entry.getKey().equals(requestedActionId);
            entry.getValue().setBackground(rounded(selected ? 0xFF3E6B52 : 0x22FFFFFF, 10));
            entry.getValue().setTextColor(selected ? 0xFFEAF7EE : 0xFFD9E5DF);
        }
    }

    private void rebuildChatHistory() {
        if (chatList == null) return;
        chatList.removeAllViews();
        if (chatHistory.isEmpty()) {
            TextView empty = new TextView(this);
            empty.setText("还没有对白。等 Host 让小伙伴开口吧。");
            empty.setTextColor(COLOR_MUTED);
            empty.setTextSize(11f);
            empty.setPadding(dp(2), dp(6), dp(2), dp(6));
            chatList.addView(empty);
        } else {
            for (String line : chatHistory) {
                TextView row = new TextView(this);
                row.setText(companionName + "：" + line);
                row.setTextColor(0xFFE9F2EC);
                row.setTextSize(11.5f);
                row.setLineSpacing(dp(1), 1f);
                row.setPadding(dp(2), dp(5), dp(2), dp(5));
                chatList.addView(row);
            }
        }
        if (chatScroll != null) chatScroll.post(() -> chatScroll.fullScroll(View.FOCUS_DOWN));
    }

    private void appendChatLine(String text) {
        chatHistory.addLast(text);
        while (chatHistory.size() > CHAT_HISTORY_LIMIT) chatHistory.removeFirst();
        if (chatOpen) {
            rebuildChatHistory();
        } else {
            setChatUnread(true);
        }
    }

    /** Companion dialogue is the 3D bubble; this records it and plays the animalese voice. */
    private void showCompanionSpeech(String text) {
        if (text == null || text.isEmpty()) return;
        runOnUiThread(() -> {
            appendChatLine(text);
            if (!islandPlaced) {
                // No island yet: keep the text in the chat panel only and drop the voice; do not
                // queue it, the drop-in animation must be the first interaction the user sees.
                return;
            }
            arView.setCompanionSay(text);
            if (!voiceMuted) animalese.speak(text);
        });
    }

    /** Renderer callback (GL thread): the island anchor was placed or lost. */
    void setIslandPlaced(boolean placed) {
        islandPlaced = placed;
        if (placed) {
            runOnUiThread(() -> {
                HouseProposal pending = proposalBeforeAnchor;
                if (pending != null) {
                    proposalBeforeAnchor = null;
                    showProposal(pending);
                }
                if (!voiceMuted && voicePendingBeforeAnchor != null) {
                    // Voice was suppressed before the island existed; drop it rather than replay.
                    voicePendingBeforeAnchor = null;
                }
            });
        }
    }

    private void showTransient(String text, boolean error) {
        if (text == null || text.isEmpty()) return;
        runOnUiThread(() -> {
            banner.setText(text);
            banner.setBackground(rounded(error ? 0xE6A33E36 : 0xE622352C, 12));
            banner.setVisibility(View.VISIBLE);
            uiHandler.removeCallbacks(hideBanner);
            uiHandler.postDelayed(hideBanner, 4200);
        });
    }

    private void renderStatus() {
        runOnUiThread(() -> {
            if (statusMeta == null) return;
            statusMeta.setText("rev " + (worldRev >= 0 ? String.valueOf(worldRev) : "—")
                + " · " + worldBlocks + " blocks");
            statusAction.setText("动作 · " + currentActionId);
            hintText.setText(arStatus);
            updateConnectionDot();
        });
    }

    private void setCompanionNameInternal(String name) {
        if (name == null || name.trim().isEmpty()) return;
        companionName = name.trim();
        if (settingsName != null) settingsName.setText("名字 · " + companionName);
        if (arView != null) arView.setCompanionName(companionName);
        if (chatOpen) rebuildChatHistory();
    }

    // ------------------------------------------------------------------------------------
    // AR guidance state
    // ------------------------------------------------------------------------------------

    /**
     * Composes the single Chinese guidance line from the current AR state, so the user always
     * knows the next action and its precondition (permission, AR ready, tracking, plane, anchored).
     */
    private void updateGuidance() {
        if (guidanceText == null) return;
        String text;
        if (previewMode) {
            text = "预览模式：点屏幕不会放置小岛（调试用，仅检查姿势与模型）";
        } else if (cameraPermissionDenied) {
            text = "需要相机权限才能放置小岛，请允许后重试";
        } else if (!arReady) {
            text = arError != null ? arError : "正在准备 AR，请稍候…";
        } else if (!arTracking) {
            text = "追踪已丢失：把平板对准桌面并缓慢移动，恢复后再操作";
        } else if (!islandAnchored && arPlaneCount <= 0) {
            text = "把平板对准桌面或地板，缓慢左右移动，直到提示「已检测到平面」（当前平面数 "
                + Math.max(arPlaneCount, 0) + "）";
        } else if (!islandAnchored) {
            text = "已检测到平面：点一下桌面就能把小岛放在那里";
        } else {
            text = "建造模式：点岛上的格子放方块；点同一列顶部会拆掉方块；想移动小岛请点右下角「⌖」";
        }
        guidanceText.setText(text);
        updateReadinessChip(chipTracking, "追踪", arTracking, null);
        updateReadinessChip(chipPlanes, "平面", islandAnchored || arPlaneCount > 0,
            islandAnchored ? "✓" : (arPlaneCount >= 0 ? String.valueOf(arPlaneCount) : null));
        updateReadinessChip(chipPlaced, "已放置", islandAnchored, null);
    }

    /** Called from the GL thread ~5x/s with the ARCore readiness the guidance text needs. */
    void onArTrackingState(boolean tracking, int planeCount, boolean anchored) {
        runOnUiThread(() -> {
            arReady = true;
            arTracking = tracking;
            arPlaneCount = planeCount;
            islandAnchored = anchored;
            updateGuidance();
        });
    }

    /** Red transient feedback for a failed tap/anchor (does not steal AR taps). */
    void showArFeedback(String text) {
        showTransient(text, true);
    }

    /** Green-ish transient feedback for a successful action. */
    void showArNotice(String text) {
        showTransient(text, false);
    }

    // ------------------------------------------------------------------------------------
    // Small view factories
    // ------------------------------------------------------------------------------------

    private int dp(float value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable rounded(int color, float radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private GradientDrawable rounded(int color, float radiusDp, int strokeColor, float strokeDp) {
        GradientDrawable drawable = rounded(color, radiusDp);
        drawable.setStroke(Math.max(1, dp(strokeDp)), strokeColor);
        return drawable;
    }

    private GradientDrawable circle(int color) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setShape(GradientDrawable.OVAL);
        drawable.setColor(color);
        return drawable;
    }

    private TextView circularButton(String glyph) {
        TextView button = new TextView(this);
        button.setText(glyph);
        button.setTextColor(COLOR_TEXT);
        button.setTextSize(19f);
        button.setGravity(Gravity.CENTER);
        button.setBackground(rounded(0xCC141F1A, 23, 0x33FFFFFF, 1));
        return button;
    }

    private TextView pill(String label, int backgroundColor, int textColor) {
        TextView view = new TextView(this);
        view.setText(label);
        view.setTextColor(textColor);
        view.setTextSize(12f);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(14), dp(8), dp(14), dp(8));
        view.setBackground(rounded(backgroundColor, 11));
        view.setClickable(true);
        return view;
    }

    private TextView actionChip(String label, String actionId) {
        TextView chip = pill(label, 0x22FFFFFF, 0xFFD9E5DF);
        chip.setTextSize(11.5f);
        chip.setPadding(dp(4), dp(7), dp(4), dp(7));
        chip.setOnClickListener(view -> applyAction(actionId));
        return chip;
    }

    // ------------------------------------------------------------------------------------
    // Public seam for the Host/PC side
    // ------------------------------------------------------------------------------------

    /** Triggers one of {@link #getAvailableActions()}; {@code auto} resumes the idle cycle. */
    public void setAction(String id) {
        runOnUiThread(() -> applyAction(id));
    }

    /** Action ids the Host/PC inspector can offer and trigger. */
    public String[] getAvailableActions() {
        return CompanionActionRegistry.get().publicActionIds();
    }

    private void applyAction(String id) {
        if (id == null || id.isEmpty()) return;
        if (!CompanionActionRegistry.AUTO.equals(id) && CompanionActionRegistry.get().find(id) == null) return;
        requestedActionId = id;
        arView.setAction(id);
        updateActionChips();
    }

    private void connectToHost() {
        String code = codeField.getText().toString().trim();
        if (code.isEmpty()) {
            setHostStatus("请先输入 Host 打印的配对码。");
            setSettingsOpen(true);
            return;
        }
        setHostStatus("正在配对…");
        hostExecutor.execute(() -> hostClient.connect(code));
    }

    /** Invoked from the GL thread when a tap resolved to a world column. */
    void onColumnTapped(int x, int z) {
        setHostStatus("正在发送建造指令 x=" + x + " z=" + z + "…");
        hostExecutor.execute(() -> hostClient.editColumn(x, z));
    }

    /** Invoked from the GL thread when the data-driven action changes. */
    void onCompanionActionChanged(String actionId) {
        runOnUiThread(() -> {
            currentActionId = actionId;
            if (statusAction != null) statusAction.setText("动作 · " + currentActionId);
        });
    }

    // ------------------------------------------------------------------------------------
    // AR session lifecycle (unchanged)
    // ------------------------------------------------------------------------------------

    @Override
    protected void onResume() {
        super.onResume();
        if (animalese != null) animalese.setPaused(false);
        if (ensureCameraPermission()) return;
        try {
            if (session == null) {
                ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(this);
                if (availability.isTransient()) {
                    arError = "正在检测 AR 能力，请稍候…";
                    setArStatus("正在检测 ARCore 是否可用…");
                    arView.requestRender();
                    updateGuidance();
                    return;
                }
                if (!availability.isSupported()) {
                    arError = "这台设备不支持 ARCore，无法放置小岛";
                    setArStatus("这台设备不支持 ARCore，无法启动 AR 会话。");
                    updateGuidance();
                    return;
                }
                ArCoreApk.InstallStatus installStatus = ArCoreApk.getInstance().requestInstall(this, !installRequested);
                if (installStatus == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    installRequested = true;
                    arError = "正在安装/更新 Google Play 服务（AR），完成后会自动继续";
                    setArStatus("正在安装 Google Play 服务（AR）…");
                    updateGuidance();
                    return;
                }
                session = new Session(this);
                Config config = session.getConfig();
                config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);
                session.configure(config);
            }
            // Start the GL surface first; the camera texture is attached only after GL is ready.
            arError = null;
            arView.onResume();
            arView.setSession(session);
            session.resume();
            setArStatus("ARCore 就绪。把平板对准桌面，缓慢移动以检测平面。");
            updateGuidance();
        } catch (UnavailableArcoreNotInstalledException | UnavailableApkTooOldException
                 | UnavailableSdkTooOldException | UnavailableUserDeclinedInstallationException e) {
            arError = "ARCore 不可用：缺少或版本不匹配，请安装 Google Play 服务（AR）后重试";
            setArStatus("ARCore 不可用：" + e.getClass().getSimpleName());
            updateGuidance();
        } catch (Exception e) {
            arError = "AR 启动失败，请重启应用再试";
            setArStatus("AR 会话启动失败：" + e.getClass().getSimpleName());
            updateGuidance();
        }
    }

    private boolean ensureCameraPermission() {
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            cameraPermissionDenied = false;
            return false;
        }
        cameraPermissionDenied = true;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        setArStatus("需要相机权限才能使用 ARCore。");
        updateGuidance();
        return true;
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Never play animalese while the app is paused.
        if (animalese != null) animalese.setPaused(true);
        if (session != null) session.pause();
        arView.onPause();
    }

    @Override
    protected void onDestroy() {
        hostClient.disconnect();
        hostExecutor.shutdownNow();
        uiHandler.removeCallbacksAndMessages(null);
        if (animalese != null) animalese.release();
        if (session != null) session.close();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            cameraPermissionDenied = !granted;
            if (!granted) setArStatus("相机权限被拒绝，AR 功能不可用。");
            updateGuidance();
        }
    }

    Session currentSession() { return session; }

    void setArStatus(String value) {
        arStatus = value;
        renderStatus();
    }

    void setHostStatus(String value) {
        runOnUiThread(() -> {
            hostStatus = value;
            boolean duplicate = value != null
                && (value.startsWith("World loaded") || value.startsWith("Synced")
                    || value.startsWith("Sending edit") || value.startsWith("正在发送建造指令"));
            if (!duplicate) {
                boolean error = value != null && (value.contains("failed") || value.contains("Failed")
                    || value.contains("rejected") || value.contains("closed") || value.contains("error")
                    || value.contains("Error") || value.contains("Not connected") || value.contains("unauthorized"));
                showTransient(value, error);
                if (value != null && (value.contains("Pairing failed") || value.contains("unauthorized"))) {
                    paired = false;
                    updatePairSection();
                }
            }
        });
    }
}
