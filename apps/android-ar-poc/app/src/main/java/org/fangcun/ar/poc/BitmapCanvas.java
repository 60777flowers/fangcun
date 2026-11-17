package org.fangcun.ar.poc;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.PorterDuff;
import android.opengl.GLES20;
import android.opengl.GLUtils;

/**
 * A software {@link Bitmap} + {@link Canvas} paired with one GL texture.
 *
 * <p>Billboards (the nameplate and the speech bubble) are painted with plain Android Canvas
 * calls into the bitmap; only {@link #uploadIfDirty()} touches GL, and the renderer must call it
 * on the GL thread. Re-uploads after a redraw use {@code texSubImage2D} while the bitmap size is
 * unchanged, which keeps the per-character typewriter redraws cheap.</p>
 */
final class BitmapCanvas {
    private Bitmap bitmap;
    private Canvas canvas;
    private int textureId;
    private boolean dirty;
    private boolean reallocated;

    /** Ensures the backing bitmap exists at the requested size (recycling an old one). */
    Canvas begin(int width, int height) {
        int safeWidth = Math.max(1, width);
        int safeHeight = Math.max(1, height);
        if (bitmap == null || bitmap.getWidth() != safeWidth || bitmap.getHeight() != safeHeight) {
            if (bitmap != null) bitmap.recycle();
            bitmap = Bitmap.createBitmap(safeWidth, safeHeight, Bitmap.Config.ARGB_8888);
            canvas = new Canvas(bitmap);
            reallocated = true;
        }
        // Clear to transparent so the previous frame's glyphs do not smear.
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR);
        dirty = true;
        return canvas;
    }

    /** Uploads the pending draws. Must run on the GL thread. Returns false when clean. */
    boolean uploadIfDirty() {
        if (!dirty || bitmap == null) return false;
        if (textureId == 0) {
            int[] ids = new int[1];
            GLES20.glGenTextures(1, ids, 0);
            textureId = ids[0];
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId);
            // HUD art is anti-aliased, so LINEAR (unlike the pixel-art block atlas).
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
            reallocated = true;
        }
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId);
        if (reallocated) {
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
            reallocated = false;
        } else {
            GLUtils.texSubImage2D(GLES20.GL_TEXTURE_2D, 0, 0, 0, bitmap);
        }
        dirty = false;
        return true;
    }

    int textureId() { return textureId; }

    boolean ready() { return textureId != 0 && bitmap != null; }

    int pixelWidth() { return bitmap == null ? 1 : bitmap.getWidth(); }

    int pixelHeight() { return bitmap == null ? 1 : bitmap.getHeight(); }

    float aspect() {
        if (bitmap == null) return 1f;
        return bitmap.getWidth() / (float) bitmap.getHeight();
    }

    void release() {
        if (textureId != 0) {
            int[] ids = {textureId};
            GLES20.glDeleteTextures(1, ids, 0);
            textureId = 0;
        }
        if (bitmap != null) {
            bitmap.recycle();
            bitmap = null;
            canvas = null;
        }
    }
}
