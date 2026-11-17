package org.fangcun.ar.poc;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;

/**
 * Minecraft-style companion nameplate: a small rounded semi-transparent dark plate with a light
 * name, rendered into a bitmap and uploaded once per text change.
 *
 * <p>It is a camera-facing billboard (see {@link Billboard}) drawn after the avatar with depth
 * testing disabled; the renderer scales it with the camera distance so it stays readable.</p>
 */
final class Nameplate {
    static final int TEXT_SIZE_PX = 46;
    private static final int PADDING_X = 34;
    private static final int PADDING_Y = 15;
    private static final int CORNER_RADIUS = 30;

    private final BitmapCanvas surface = new BitmapCanvas();
    private final Paint platePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF plateRect = new RectF();
    private String text = "";
    private boolean textDirty = true;

    Nameplate() {
        platePaint.setColor(0xCC14231C);
        platePaint.setStyle(Paint.Style.FILL);
        textPaint.setColor(0xFFF4FFDF);
        textPaint.setTextSize(TEXT_SIZE_PX);
        textPaint.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        textPaint.setTextAlign(Paint.Align.CENTER);
    }

    /** Sets the displayed name; the bitmap is only rebuilt when the string actually changes. */
    void setText(String name) {
        String value = name == null ? "" : name;
        if (!value.equals(text)) {
            text = value;
            textDirty = true;
        }
    }

    /** Rebuilds + uploads the texture when the text changed. Call on the GL thread. */
    void uploadIfNeeded() {
        if (!textDirty) return;
        textDirty = false;
        rebuild();
        surface.uploadIfDirty();
    }

    private void rebuild() {
        String label = text.isEmpty() ? " " : text;
        float textWidth = textPaint.measureText(label);
        Paint.FontMetrics metrics = textPaint.getFontMetrics();
        float textHeight = metrics.descent - metrics.ascent;
        int width = Math.max(2, (int) Math.ceil(textWidth + PADDING_X * 2));
        int height = Math.max(2, (int) Math.ceil(textHeight + PADDING_Y * 2));
        Canvas canvas = surface.begin(width, height);
        plateRect.set(0f, 0f, width, height);
        canvas.drawRoundRect(plateRect, CORNER_RADIUS, CORNER_RADIUS, platePaint);
        float baseline = height * 0.5f - (metrics.ascent + metrics.descent) * 0.5f;
        canvas.drawText(label, width * 0.5f, baseline, textPaint);
    }

    boolean ready() { return surface.ready(); }

    float aspect() { return surface.aspect(); }

    int pixelHeight() { return surface.pixelHeight(); }

    int textureId() { return surface.textureId(); }

    void draw(Billboard billboard, float alpha,
              float[] viewMatrix, float[] projectionMatrix,
              float[] cameraRight, float[] cameraUp,
              float cx, float cy, float cz,
              float heightMeters) {
        if (!ready()) return;
        float widthMeters = heightMeters * surface.aspect();
        billboard.draw(surface.textureId(), alpha, viewMatrix, projectionMatrix,
            cameraRight, cameraUp, cx, cy, cz, widthMeters, heightMeters);
    }

    void release() { surface.release(); }
}
