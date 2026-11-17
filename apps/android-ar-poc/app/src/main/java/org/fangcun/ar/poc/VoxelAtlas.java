package org.fangcun.ar.poc;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.opengl.GLES20;
import android.opengl.GLUtils;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * The block texture atlas: one pixel-art PNG plus a JSON tile mapping.
 *
 * <p>Both files are generated data ({@code assets/textures/block-atlas.*}, rebuilt by
 * {@code npm run atlas}), so adding a block texture never touches renderer code. The mapping
 * declares a top / side / bottom tile index per block id; UVs are derived from
 * {@code tileSize}, {@code columns} and {@code rows} with a half-texel inset so NEAREST sampling
 * can never bleed into a neighbouring tile.</p>
 *
 * <p>Loading is best effort: a missing or malformed atlas returns {@code null} and the renderer
 * keeps drawing the flat-colour fallback. Blocks that are missing from the mapping are also
 * rendered with their flat fallback colour, never with a wrong tile.</p>
 */
final class VoxelAtlas {
    private static final String TAG = "VoxelAtlas";
    static final String JSON_ASSET = "textures/block-atlas.json";
    static final String PNG_ASSET = "textures/block-atlas.png";

    /** Tile indices for the three face orientations a voxel needs. -1 means "no texture". */
    static final class TileSet {
        final int top;
        final int side;
        final int bottom;

        TileSet(int top, int side, int bottom) {
            this.top = top;
            this.side = side;
            this.bottom = bottom;
        }
    }

    private final int textureId;
    private final int columns;
    private final int rows;
    private final float texelU;
    private final float texelV;
    private final Map<String, TileSet> blocks;

    private VoxelAtlas(int textureId, int columns, int rows, int atlasWidthPx, int atlasHeightPx,
                       Map<String, TileSet> blocks) {
        this.textureId = textureId;
        this.columns = columns;
        this.rows = rows;
        this.texelU = atlasWidthPx <= 0 ? 0f : 0.5f / atlasWidthPx;
        this.texelV = atlasHeightPx <= 0 ? 0f : 0.5f / atlasHeightPx;
        this.blocks = blocks;
    }

    /**
     * Loads the atlas texture and mapping. Must run on the GL thread. Returns {@code null} when
     * the asset is absent or inconsistent so the caller can fall back to flat colours.
     */
    static VoxelAtlas load(Context context) {
        JSONObject json;
        try {
            json = new JSONObject(readAssetText(context, JSON_ASSET));
        } catch (Exception error) {
            Log.w(TAG, "block atlas mapping unavailable: " + error);
            return null;
        }
        try {
            if (json.optInt("schemaVersion", -1) != 1) {
                Log.w(TAG, "unsupported block atlas schema: " + json.optInt("schemaVersion", -1));
                return null;
            }
            int tileSize = json.getInt("tileSize");
            int columns = json.getInt("columns");
            int rows = json.getInt("rows");
            if (tileSize <= 0 || columns <= 0 || rows <= 0) {
                Log.w(TAG, "invalid block atlas grid " + columns + "x" + rows + " tile " + tileSize);
                return null;
            }
            JSONObject blockJson = json.optJSONObject("blocks");
            Map<String, TileSet> blocks = new HashMap<>();
            if (blockJson != null) {
                int tileCount = columns * rows;
                Iterator<String> keys = blockJson.keys();
                while (keys.hasNext()) {
                    String blockId = keys.next();
                    JSONObject entry = blockJson.optJSONObject(blockId);
                    if (entry == null) continue;
                    int top = entry.optInt("top", -1);
                    int side = entry.optInt("side", -1);
                    int bottom = entry.optInt("bottom", -1);
                    if (top < 0 && side < 0 && bottom < 0) continue;
                    if (top >= tileCount || side >= tileCount || bottom >= tileCount) {
                        Log.w(TAG, "tile index out of range for block " + blockId);
                        continue;
                    }
                    blocks.put(blockId, new TileSet(top, side, bottom));
                }
            }

            Bitmap bitmap;
            try (InputStream stream = context.getAssets().open(PNG_ASSET)) {
                bitmap = BitmapFactory.decodeStream(stream);
            }
            if (bitmap == null) {
                Log.w(TAG, "block atlas PNG failed to decode");
                return null;
            }
            int[] ids = new int[1];
            GLES20.glGenTextures(1, ids, 0);
            int textureId = ids[0];
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId);
            // NEAREST is essential: LINEAR would sample across the 16 px tile borders.
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_NEAREST);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_NEAREST);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
            GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            bitmap.recycle();
            if (width <= 0 || height <= 0 || width % columns != 0 || height % rows != 0) {
                Log.w(TAG, "block atlas " + width + "x" + height + " does not match grid " + columns + "x" + rows);
            }
            Log.i(TAG, "block atlas loaded " + width + "x" + height + " tiles "
                + tileSize + "px, " + blocks.size() + " blocks mapped");
            return new VoxelAtlas(textureId, columns, rows, width, height, Collections.unmodifiableMap(blocks));
        } catch (Exception error) {
            Log.w(TAG, "block atlas unavailable: " + error);
            return null;
        }
    }

    boolean ready() { return textureId != 0; }

    int textureId() { return textureId; }

    /** Tile set for a world block id, or {@code null} when the block has no atlas entry. */
    TileSet tileSet(String blockId) {
        return blockId == null ? null : blocks.get(blockId);
    }

    /**
     * Writes the UV rectangle of one tile to {@code out} as {@code [u0, vTop, u1, vBottom]},
     * inset by half a texel on each edge. Bitmap row 0 is the top row of the texture, so
     * {@code vTop} is the smaller V value.
     */
    void uvRect(int tileIndex, float[] out) {
        out[0] = 0f;
        out[1] = 0f;
        out[2] = 0f;
        out[3] = 0f;
        if (tileIndex < 0 || columns <= 0 || rows <= 0) return;
        int column = tileIndex % columns;
        int row = tileIndex / columns;
        if (row >= rows) return;
        float tileWidth = 1f / columns;
        float tileHeight = 1f / rows;
        out[0] = column * tileWidth + texelU;
        out[1] = row * tileHeight + texelV;
        out[2] = (column + 1) * tileWidth - texelU;
        out[3] = (row + 1) * tileHeight - texelV;
    }

    private static String readAssetText(Context context, String assetPath) throws IOException {
        try (InputStream stream = context.getAssets().open(assetPath)) {
            ByteArrayOutputStream sink = new ByteArrayOutputStream(1 << 12);
            byte[] scratch = new byte[8 * 1024];
            int read;
            while ((read = stream.read(scratch)) > 0) sink.write(scratch, 0, read);
            return new String(sink.toByteArray(), StandardCharsets.UTF_8);
        }
    }
}
