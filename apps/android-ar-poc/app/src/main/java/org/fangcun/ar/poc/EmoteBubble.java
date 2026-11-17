package org.fangcun.ar.poc;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;

/**
 * Small floating emote bubble ("💤", "♪", "❤️") shown above the companion while it is sitting or
 * sleeping. Same bitmap/Canvas -> GL texture pipeline as the nameplate and speech bubble; drawn as
 * a camera-facing billboard above the nameplate.
 */
final class EmoteBubble {
    static final int TEXT_SIZE_PX = 78;
    private static final int PADDING = 22;
    private static final int TAIL_HEIGHT = 22;
    private static final int CORNER_RADIUS = 34;
    private static final int SHADOW_MARGIN = 12;
    private static final long POP_MS = 170L;
    private static final long HOLD_MS = 2100L;
    private static final long FADE_MS = 260L;

    private final BitmapCanvas surface = new BitmapCanvas();
    private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint emojiPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF plateRect = new RectF();
    private final Path shape = new Path();
    private final Path tail = new Path();
    private final Path body = new Path();

    private String emoji = "";
    private long startMs;
    private boolean active;
    private boolean textureDirty;
    private float alpha;
    private float scale = 1f;

    EmoteBubble() {
        fillPaint.setColor(0xFFFFF8E7);
        fillPaint.setStyle(Paint.Style.FILL);
        fillPaint.setShadowLayer(9f, 1f, 4f, 0x55000000);
        strokePaint.setColor(0xFF5B4632);
        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setStrokeWidth(4f);
        emojiPaint.setTextSize(TEXT_SIZE_PX);
        emojiPaint.setTextAlign(Paint.Align.CENTER);
        emojiPaint.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
    }

    void show(String emote, long nowMs) {
        if (emote == null || emote.isEmpty()) return;
        emoji = emote;
        startMs = nowMs;
        active = true;
        alpha = 1f;
        scale = 0.55f;
        rebuild();
        textureDirty = true;
    }

    void hide() {
        active = false;
    }

    /** Advances pop/hold/fade and uploads the bitmap when needed. GL thread only. */
    void update(long nowMs) {
        if (!active) return;
        long elapsed = nowMs - startMs;
        long fadeStart = POP_MS + HOLD_MS;
        long total = fadeStart + FADE_MS;
        if (elapsed >= total) {
            active = false;
            return;
        }
        if (elapsed < POP_MS) {
            alpha = CompanionPoseMath.clamp01(elapsed / 90f);
            scale = 0.55f + 0.45f * CompanionPoseMath.easeOutBack(elapsed / (float) POP_MS);
        } else if (elapsed > fadeStart) {
            float fade = CompanionPoseMath.clamp01((elapsed - fadeStart) / (float) FADE_MS);
            alpha = 1f - fade;
            scale = 1f - 0.08f * fade;
        } else {
            alpha = 1f;
            scale = 1f;
        }
        if (textureDirty) {
            surface.uploadIfDirty();
            textureDirty = false;
        }
    }

    boolean visible() { return active && surface.ready(); }

    int textureId() { return surface.textureId(); }

    float alpha() { return alpha; }

    float scale() { return scale; }

    float aspect() { return surface.aspect(); }

    int pixelHeight() { return surface.pixelHeight(); }

    private void rebuild() {
        Paint.FontMetrics metrics = emojiPaint.getFontMetrics();
        float textWidth = emojiPaint.measureText(emoji);
        int plateWidth = (int) Math.ceil(Math.max(96f, textWidth) + PADDING * 2);
        int plateHeight = (int) Math.ceil((metrics.descent - metrics.ascent) + PADDING * 2);
        int width = plateWidth + SHADOW_MARGIN * 2;
        int height = plateHeight + TAIL_HEIGHT + SHADOW_MARGIN * 2;
        Canvas canvas = surface.begin(width, height);
        float left = SHADOW_MARGIN;
        float top = SHADOW_MARGIN;
        float right = left + plateWidth;
        float bottom = top + plateHeight;
        plateRect.set(left, top, right, bottom);
        body.reset();
        body.addRoundRect(plateRect, CORNER_RADIUS, CORNER_RADIUS, Path.Direction.CW);
        float centreX = (left + right) * 0.5f;
        tail.reset();
        tail.moveTo(centreX - 18f, bottom - 2f);
        tail.lineTo(centreX + 18f, bottom - 2f);
        tail.lineTo(centreX, bottom + TAIL_HEIGHT);
        tail.close();
        shape.reset();
        shape.set(body);
        shape.op(tail, Path.Op.UNION);
        canvas.drawPath(shape, fillPaint);
        canvas.drawPath(shape, strokePaint);
        float baseline = (left + right) * 0.5f;
        float textBaseline = top + PADDING - metrics.ascent;
        canvas.drawText(emoji, baseline, textBaseline, emojiPaint);
    }

    void release() {
        active = false;
        surface.release();
    }
}
