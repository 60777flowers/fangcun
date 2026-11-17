package org.fangcun.ar.poc;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Arrays;

/**
 * Client replica of the 16x16x16 world. Blocks are stored x-fastest, z-next,
 * y-slowest, matching WorldSpec v1, and rendered as exposed faces only.
 */
final class VoxelWorld {
    static final int SIZE = 16;
    static final int ORIGIN = -8;
    static final float VOXEL_METERS = 0.03f;
    static final int BUILD_MIN_Y = 4;

    private static final String[] BLOCK_IDS = {"grass", "dirt", "stone", "planks", "log", "leaves", "sand", "glass"};

    // Per-face brightness so voxel edges stay readable without any lighting model.
    private static final float SHADE_TOP = 1.0f;
    private static final float SHADE_BOTTOM = 0.42f;
    private static final float SHADE_X = 0.76f;
    private static final float SHADE_Z = 0.58f;
    private static final float[][] BLOCK_COLORS = {
        {0.51f, 0.62f, 0.38f, 1f},  // grass
        {0.54f, 0.39f, 0.27f, 1f},  // dirt
        {0.60f, 0.64f, 0.60f, 1f},  // stone
        {0.74f, 0.54f, 0.36f, 1f},  // planks
        {0.42f, 0.31f, 0.22f, 1f},  // log
        {0.45f, 0.62f, 0.33f, 1f},  // leaves
        {0.82f, 0.76f, 0.55f, 1f},  // sand
        {0.68f, 0.86f, 0.84f, 0.85f} // glass
    };

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

    /** Builds exposed-face geometry in metres relative to the island anchor. */
    Mesh buildMesh() {
        final float s = VOXEL_METERS;
        float[] positions = new float[4096 * 6 * 6 * 3];
        float[] colors = new float[4096 * 6 * 6 * 4];
        int p = 0;
        int c = 0;
        for (int y = 0; y < SIZE; y += 1) {
            for (int z = ORIGIN; z < ORIGIN + SIZE; z += 1) {
                for (int x = ORIGIN; x < ORIGIN + SIZE; x += 1) {
                    byte code = blocks[index(x, y, z)];
                    if (code == 0) continue;
                    float[] base = BLOCK_COLORS[code - 1];
                    float x0 = x * s, x1 = (x + 1) * s;
                    float y0 = y * s, y1 = (y + 1) * s;
                    float z0 = z * s, z1 = (z + 1) * s;
                    if (!isSolid(x, y + 1, z)) {
                        p = quad(positions, p, x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0);
                        c = colorQuad(colors, c, base, SHADE_TOP);
                    }
                    if (!isSolid(x, y - 1, z)) {
                        p = quad(positions, p, x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
                        c = colorQuad(colors, c, base, SHADE_BOTTOM);
                    }
                    if (!isSolid(x + 1, y, z)) {
                        p = quad(positions, p, x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0);
                        c = colorQuad(colors, c, base, SHADE_X);
                    }
                    if (!isSolid(x - 1, y, z)) {
                        p = quad(positions, p, x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1);
                        c = colorQuad(colors, c, base, SHADE_X);
                    }
                    if (!isSolid(x, y, z + 1)) {
                        p = quad(positions, p, x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1);
                        c = colorQuad(colors, c, base, SHADE_Z);
                    }
                    if (!isSolid(x, y, z - 1)) {
                        p = quad(positions, p, x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0);
                        c = colorQuad(colors, c, base, SHADE_Z);
                    }
                }
            }
        }
        return new Mesh(Arrays.copyOf(positions, p), Arrays.copyOf(colors, c), p / 3);
    }

    /**
     * Emits two triangles (six vertices) from four corners given in winding order.
     * Rendering uses GL_TRIANGLES, so a quad must be expanded here; emitting four
     * vertices would desynchronise the position and colour arrays.
     */
    private static int quad(float[] out, int offset,
                            float ax, float ay, float az,
                            float bx, float by, float bz,
                            float cx, float cy, float cz,
                            float dx, float dy, float dz) {
        offset = vertex(out, offset, ax, ay, az);
        offset = vertex(out, offset, bx, by, bz);
        offset = vertex(out, offset, cx, cy, cz);
        offset = vertex(out, offset, ax, ay, az);
        offset = vertex(out, offset, cx, cy, cz);
        offset = vertex(out, offset, dx, dy, dz);
        return offset;
    }

    private static int vertex(float[] out, int offset, float x, float y, float z) {
        out[offset] = x;
        out[offset + 1] = y;
        out[offset + 2] = z;
        return offset + 3;
    }

    private static int colorQuad(float[] out, int offset, float[] color, float shade) {
        for (int vertex = 0; vertex < 6; vertex += 1) {
            out[offset] = color[0] * shade;
            out[offset + 1] = color[1] * shade;
            out[offset + 2] = color[2] * shade;
            out[offset + 3] = color[3];
            offset += 4;
        }
        return offset;
    }

    static final class Mesh {
        final float[] positions;
        final float[] colors;
        final int vertexCount;

        Mesh(float[] positions, float[] colors, int vertexCount) {
            this.positions = positions;
            this.colors = colors;
            this.vertexCount = vertexCount;
        }
    }
}
