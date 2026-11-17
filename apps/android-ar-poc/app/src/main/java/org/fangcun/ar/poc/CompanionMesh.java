package org.fangcun.ar.poc;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * Procedural placeholder companion: a blocky fish built from axis-aligned boxes in
 * centimetre-scale metres. It exists so the AR scene has a visible character before any
 * licensed GLB asset is available; the renderer bobs and turns it to look alive.
 */
final class CompanionMesh {
    private static final int MAX_BOXES = 24;
    /** Distance from the body centre down to the lowest box, i.e. the feet. */
    private static final float FEET_OFFSET = 0.026f;
    private static final float SHADE_TOP = 1.0f;    private static final float SHADE_BOTTOM = 0.45f;
    private static final float SHADE_X = 0.80f;
    private static final float SHADE_Z = 0.62f;

    private static final float[] BODY = {0.98f, 0.62f, 0.24f, 1f};
    private static final float[] BELLY = {1.00f, 0.86f, 0.62f, 1f};
    private static final float[] FIN = {0.94f, 0.52f, 0.18f, 1f};
    private static final float[] EYE = {0.10f, 0.12f, 0.14f, 1f};
    private static final float[] CHEEK = {1.00f, 0.45f, 0.42f, 1f};

    static final class Mesh {
        final FloatBuffer positions;
        final FloatBuffer colors;
        final int vertexCount;

        Mesh(FloatBuffer positions, FloatBuffer colors, int vertexCount) {
            this.positions = positions;
            this.colors = colors;
            this.vertexCount = vertexCount;
        }
    }

    private CompanionMesh() { }

    /** Builds the fish mesh with its origin at the body centre and its nose toward +x. */
    static Mesh build() {
        float[] positions = new float[MAX_BOXES * 6 * 6 * 3];
        float[] colors = new float[MAX_BOXES * 6 * 6 * 4];
        int[] cursor = new int[2];

        box(positions, colors, cursor, 0f, 0f, 0f, 0.035f, 0.025f, 0.020f, BODY);
        box(positions, colors, cursor, 0.004f, -0.017f, 0f, 0.028f, 0.009f, 0.016f, BELLY);
        box(positions, colors, cursor, -0.044f, 0f, 0f, 0.012f, 0.018f, 0.008f, FIN);
        box(positions, colors, cursor, 0.002f, 0.028f, 0f, 0.014f, 0.008f, 0.005f, FIN);
        box(positions, colors, cursor, 0.004f, -0.004f, 0.023f, 0.012f, 0.007f, 0.006f, FIN);
        box(positions, colors, cursor, 0.004f, -0.004f, -0.023f, 0.012f, 0.007f, 0.006f, FIN);
        box(positions, colors, cursor, 0.030f, 0.010f, 0.013f, 0.005f, 0.005f, 0.004f, EYE);
        box(positions, colors, cursor, 0.030f, 0.010f, -0.013f, 0.005f, 0.005f, 0.004f, EYE);
        box(positions, colors, cursor, 0.020f, -0.002f, 0.017f, 0.004f, 0.003f, 0.003f, CHEEK);
        box(positions, colors, cursor, 0.020f, -0.002f, -0.017f, 0.004f, 0.003f, 0.003f, CHEEK);

        // The boxes are laid out around the body centre; shift them down to a feet origin so
        // the fallback avatar stands on the terrain instead of sinking into the grass.
        for (int index = 1; index < cursor[0]; index += 3) positions[index] += FEET_OFFSET;

        return new Mesh(direct(positions, cursor[0]), direct(colors, cursor[1]), cursor[0] / 3);
    }

    private static void box(float[] positions, float[] colors, int[] cursor,
                            float centreX, float centreY, float centreZ,
                            float halfX, float halfY, float halfZ,
                            float[] color) {
        float x0 = centreX - halfX, x1 = centreX + halfX;
        float y0 = centreY - halfY, y1 = centreY + halfY;
        float z0 = centreZ - halfZ, z1 = centreZ + halfZ;
        face(positions, colors, cursor, color, SHADE_TOP, x0, y1, z0, x0, y1, z1, x1, y1, z1, x1, y1, z0);
        face(positions, colors, cursor, color, SHADE_BOTTOM, x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
        face(positions, colors, cursor, color, SHADE_X, x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0);
        face(positions, colors, cursor, color, SHADE_X, x0, y0, z0, x0, y1, z0, x0, y1, z1, x0, y0, z1);
        face(positions, colors, cursor, color, SHADE_Z, x0, y0, z1, x0, y1, z1, x1, y1, z1, x1, y0, z1);
        face(positions, colors, cursor, color, SHADE_Z, x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0);
    }

    private static void face(float[] positions, float[] colors, int[] cursor, float[] color, float shade,
                             float ax, float ay, float az,
                             float bx, float by, float bz,
                             float cx, float cy, float cz,
                             float dx, float dy, float dz) {
        int p = cursor[0];
        p = vertex(positions, p, ax, ay, az);
        p = vertex(positions, p, bx, by, bz);
        p = vertex(positions, p, cx, cy, cz);
        p = vertex(positions, p, ax, ay, az);
        p = vertex(positions, p, cx, cy, cz);
        p = vertex(positions, p, dx, dy, dz);
        int c = cursor[1];
        for (int index = 0; index < 6; index += 1) {
            colors[c] = color[0] * shade;
            colors[c + 1] = color[1] * shade;
            colors[c + 2] = color[2] * shade;
            colors[c + 3] = color[3];
            c += 4;
        }
        cursor[0] = p;
        cursor[1] = c;
    }

    private static int vertex(float[] out, int offset, float x, float y, float z) {
        out[offset] = x;
        out[offset + 1] = y;
        out[offset + 2] = z;
        return offset + 3;
    }

    private static FloatBuffer direct(float[] values, int length) {
        FloatBuffer buffer = ByteBuffer.allocateDirect(length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        buffer.put(values, 0, length);
        buffer.position(0);
        return buffer;
    }
}
