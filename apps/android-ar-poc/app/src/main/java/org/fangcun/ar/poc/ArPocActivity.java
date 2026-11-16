package org.fangcun.ar.poc;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;

import com.google.ar.core.ArCoreApk;
import com.google.ar.core.Config;
import com.google.ar.core.Session;
import com.google.ar.core.exceptions.UnavailableArcoreNotInstalledException;
import com.google.ar.core.exceptions.UnavailableApkTooOldException;
import com.google.ar.core.exceptions.UnavailableSdkTooOldException;
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException;

/**
 * Minimal native ARCore proof of concept for Fangcun.
 *
 * Official references:
 * - https://developers.google.com/ar/develop/java/quickstart
 * - https://developers.google.com/ar/develop/java/hit-test/developer-guide
 * - https://developers.google.com/ar/develop/java/session-config
 *
 * This app deliberately contains no Fangcun world/network/model code. It only proves
 * ARCore availability, camera permission, horizontal hit-test, anchor placement, and
 * fail-closed tracking status for a simple GLES cube.
 */
public final class ArPocActivity extends Activity {
    private static final int CAMERA_PERMISSION_REQUEST = 100;

    private volatile Session session;
    private ArPocView arView;
    private TextView status;
    private boolean installRequested;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);

        FrameLayout root = new FrameLayout(this);
        arView = new ArPocView(this);
        root.addView(arView, new FrameLayout.LayoutParams(-1, -1));

        status = new TextView(this);
        status.setTextColor(0xffffffff);
        status.setTextSize(14);
        status.setPadding(24, 24, 24, 24);
        status.setBackgroundColor(0x990f1915);
        status.setText("Fangcun AR POC\nChecking ARCore…");
        FrameLayout.LayoutParams statusParams = new FrameLayout.LayoutParams(-2, -2);
        statusParams.topMargin = 28;
        statusParams.leftMargin = 18;
        root.addView(status, statusParams);
        setContentView(root);

        arView.setOnTouchListener((view, event) -> {
            if (event.getAction() == MotionEvent.ACTION_UP && session != null) {
                arView.queueTap(event.getX(), event.getY());
                return true;
            }
            if (event.getAction() == MotionEvent.ACTION_UP) arView.clearPendingTap();
            return true;
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (ensureCameraPermission()) return;
        try {
            if (session == null) {
                ArCoreApk.Availability availability = ArCoreApk.getInstance().checkAvailability(this);
                if (availability.isTransient()) {
                    setStatus("ARCore availability is still being checked…");
                    arView.requestRender();
                    return;
                }
                if (!availability.isSupported()) {
                    setStatus("ARCore unsupported on this device.\nNo AR session started.");
                    return;
                }
                ArCoreApk.InstallStatus installStatus = ArCoreApk.getInstance().requestInstall(this, !installRequested);
                if (installStatus == ArCoreApk.InstallStatus.INSTALL_REQUESTED) {
                    installRequested = true;
                    setStatus("Installing or updating Google Play Services for AR…");
                    return;
                }
                session = new Session(this);
                Config config = session.getConfig();
                config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL);
                session.configure(config);
            }
            // Start the GL surface, then pass the session; texture attachment happens only after GL initialization.
            arView.onResume();
            arView.setSession(session);
            session.resume();
            setStatus("ARCore ready. Move over a tabletop; tap to place a cube.\nTracking: starting");
        } catch (UnavailableArcoreNotInstalledException | UnavailableApkTooOldException |
                 UnavailableSdkTooOldException | UnavailableUserDeclinedInstallationException e) {
            setStatus("ARCore unavailable: " + e.getClass().getSimpleName());
        } catch (Exception e) {
            setStatus("AR session failed closed: " + e.getClass().getSimpleName());
        }
    }

    private boolean ensureCameraPermission() {
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) return false;
        requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION_REQUEST);
        setStatus("Camera permission is required for ARCore.");
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
        if (session != null) session.close();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == CAMERA_PERMISSION_REQUEST && (grantResults.length == 0 || grantResults[0] != PackageManager.PERMISSION_GRANTED)) {
            setStatus("Camera permission denied. AR writes are disabled.");
        }
    }

    Session currentSession() { return session; }

    void setStatus(String value) {
        runOnUiThread(() -> status.setText("Fangcun AR POC\n" + value));
    }
}
