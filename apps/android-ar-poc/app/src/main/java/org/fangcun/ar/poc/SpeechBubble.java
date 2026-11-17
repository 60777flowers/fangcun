package org.fangcun.ar.poc;

import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Animal-Crossing-style 3D speech bubble drawn above the companion.
 *
 * <p>The plate is a warm off-white rounded rectangle with a soft dark-brown outline and a little
 * tail pointing down at the character, painted with plain Canvas calls into a bitmap and uploaded
 * as one GL texture (same pipeline as {@link Nameplate}). Text is clamped to three wrapped lines
 * and revealed with a fast typewriter; the whole bubble pops in with a bouncy ease, holds, then
 * fades out. A new line replaces the current one — never more than one bubble exists.</p>
 *
 * <p>{@link #update(long)} and the redraw/upload run on the GL thread (called from
 * {@code ArPocRenderer.onDrawFrame}).</p>
 */
final class SpeechBubble {
    static final int TEXT_SIZE_PX = 46;
    private static final int PADDING_H = 44;
    private static final int PADDING_V = 30;
    private static final int TAIL_HEIGHT = 36;
    private static final int TAIL_WIDTH = 54;
    private static final int CORNER_RADIUS = 34;
    private static final int SHADOW_MARGIN = 22;
    private static final int MAX_TEXT_WIDTH = 640; // bitmap px, roughly 3 lines of Chinese text
    private static final int MAX_LINES = 3;

    private static final long POP_MS = 190L;
    private static final long FADE_MS = 380L;
    private static final long HOLD_MS = 3600L;
    private static final long MILLIS_PER_CHAR = 17L; // fast typewriter

    private final BitmapCanvas surface = new BitmapCanvas();
    private final Paint fillPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint strokePaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF plateRect = new RectF();
    private final Path platePath = new Path();
    private final Path tailPath = new Path();
    private final Path bubblePath = new Path();

    private List<String> lines = Collections.singletonList(" ");
    private String text = "";
    private long startMs;
    private long typewriterMs;
    private long fadeStartMs;
    private int revealedChars;
    private float alpha;
    private float scale = 1f;
    private boolean active;
    private boolean textureDirty;

    SpeechBubble() {
        fillPaint.setColor(0xFFFFF8E7);
        fillPaint.setStyle(Paint.Style.FILL);
        // Soft drop shadow, painted in software into the bitmap.
        fillPaint.setShadowLayer(12f, 2f, 6f, 0x66000000);
        strokePaint.setColor(0xFF5B4632);
        strokePaint.setStyle(Paint.Style.STROKE);
        strokePaint.setStrokeWidth(5f);
        textPaint.setColor(0xFF4A3625);
        textPaint.setTextSize(TEXT_SIZE_PX);
        textPaint.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        textPaint.setTextAlign(Paint.Align.CENTER);
    }

    /** Starts a new bubble (or refreshes the hold of the identical current one). */
    void show(String message, long nowMs) {
        String value = message == null ? "" : message.trim();
        if (value.isEmpty()) return;
        if (active && value.equals(text)) {
            startMs = nowMs;
            return;
        }
        text = value;
        layoutText(value);
        typewriterMs = Math.min(1500L, Math.max(90L, totalChars() * MILLIS_PER_CHAR));
        fadeStartMs = POP_MS + typewriterMs + HOLD_MS;
        startMs = nowMs;
        revealedChars = 0;
        alpha = 1f;
        scale = 0.6f;
        active = true;
        buildBitmap();
        textureDirty = true;
    }

    /** Advances the animation. Must run on the GL thread because it redraws/uploads. */
    void update(long nowMs) {
        if (!active) return;
        long elapsed = nowMs - startMs;
        long totalMs = fadeStartMs + FADE_MS;
        if (elapsed >= totalMs) {
            active = false;
            return;
        }
        if (elapsed < POP_MS) {
            alpha = CompanionPoseMath.clamp01(elapsed / 120f);
            scale = 0.6f + 0.4f * CompanionPoseMath.easeOutBack(elapsed / (float) POP_MS);
        } else if (elapsed > fadeStartMs) {
            float fade = CompanionPoseMath.clamp01((elapsed - fadeStartMs) / (float) FADE_MS);
            alpha = 1f - fade;
            scale = 1f - 0.06f * fade;
        } else {
            alpha = 1f;
            scale = 1f;
        }
        int reveal = (int) Math.min(totalChars(), elapsed / MILLIS_PER_CHAR);
        if (reveal != revealedChars) {
            revealedChars = reveal;
            buildBitmap();
            textureDirty = true;
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

    private int totalChars() {
        int total = 0;
        for (String line : lines) total += line.length();
        return Math.max(1, total);
    }

    /** Paints the plate and the currently revealed text prefix into the bitmap. */
    private void buildBitmap() {
        Paint.FontMetrics metrics = textPaint.getFontMetrics();
        float lineHeight = (metrics.descent - metrics.ascent) * 1.16f;
        float widest = 0f;
        for (String line : lines) widest = Math.max(widest, textPaint.measureText(line));
        int plateWidth = Math.max(120, (int) Math.ceil(widest + PADDING_H * 2));
        int plateHeight = Math.max(40, (int) Math.ceil(PADDING_V * 2 + lines.size() * lineHeight));
        int bitmapWidth = plateWidth + SHADOW_MARGIN * 2;
        int bitmapHeight = plateHeight + TAIL_HEIGHT + SHADOW_MARGIN * 2;

        Canvas canvas = surface.begin(bitmapWidth, bitmapHeight);
        float left = SHADOW_MARGIN;
        float top = SHADOW_MARGIN;
        float right = left + plateWidth;
        float bottom = top + plateHeight;

        plateRect.set(left, top, right, bottom);
        platePath.reset();
        platePath.addRoundRect(plateRect, CORNER_RADIUS, CORNER_RADIUS, Path.Direction.CW);
        float tailTop = bottom - 2f;
        float centreX = (left + right) * 0.5f;
        tailPath.reset();
        tailPath.moveTo(centreX - TAIL_WIDTH * 0.5f, tailTop);
        tailPath.lineTo(centreX + TAIL_WIDTH * 0.5f, tailTop);
        tailPath.lineTo(centreX, tailTop + TAIL_HEIGHT);
        tailPath.close();
        bubblePath.reset();
        bubblePath.set(platePath);
        // Union so the outline walks the plate and the tail as one silhouette (no seam).
        bubblePath.op(tailPath, Path.Op.UNION);
        canvas.drawPath(bubblePath, fillPaint);
        canvas.drawPath(bubblePath, strokePaint);

        int remaining = revealedChars;
        float lineTop = top + PADDING_V;
        for (String line : lines) {
            int visible = Math.min(line.length(), Math.max(0, remaining));
            if (visible > 0) {
                float baseline = lineTop - metrics.ascent;
                String prefix = line.substring(0, visible);
                canvas.drawText(prefix, centreX, baseline, textPaint);
            }
            remaining -= line.length();
            lineTop += lineHeight;
            if (remaining <= 0 && revealedChars < totalChars()) break;
        }
    }

    /**
     * Greedy character wrap with word-break preference, clamped to {@link #MAX_LINES} lines.
     * CJK text wraps per character; Latin text prefers the last space so words are not split
     * when one is available.
     */
    private void layoutText(String message) {
        String flat = message.replace('\r', ' ').replace('\t', ' ');
        List<String> out = new ArrayList<>(MAX_LINES);
        StringBuilder line = new StringBuilder();
        boolean truncated = false;
        int index = 0;
        while (index < flat.length()) {
            char ch = flat.charAt(index);
            if (ch == '\n') {
                if (out.size() >= MAX_LINES - 1) {
                    truncated = index < flat.length() - 1;
                    out.add(line.toString());
                    line.setLength(0);
                    break;
                }
                out.add(line.toString());
                line.setLength(0);
                index += 1;
                continue;
            }
            boolean lastLine = out.size() == MAX_LINES - 1;
            float limit = MAX_TEXT_WIDTH - (lastLine ? textPaint.measureText("…") : 0f);
            String candidate = line.toString() + ch;
            if (line.length() == 0 || textPaint.measureText(candidate) <= limit) {
                line.append(ch);
                index += 1;
            } else if (lastLine) {
                truncated = true;
                break;
            } else {
                int space = line.lastIndexOf(" ");
                if (space > 0) {
                    String remainder = line.substring(space + 1);
                    out.add(line.substring(0, space));
                    line.setLength(0);
                    line.append(remainder);
                } else {
                    out.add(line.toString());
                    line.setLength(0);
                }
            }
        }
        if (line.length() > 0 && out.size() < MAX_LINES) out.add(line.toString());
        if (out.size() >= MAX_LINES && index < flat.length()) truncated = true;
        if (truncated && !out.isEmpty()) {
            int lastIndex = out.size() - 1;
            String last = out.get(lastIndex);
            while (last.length() > 0 && textPaint.measureText(last + "…") > MAX_TEXT_WIDTH) {
                last = last.substring(0, last.length() - 1);
            }
            out.set(lastIndex, last + "…");
        }
        if (out.isEmpty()) out.add(" ");
        lines = Collections.unmodifiableList(out);
    }

    void release() {
        active = false;
        surface.release();
    }
}
