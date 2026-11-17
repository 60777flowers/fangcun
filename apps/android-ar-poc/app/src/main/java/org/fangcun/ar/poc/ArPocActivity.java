package org.fangcun.ar.poc;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.MotionEvent;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;

import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import com.google.ar.core.exceptions.UnavailableArcoreNotInstalledException;
import com.google.ar.core.exceptions.UnavailableApkTooOldException;
import com.google.ar.core.exceptions.UnavailableSdkTooOldException;
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native AR client slice for Fangcun.
 *
 * Renders the Host's authoritative voxel world at a tabletop anchor and forwards taps as
 * world intents. Transport is the loopback Host reached through `adb reverse`; LAN TLS,
 * certificate pinning and QR pairing are the next hardening step, not implemented here.
 */
public final class ArPocActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 100;
    private static final String HOST = "127.0.0.1";
    private static final int PORT = 8765;

    private volatile Session session;
    private ArPocView arView;
    private TextView status;
    private EditText codeField;
    private boolean installRequested;

    private final VoxelWorld world = new VoxelWorld();
    private final ExecutorService hostExecutor = Executors.newSingleThreadExecutor();
    private HostClient hostClient;
    private String arStatus = "Starting…";
    private String hostStatus = "Not connected";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN, android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);

        FrameLayout root = new FrameLayout(this);
        arView = new ArPocView(this, world);
        root.addView(arView, new FrameLayout.LayoutParams(-1, -1));

        status = new TextView(this);
        status.setTextColor(0xffffffff);
        status.setTextSize(13);
        status.setPadding(24, 20, 24, 20);
        status.setBackgroundColor(0x990f1915);
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(-2, -2);
        statusParams.topMargin = 28;
        statusParams.leftMargin = 18;
        statusParams.rightMargin = 18;
        root.addView(status, statusParams);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(18, 14, 18, 18);
        bar.setBackgroundColor(0xcc0f1915);
        bar.setGravity(Gravity.CENTER_VERTICAL);

        codeField = new EditText(this);
        codeField.setHint("pairing code");
        codeField.setTextColor(Color.WHITE);
        codeField.setHintTextColor(0xff8fa39b);
        codeField.setTextSize(16);
        codeField.setSingleLine(true);
        codeField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);
        codeField.setFilters(new InputFilter[]{new InputFilter.LengthFilter(12)});
        bar.addView(codeField, new LinearLayout.LayoutParams(0, -2, 1f));

        Button connect = new Button(this);
        connect.setText("Connect");
        connect.setOnClickListener(view -> connectToHost());
        bar.addView(connect);

        Button anchor = new Button(this);
        anchor.setText("Re-anchor");
        anchor.setOnClickListener(view -> {
            arView.resetAnchor();
            setHostStatus("Anchor cleared — tap the table to re-anchor.");
        });
        bar.addView(anchor);

        FrameLayout.LayoutParams barParams = new FrameLayout.LayoutParams(-1, -2);
        barParams.gravity = Gravity.BOTTOM;
        root.addView(bar, barParams);
        setContentView(root);

        arView.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP && session != null) {
                arView.queueTap(event.getX(), event.getY());
                return true;
            }
            if (event.getAction() == MotionEvent.ACTION_UP) arView.clearPendingTap();
            return true;
        });

        hostClient = new HostClient(HOST, PORT, "tablet-1", world, new HostClient.Listener() {
            @Override public void onStatus(String text) {
                setHostStatus(text);
            }

            @Override public void onWorldLoaded(int rev) {
                arView.markWorldDirty();
                setHostStatus("World loaded · rev " + rev + " · " + world.countBlocks() + " blocks");
            }

            @Override public void onCommitApplied(int rev) {
                arView.markWorldDirty();
                setHostStatus("Synced · rev " + rev + " · " + world.countBlocks() + " blocks");
            }
        });

        String preset = getIntent().getStringExtra("code");
        if (preset != null && !preset.isEmpty()) {
            codeField.setText(preset);
            connectToHost();
        }
        renderStatus();
    }

    private void connectToHost() {
        String code = codeField.getText().toString().trim();
        if (code.isEmpty()) {
            setHostStatus("Enter the pairing code printed by `npm run host`.");
            return;
        }
        setHostStatus("Pairing…");
        hostExecutor.execute(() -> hostClient.connect(code));
    }

    /** Invoked from the GL thread when a tap resolved to a world column. */
    void onColumnTapped(int x, int z) {
        setHostStatus("Sending edit for column x=" + x + " z=" + z + "…");
        hostExecutor.execute(() -> hostClient.editColumn(x, z));
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ensureCameraPermission()) return;
        try {
            if (session == null) {
                ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(this);
                if (availability.isTransient()) {
                    setArStatus("ARCore availability is still being checked…");
                    arView.requestRender();
                    return;
                }
                if (!availability.isSupported()) {
                    setArStatus("ARCore unsupported on this device.\nNo AR session started.");
                    return;
                }
                ArCoreApk.InstallStatus installStatus = ArCoreApk.getInstance().requestInstall(this, !installRequested);
                if (installStatus == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    installRequested = true;
                    setArStatus("Installing or updating Google Play Services for AR…");
                    return;
                }
                session = new Session(this);
                Config config = session.getConfig();
                config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);
                session.configure(config);
            }
            // Start the GL surface first; the camera texture is attached only after GL is ready.
            arView.onResume();
            arView.setSession(session);
            session.resume();
            setArStatus("ARCore ready. Move over a tabletop and tap to anchor the island.");
        } catch (UnavailableArcoreNotInstalledException | UnavailableApkTooOldException
                 | UnavailableSdkTooOldException | UnavailableUserDeclinedInstallationException e) {
            setArStatus("ARCore unavailable: " + e.getClass().getSimpleName());
        } catch (Exception e) {
            setArStatus("AR session failed closed: " + e.getClass().getSimpleName());
        }
    }

    private boolean ensureCameraPermission() {
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) return false;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        setArStatus("Camera permission is required for ARCore.");
        return true;
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (session != null) session.pause();
        arView.onPause();
    }

    @Override
    protected void onDestroy() {
        hostClient.disconnect();
        hostExecutor.shutdownNow();
        if (session != null) session.close();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST && (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED)) {
            setArStatus("Camera permission denied. AR writes are disabled.");
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
            renderStatus();
        });
    }

    private void renderStatus() {
        runOnUiThread(() -> status.setText("Fangcun AR\n" + arStatus + "\n\nHost: " + hostStatus));
    }
}
