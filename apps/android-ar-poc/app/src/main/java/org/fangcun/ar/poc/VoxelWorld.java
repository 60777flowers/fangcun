package org.fangcun.ar.poc;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;

/**
 * Client replica of the 16x16x16 world. Blocks are stored x-fastest, z-next,
 * y-slowest, matching WorldSpec v1, and rendered as exposed faces only.
 *
 * <p>{@link #BLOCK_IDS} must mirror {@code packages/world-schema} append-only: the durable store
 * encodes a block as {@code index + 1}, so new ids are always appended. The atlas mapping
 * ({@code block-atlas.json}) is keyed by the same ids; blocks without a mapping fall back to the
 * flat per-face colours below.</p>
 */
final class VoxelWorld {
    static final int SIZE = 16;
    static final int ORIGIN = -8;
    static final float VOXEL_METERS = 0.03f;
    static final int BUILD_MIN_Y = 1; // must track WorldSpec.terrainTopY

    /** Keep in sync with {@code packages/world-schema/src/index.ts} (append only). */
    private static final String[] BLOCK_IDS = {
        "grass", "dirt", "stone", "planks", "log", "leaves", "sand", "glass",
        "brick", "tile", "wool_white", "wool_red", "bookshelf", "lantern", "pumpkin", "flower"
    };

    // Per-face fallback colours. Textured faces use the shade factor below instead, so the
    // palette is what a block looks like when it is missing from the atlas mapping.
    private static final float SHADE_TOP = 1.0f;
    private static final float SHADE_BOTTOM = 0.42f;
    private static final float SHADE_X = 0.76f;
    private static final float SHADE_Z = 0.58f;

    private static final float[][] BLOCK_FACE_RGB = buildFacePalette();
    private static final float[] BLOCK_ALPHA = buildAlpha();

    private final byte[] blocks = new byte[SIZE * SIZE * SIZE];
    private String worldId = "";
    private int rev = -1;

    int revision() { return rev; }
    String worldId() { return worldId; }
    boolean ready() { return rev >= 0; }

    private static int index(int x, int y, int z) {
        return ((y * SIZE) + (z - ORIGIN)) * SIZE + (x - ORIGIN);
    }

    private static boolean inside(int x, int y, int z) {
        return x >= ORIGIN && x < ORIGIN + SIZE && z >= ORIGIN && z < ORIGIN + SIZE && y >= 0 && y < SIZE;
    }

    byte blockAt(int x, int y, int z) {
        if (!inside(x, y, z)) return 0;
        return blocks[index(x, y, z)];
    }

    boolean isSolid(int x, int y, int z) { return blockAt(x, y, z) != 0; }

    private static byte codeFor(String blockId) {
        for (int i = 0; i < BLOCK_IDS.length; i += 1) {
            if (BLOCK_IDS[i].equals(blockId)) return (byte) (i + 1);
        }
        return 0;
    }

    /** Canonical block id for a wire code (0 becomes an empty string). */
    static String blockIdForCode(byte code) {
        if (code < 1 || code > BLOCK_IDS.length) return "";
        return BLOCK_IDS[code - 1];
    }

    /** Replaces the replica from a `welcome.snapshot`. Returns false on shape mismatch. */
    boolean loadSnapshot(JSONObject snapshot) {
        try {
            String id = snapshot.getString("worldId");
            JSONArray array = snapshot.getJSONArray("blocks");
            if (array.length() != blocks.length) return false;
            Arrays.fill(blocks, (byte) 0);
            for (int i = 0; i < array.length(); i += 1) {
                if (array.isNull(i)) continue;
                byte code = codeFor(array.getString(i));
                if (code == 0) return false;
                blocks[i] = code;
            }
            worldId = id;
            rev = snapshot.getInt("rev");
            return true;
        } catch (JSONException error) {
            return false;
        }
    }

    /** Applies a `commit` frame only if it is the next revision. */
    boolean applyCommit(JSONObject commit) {
        try {
            if (!commit.getString("worldId").equals(worldId)) return false;
            int nextRev = commit.getInt("rev");
            if (nextRev != rev + 1) return false;
            JSONArray operations = commit.getJSONArray("operations");
            for (int i = 0; i < operations.length(); i += 1) {
                JSONObject operation = operations.getJSONObject(i);
                JSONObject at = operation.getJSONObject("at");
                int x = at.getInt("x");
                int y = at.getInt("y");
                int z = at.getInt("z");
                if (!inside(x, y, z)) return false;
                if ("place".equals(operation.getString("type"))) {
                    byte code = codeFor(operation.getString("blockId"));
                    if (code == 0) return false;
                    blocks[index(x, y, z)] = code;
                } else {
                    blocks[index(x, y, z)] = 0;
                }
            }
            rev = nextRev;
            return true;
        } catch (JSONException error) {
            return false;
        }
    }

    /** First empty build cell in a column, or -1 when the column is full. */
    int firstEmptyY(int x, int z) {
        if (x < ORIGIN || x >= ORIGIN + SIZE || z < ORIGIN || z >= ORIGIN + SIZE) return -1;
        for (int y = BUILD_MIN_Y; y < SIZE; y += 1) {
            if (blocks[index(x, y, z)] == 0) return y;
        }
        return -1;
    }

    /** Highest solid block in a column, or -1 when empty. */
    int topSolidY(int x, int z) {
        if (x < ORIGIN || x >= ORIGIN + SIZE || z < ORIGIN || z >= ORIGIN + SIZE) return -1;
        for (int y = SIZE - 1; y >= 0; y -= 1) {
            if (blocks[index(x, y, z)] != 0) return y;
        }
        return -1;
    }

    int countBlocks() {
        int total = 0;
        for (byte block : blocks) if (block != 0) total += 1;
        return total;
    }

    /**
     * Builds exposed-face geometry in metres relative to the island anchor.
     *
     * <p>When {@code atlas} is non-null the first {@link Mesh#texturedVertexCount} vertices carry
     * atlas UVs and are drawn with the textured shader; any block missing from the mapping is
     * appended afterwards with its flat face colour. The arrays are split so the renderer can
     * issue two draw calls without a per-vertex texture flag.</p>
     */
    Mesh buildMesh(VoxelAtlas atlas) {
        final float s = VOXEL_METERS;
        float[] positions = new float[SIZE * SIZE * SIZE * 6 * 6 * 3];
        float[] colors = new float[SIZE * SIZE * SIZE * 6 * 6 * 4];
        float[] uvs = new float[SIZE * SIZE * SIZE * 6 * 6 * 2];
        float[] shades = new float[SIZE * SIZE * SIZE * 6 * 6];
        int[] cursor = new int[4];
        final float[] tileUv = new float[4];
        int texturedVertexCount = 0;

        for (int pass = 0; pass < 2; pass += 1) {
            for (int y = 0; y < SIZE; y += 1) {
                for (int z = ORIGIN; z < ORIGIN + SIZE; z += 1) {
                    for (int x = ORIGIN; x < ORIGIN + SIZE; x += 1) {
                        byte code = blocks[index(x, y, z)];
                        if (code == 0) continue;
                        String blockId = BLOCK_IDS[code - 1];
                        VoxelAtlas.TileSet tiles = atlas == null ? null : atlas.tileSet(blockId);
                        boolean textured = tiles != null;
                        if (textured != (pass == 0)) continue;

                        float[] palette = BLOCK_FACE_RGB[code - 1];
                        float alpha = BLOCK_ALPHA[code - 1];
                        float x0 = x * s, x1 = (x + 1) * s;
                        float y0 = y * s, y1 = (y + 1) * s;
                        float z0 = z * s, z1 = (z + 1) * s;

                        if (!isSolid(x, y + 1, z)) {
                            int tile = tiles == null ? -1 : tiles.top;
                            if (textured) atlas.uvRect(tile, tileUv);
                            cursor = emitFace(cursor, positions, colors, uvs, shades, textured, tileUv,
                                0, palette, SHADE_TOP, alpha, x0, x1, y0, y1, z0, z1,
                                x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0);
                        }
                        if (!isSolid(x, y - 1, z)) {
                            int tile = tiles == null ? -1 : tiles.bottom;
                            if (textured) atlas.uvRect(tile, tileUv);
                            cursor = emitFace(cursor, positions, colors, uvs, shades, textured, tileUv,
                                1, palette, SHADE_BOTTOM, alpha, x0, x1, y0, y1, z0, z1,
                                x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
                        }
                        if (!isSolid(x + 1, y, z)) {
                            int tile = tiles == null ? -1 : tiles.side;
                            if (textured) atlas.uvRect(tile, tileUv);
                            cursor = emitFace(cursor, positions, colors, uvs, shades, textured, tileUv,
                                2, palette, SHADE_X, alpha, x0, x1, y0, y1, z0, z1,
                                x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0);
                        }
                        if (!isSolid(x - 1, y, z)) {
                            int tile = tiles == null ? -1 : tiles.side;
                            if (textured) atlas.uvRect(tile, tileUv);
                            cursor = emitFace(cursor, positions, colors, uvs, shades, textured, tileUv,
                                3, palette, SHADE_X, alpha, x0, x1, y0, y1, z0, z1,
                                x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1);
                        }
                        if (!isSolid(x, y, z + 1)) {
                            int tile = tiles == null ? -1 : tiles.side;
                            if (textured) atlas.uvRect(tile, tileUv);
                            cursor = emitFace(cursor, positions, colors, uvs, shades, textured, tileUv,
                                4, palette, SHADE_Z, alpha, x0, x1, y0, y1, z0, z1,
                                x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1);
                        }
                        if (!isSolid(x, y, z - 1)) {
                            int tile = tiles == null ? -1 : tiles.side;
                            if (textured) atlas.uvRect(tile, tileUv);
                            cursor = emitFace(cursor, positions, colors, uvs, shades, textured, tileUv,
                                5, palette, SHADE_Z, alpha, x0, x1, y0, y1, z0, z1,
                                x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0);
                        }
                    }
                }
            }
            if (pass == 0) texturedVertexCount = cursor[0] / 3; // vertices emitted so far = textured count
        }

        return new Mesh(
            Arrays.copyOf(positions, cursor[0]),
            Arrays.copyOf(colors, cursor[1]),
            Arrays.copyOf(uvs, cursor[2]),
            Arrays.copyOf(shades, cursor[3]),
            cursor[0] / 3,
            texturedVertexCount);
    }

    /**
     * Emits one quad (six vertices) with atlas UVs and per-face shading. Face indices:
     * 0 +Y (top), 1 -Y (bottom), 2 +X, 3 -X, 4 +Z, 5 -Z. Returns the updated cursors as
     * {@code [positionFloats, colourFloats, uvFloats, vertexCount]}.
     */
    private static int[] emitFace(int[] cursor,
                                  float[] positions, float[] colors, float[] uvs, float[] shades,
                                  boolean textured, float[] tileUv,
                                  int face, float[] palette, float shade, float alpha,
                                  float x0, float x1, float y0, float y1, float z0, float z1,
                                  float ax, float ay, float az,
                                  float bx, float by, float bz,
                                  float cx, float cy, float cz,
                                  float dx, float dy, float dz) {
        // Palette layout per block: 0..2 top, 3..5 +X side, 6..8 +Z side, 9..11 bottom.
        int paletteOffset = face == 0 ? 0 : face == 1 ? 9 : (face == 2 || face == 3) ? 3 : 6;
        float red = palette[paletteOffset];
        float green = palette[paletteOffset + 1];
        float blue = palette[paletteOffset + 2];
        cursor = emitVertex(cursor, positions, colors, uvs, shades, textured, tileUv,
            face, paletteOffset, red, green, blue, shade, alpha, x0, x1, y0, y1, z0, z1, ax, ay, az);
        cursor = emitVertex(cursor, positions, colors, uvs, shades, textured, tileUv,
            face, paletteOffset, red, green, blue, shade, alpha, x0, x1, y0, y1, z0, z1, bx, by, bz);
        cursor = emitVertex(cursor, positions, colors, uvs, shades, textured, tileUv,
            face, paletteOffset, red, green, blue, shade, alpha, x0, x1, y0, y1, z0, z1, cx, cy, cz);
        cursor = emitVertex(cursor, positions, colors, uvs, shades, textured, tileUv,
            face, paletteOffset, red, green, blue, shade, alpha, x0, x1, y0, y1, z0, z1, ax, ay, az);
        cursor = emitVertex(cursor, positions, colors, uvs, shades, textured, tileUv,
            face, paletteOffset, red, green, blue, shade, alpha, x0, x1, y0, y1, z0, z1, cx, cy, cz);
        cursor = emitVertex(cursor, positions, colors, uvs, shades, textured, tileUv,
            face, paletteOffset, red, green, blue, shade, alpha, x0, x1, y0, y1, z0, z1, dx, dy, dz);
        return cursor;
    }

    private static int[] emitVertex(int[] cursor,
                                    float[] positions, float[] colors, float[] uvs, float[] shades,
                                    boolean textured, float[] tileUv,
                                    int face, int paletteOffset,
                                    float red, float green, float blue, float shade, float alpha,
                                    float x0, float x1, float y0, float y1, float z0, float z1,
                                    float px, float py, float pz) {
        int positionOffset = cursor[0];
        positions[positionOffset] = px;
        positions[positionOffset + 1] = py;
        positions[positionOffset + 2] = pz;
        cursor[0] = positionOffset + 3;

        int colorOffset = cursor[1];
        colors[colorOffset] = red;
        colors[colorOffset + 1] = green;
        colors[colorOffset + 2] = blue;
        colors[colorOffset + 3] = alpha;
        cursor[1] = colorOffset + 4;

        int uvOffset = cursor[2];
        if (textured) {
            float[] uv = uvForCorner(face, tileUv, x0, x1, y0, y1, z0, z1, px, py, pz);
            uvs[uvOffset] = uv[0];
            uvs[uvOffset + 1] = uv[1];
        }
        cursor[2] = uvOffset + 2;

        shades[cursor[3]] = shade;
        cursor[3] += 1;
        return cursor;
    }

    /**
     * Maps a face corner to the tile UV rectangle. Side textures are kept upright (V follows Y);
     * top/bottom samples follow X/Z.
     */
    private static float[] uvForCorner(int face, float[] tileUv,
                                       float x0, float x1, float y0, float y1, float z0, float z1,
                                       float px, float py, float pz) {
        float u0 = tileUv[0];
        float v0 = tileUv[1];
        float u1 = tileUv[2];
        float v1 = tileUv[3];
        float u;
        float v;
        switch (face) {
            case 0: // +Y: screen-like top face, U follows X, V follows Z
                u = (px - x0) / (x1 - x0);
                v = (pz - z0) / (z1 - z0);
                break;
            case 1: // -Y
                u = (px - x0) / (x1 - x0);
                v = (z1 - pz) / (z1 - z0);
                break;
            case 2: // +X
            case 3: // -X
                u = (pz - z0) / (z1 - z0);
                v = (y1 - py) / (y1 - y0);
                break;
            default: // +Z / -Z
                u = (px - x0) / (x1 - x0);
                v = (y1 - py) / (y1 - y0);
                break;
        }
        return new float[] {u0 + (u1 - u0) * u, v0 + (v1 - v0) * v};
    }

    /**
     * Builds the fallback palette. Legacy blocks keep their historical single colour multiplied
     * by the per-face shade factors; blocks whose texture tint is not a flat base (log, sand and
     * the decorative set) carry explicit top/+X/+Z colours, with the bottom derived from the top.
     */
    private static float[][] buildFacePalette() {
        float[][] palette = new float[BLOCK_IDS.length][];
        palette[indexOf("grass")] = shaded(0.51f, 0.62f, 0.38f);
        palette[indexOf("dirt")] = shaded(0.54f, 0.39f, 0.27f);
        palette[indexOf("stone")] = shaded(0.60f, 0.64f, 0.60f);
        palette[indexOf("planks")] = shaded(0.74f, 0.54f, 0.36f);
        palette[indexOf("leaves")] = shaded(0.45f, 0.62f, 0.33f);
        palette[indexOf("glass")] = shaded(0.68f, 0.86f, 0.84f);
        palette[indexOf("log")] = faces(0xa9835a, 0x6d4f35, 0x8a6543);
        palette[indexOf("sand")] = faces(0xe4d6a8, 0xb3a276, 0xcdbd8d);
        palette[indexOf("brick")] = faces(0xb2624a, 0x7a3f32, 0x964d3c);
        palette[indexOf("tile")] = faces(0x8ea6b5, 0x57707e, 0x6f8898);
        palette[indexOf("wool_white")] = faces(0xece9e0, 0xb6b1a4, 0xd3cec0);
        palette[indexOf("wool_red")] = faces(0xc4554e, 0x8c3733, 0xa84743);
        palette[indexOf("bookshelf")] = faces(0xa07a4f, 0x62432c, 0x82593a);
        palette[indexOf("lantern")] = faces(0xf2c96b, 0x9a6a2b, 0xc2913f);
        palette[indexOf("pumpkin")] = faces(0xe08b3c, 0xa45a24, 0xc4722e);
        palette[indexOf("flower")] = faces(0xe3a4b6, 0x5d7f46, 0x7d9c5c);
        return palette;
    }

    private static float[] buildAlpha() {
        float[] alpha = new float[BLOCK_IDS.length];
        Arrays.fill(alpha, 1f);
        alpha[indexOf("glass")] = 0.85f;
        return alpha;
    }

    private static int indexOf(String blockId) {
        for (int i = 0; i < BLOCK_IDS.length; i += 1) {
            if (BLOCK_IDS[i].equals(blockId)) return i;
        }
        throw new IllegalArgumentException("unknown block id " + blockId);
    }

    /** {top, sideX, sideZ, bottom} from one base colour, matching the historical shading. */
    private static float[] shaded(float red, float green, float blue) {
        return new float[] {
            red, green, blue,
            red * SHADE_X, green * SHADE_X, blue * SHADE_X,
            red * SHADE_Z, green * SHADE_Z, blue * SHADE_Z,
            red * SHADE_BOTTOM, green * SHADE_BOTTOM, blue * SHADE_BOTTOM,
        };
    }

    /** {top, sideX, sideZ, bottom} with explicit colours; the bottom is derived from the top. */
    private static float[] faces(int topHex, int sideXHex, int sideZHex) {
        float[] top = rgb(topHex);
        return new float[] {
            top[0], top[1], top[2],
            rgb(sideXHex)[0], rgb(sideXHex)[1], rgb(sideXHex)[2],
            rgb(sideZHex)[0], rgb(sideZHex)[1], rgb(sideZHex)[2],
            top[0] * SHADE_BOTTOM, top[1] * SHADE_BOTTOM, top[2] * SHADE_BOTTOM,
        };
    }

    private static float[] rgb(int hex) {
        return new float[] {
            ((hex >>> 16) & 0xff) / 255f,
            ((hex >>> 8) & 0xff) / 255f,
            (hex & 0xff) / 255f,
        };
    }

    /**
     * Flat-shaded geometry. {@code uvs} and {@code shades} are only meaningful for the first
     * {@code texturedVertexCount} vertices when an atlas was supplied.
     */
    static final class Mesh {
        final float[] positions;
        final float[] colors;
        final float[] uvs;
        final float[] shades;
        final int vertexCount;
        final int texturedVertexCount;

        Mesh(float[] positions, float[] colors, float[] uvs, float[] shades,
             int vertexCount, int texturedVertexCount) {
            this.positions = positions;
            this.colors = colors;
            this.uvs = uvs;
            this.shades = shades;
            this.vertexCount = vertexCount;
            this.texturedVertexCount = texturedVertexCount;
        }
    }
}
