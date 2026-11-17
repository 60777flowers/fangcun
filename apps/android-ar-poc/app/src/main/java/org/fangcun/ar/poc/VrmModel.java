package org.fangcun.ar.poc;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.opengl.GLES20;
import android.opengl.GLUtils;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.nio.ShortBuffer;
import java.util.ArrayList;
import java.util.List;

/**
 * Minimal glTF 2.0 / VRM 1.0 loader for a single static avatar.
 *
 * The shipped model contains no animation clips and every primitive is skinned at bind
 * pose, so skinning would resolve to identity. We therefore draw the bind-pose mesh with
 * its base-colour textures and animate the whole object instead of the skeleton. Skeletal
 * playback is a later step; the calling renderer only needs a drawable mesh plus bounds.
 */
final class VrmModel {
    private static final String TAG = "VrmModel";
    private static final int MAX_TEXTURE_EDGE = 768;

    static final class Primitive {
        final FloatBuffer positions;
        final FloatBuffer normals;
        final FloatBuffer uvs;
        final ShortBuffer indices;
        final int indexCount;
        final int textureId;

        Primitive(FloatBuffer positions, FloatBuffer normals, FloatBuffer uvs, ShortBuffer indices, int indexCount, int textureId) {
            this.positions = positions;
            this.normals = normals;
            this.uvs = uvs;
            this.indices = indices;
            this.indexCount = indexCount;
            this.textureId = textureId;
        }
    }

    private final List<Primitive> primitives = new ArrayList<>();
    private final float[] bounds = new float[6];
    private float uniformScale = 1f;
    private float offsetX;
    private float offsetY;
    private float offsetZ;

    private VrmModel() { }

    int primitiveCount() { return primitives.size(); }

    static VrmModel load(Context context, String assetPath) {
        byte[] bytes;
        try (InputStream stream = context.getAssets().open(assetPath)) {
            // Assets may be deflated by aapt, so never trust available() as the exact length.
            java.io.ByteArrayOutputStream sink = new java.io.ByteArrayOutputStream(1 << 20);
            byte[] scratch = new byte[64 * 1024];
            int read;
            while ((read = stream.read(scratch)) > 0) sink.write(scratch, 0, read);
            bytes = sink.toByteArray();
        } catch (IOException error) {
            Log.w(TAG, "companion asset missing: " + assetPath);
            return null;
        }

        ByteBuffer glb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        if (glb.getInt(0) != 0x46546C67) {
            Log.w(TAG, "not a GLB file");
            return null;
        }
        JSONObject gltf = null;
        ByteBuffer bin = null;
        int offset = 12;
        while (offset + 8 <= glb.capacity()) {
            int chunkLength = glb.getInt(offset);
            int chunkType = glb.getInt(offset + 4);
            int bodyStart = offset + 8;
            if (chunkType == 0x4E4F534A) {
                byte[] json = new byte[chunkLength];
                glb.position(bodyStart);
                glb.get(json);
                try {
                    gltf = new JSONObject(new String(json, java.nio.charset.StandardCharsets.UTF_8));
                } catch (JSONException error) {
                    Log.w(TAG, "invalid glTF JSON: " + error.getMessage());
                    return null;
                }
            } else if (chunkType == 0x004E4942) {
                // Keep a view over the original bytes: copying an 18 MB BIN chunk twice was
                // enough to run the app out of heap on the GL thread.
                ByteBuffer whole = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
                whole.position(bodyStart);
                whole.limit(bodyStart + chunkLength);
                bin = whole.slice().order(ByteOrder.LITTLE_ENDIAN);
            }
            offset = bodyStart + chunkLength;
        }
        if (gltf == null || bin == null) {
            Log.w(TAG, "GLB is missing its JSON or BIN chunk");
            return null;
        }

        try {
            return build(gltf, bin);
        } catch (JSONException | RuntimeException error) {
            Log.w(TAG, "failed to build VRM: " + error);
            return null;
        }
    }

    private static VrmModel build(JSONObject gltf, ByteBuffer bin) throws JSONException {
        VrmModel model = new VrmModel();
        JSONArray meshes = gltf.getJSONArray("meshes");
        JSONArray materials = gltf.optJSONArray("materials");
        JSONArray textures = gltf.optJSONArray("textures");
        JSONArray images = gltf.optJSONArray("images");
        JSONArray bufferViews = gltf.getJSONArray("bufferViews");

        int[] textureCache = new int[images == null ? 0 : images.length()];
        java.util.Arrays.fill(textureCache, -1);

        float minX = Float.MAX_VALUE, minY = Float.MAX_VALUE, minZ = Float.MAX_VALUE;
        float maxX = -Float.MAX_VALUE, maxY = -Float.MAX_VALUE, maxZ = -Float.MAX_VALUE;

        for (int meshIndex = 0; meshIndex < meshes.length(); meshIndex += 1) {
            JSONArray primitives = meshes.getJSONObject(meshIndex).getJSONArray("primitives");
            for (int primIndex = 0; primIndex < primitives.length(); primIndex += 1) {
                JSONObject primitive = primitives.getJSONObject(primIndex);
                int mode = primitive.optInt("mode", 4);
                if (mode != 4) continue;
                JSONObject attributes = primitive.getJSONObject("attributes");
                if (!attributes.has("POSITION")) continue;

                float[] positions = readFloats(gltf, bin, attributes.getInt("POSITION"), 3);
                float[] normals = attributes.has("NORMAL") ? readFloats(gltf, bin, attributes.getInt("NORMAL"), 3) : null;
                float[] uvs = attributes.has("TEXCOORD_0") ? readFloats(gltf, bin, attributes.getInt("TEXCOORD_0"), 2) : null;
                int vertexCount = positions.length / 3;
                if (normals == null) normals = new float[positions.length];
                if (uvs == null) uvs = new float[vertexCount * 2];

                int[] indexArray = primitive.has("indices")
                    ? readIndices(gltf, bin, primitive.getInt("indices"))
                    : sequentialIndices(vertexCount);
                if (indexArray.length == 0) continue;
                if (vertexCount > 65_535) {
                    Log.w(TAG, "primitive has too many vertices for 16-bit indices; skipped");
                    continue;
                }
                // Cheap validation keeps a malformed or misread file from making the GPU
                // fetch out of bounds, which surfaces as a driver SIGSEGV.
                int maxIndex = 0;
                for (int value : indexArray) if (value > maxIndex) maxIndex = value;
                if (maxIndex >= vertexCount) {
                    Log.w(TAG, "index " + maxIndex + " out of range for " + vertexCount + " vertices; skipped");
                    continue;
                }
                if (!allFinite(positions)) {
                    Log.w(TAG, "non-finite vertex positions; skipped");
                    continue;
                }

                for (int vertex = 0; vertex < vertexCount; vertex += 1) {
                    float x = positions[vertex * 3];
                    float y = positions[vertex * 3 + 1];
                    float z = positions[vertex * 3 + 2];
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (z < minZ) minZ = z;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                    if (z > maxZ) maxZ = z;
                }

                int textureId = resolveTexture(gltf, materials, textures, images, bufferViews, bin, primitive.optInt("material", -1), textureCache);
                model.primitives.add(new Primitive(
                    direct(positions),
                    direct(normals),
                    direct(uvs),
                    directIndices(indexArray),
                    indexArray.length,
                    textureId));            }
        }

        if (model.primitives.isEmpty()) throw new IllegalStateException("no triangle primitives");
        model.bounds[0] = minX;
        model.bounds[1] = minY;
        model.bounds[2] = minZ;
        model.bounds[3] = maxX;
        model.bounds[4] = maxY;
        model.bounds[5] = maxZ;
        return model;
    }

    /**
     * Normalises the avatar so its feet sit at local y=0 and its height equals targetHeight.
     * The source model is a metre-scale VRM avatar, far larger than the 3 cm voxel world.
     */
    void normalise(float targetHeight) {
        float height = Math.max(bounds[4] - bounds[1], 1e-4f);
        uniformScale = targetHeight / height;
        offsetX = -(bounds[0] + bounds[3]) * 0.5f;
        offsetY = -bounds[1];
        offsetZ = -(bounds[2] + bounds[5]) * 0.5f;
    }

    float scale() { return uniformScale; }
    float offsetX() { return offsetX; }
    float offsetY() { return offsetY; }
    float offsetZ() { return offsetZ; }

    void draw(int program, int positionHandle, int normalHandle, int uvHandle, int textureHandle, int useTextureHandle) {
        for (Primitive primitive : primitives) {
            if (primitive.textureId > 0) {
                GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, primitive.textureId);
                GLES20.glUniform1i(textureHandle, 0);
                GLES20.glUniform1f(useTextureHandle, 1f);
            } else {
                GLES20.glUniform1f(useTextureHandle, 0f);
            }
            primitive.positions.position(0);
            GLES20.glEnableVertexAttribArray(positionHandle);
            GLES20.glVertexAttribPointer(positionHandle, 3, GLES20.GL_FLOAT, false, 0, primitive.positions);
            primitive.normals.position(0);
            GLES20.glEnableVertexAttribArray(normalHandle);
            GLES20.glVertexAttribPointer(normalHandle, 3, GLES20.GL_FLOAT, false, 0, primitive.normals);
            primitive.uvs.position(0);
            GLES20.glEnableVertexAttribArray(uvHandle);
            GLES20.glVertexAttribPointer(uvHandle, 2, GLES20.GL_FLOAT, false, 0, primitive.uvs);
            primitive.indices.position(0);
            // 16-bit indices only: GLES2 needs OES_element_index_uint for 32-bit indices and
            // drivers hard-crash instead of erroring when it is missing.
            GLES20.glDrawElements(GLES20.GL_TRIANGLES, primitive.indexCount, GLES20.GL_UNSIGNED_SHORT, primitive.indices);
        }
        GLES20.glDisableVertexAttribArray(positionHandle);
        GLES20.glDisableVertexAttribArray(normalHandle);
        GLES20.glDisableVertexAttribArray(uvHandle);
    }

    void release() {
        for (Primitive primitive : primitives) {
            if (primitive.textureId > 0) {
                int[] ids = {primitive.textureId};
                GLES20.glDeleteTextures(1, ids, 0);
            }
        }
        primitives.clear();
    }

    private static int resolveTexture(JSONObject gltf, JSONArray materials, JSONArray textures, JSONArray images,
                                      JSONArray bufferViews, ByteBuffer bin, int materialIndex, int[] cache) throws JSONException {
        if (materialIndex < 0 || materials == null || textures == null || images == null) return 0;
        JSONObject material = materials.optJSONObject(materialIndex);
        if (material == null) return 0;
        JSONObject pbr = material.optJSONObject("pbrMetallicRoughness");
        JSONObject baseColor = pbr == null ? null : pbr.optJSONObject("baseColorTexture");
        if (baseColor == null) return 0;
        int textureIndex = baseColor.optInt("index", -1);
        if (textureIndex < 0) return 0;
        JSONObject texture = textures.optJSONObject(textureIndex);
        if (texture == null) return 0;
        int imageIndex = texture.optInt("source", -1);
        if (imageIndex < 0 || imageIndex >= cache.length) return 0;
        if (cache[imageIndex] >= 0) return cache[imageIndex];

        JSONObject image = images.optJSONObject(imageIndex);
        if (image == null || !image.has("bufferView")) return 0;
        JSONObject view = bufferViews.getJSONObject(image.getInt("bufferView"));
        int start = view.optInt("byteOffset", 0);
        int length = view.getInt("byteLength");
        byte[] png = new byte[length];
        ByteBuffer slice = bin.duplicate();
        slice.position(start);
        slice.get(png);
        int textureId = uploadTexture(png);
        cache[imageIndex] = textureId;
        return textureId;
    }

    private static int uploadTexture(byte[] png) {
        BitmapFactory.Options probe = new BitmapFactory.Options();
        probe.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(png, 0, png.length, probe);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        int longest = Math.max(probe.outWidth, probe.outHeight);
        while (longest / options.inSampleSize > MAX_TEXTURE_EDGE) options.inSampleSize *= 2;
        Bitmap bitmap = BitmapFactory.decodeByteArray(png, 0, png.length, options);
        if (bitmap == null) return 0;
        int[] ids = new int[1];
        GLES20.glGenTextures(1, ids, 0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, ids[0]);
        // NPOT-safe parameters: no mipmaps and clamped wrapping, which GLES2 requires for
        // non-power-of-two textures.
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
        GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bitmap, 0);
        bitmap.recycle();
        return ids[0];
    }

    private static float[] readFloats(JSONObject gltf, ByteBuffer bin, int accessorIndex, int components) throws JSONException {
        JSONArray accessors = gltf.getJSONArray("accessors");
        JSONObject accessor = accessors.getJSONObject(accessorIndex);
        int count = accessor.getInt("count");
        int bufferViewIndex = accessor.getInt("bufferView");
        JSONArray bufferViews = gltf.getJSONArray("bufferViews");
        JSONObject view = bufferViews.getJSONObject(bufferViewIndex);
        int viewOffset = view.optInt("byteOffset", 0);
        int accessorOffset = accessor.optInt("byteOffset", 0);
        int stride = view.optInt("byteStride", components * 4);
        int start = viewOffset + accessorOffset;
        float[] out = new float[count * components];
        // duplicate() is not required to inherit the byte order, so set it explicitly;
        // big-endian reads produced garbage positions and indices.
        ByteBuffer slice = bin.duplicate().order(ByteOrder.LITTLE_ENDIAN);
        for (int index = 0; index < count; index += 1) {
            slice.position(start + index * stride);
            for (int part = 0; part < components; part += 1) {
                out[index * components + part] = slice.getFloat();
            }
        }
        return out;
    }

    private static int[] readIndices(JSONObject gltf, ByteBuffer bin, int accessorIndex) throws JSONException {
        JSONArray accessors = gltf.getJSONArray("accessors");
        JSONObject accessor = accessors.getJSONObject(accessorIndex);
        int count = accessor.getInt("count");
        int componentType = accessor.getInt("componentType");
        int bufferViewIndex = accessor.getInt("bufferView");
        JSONArray bufferViews = gltf.getJSONArray("bufferViews");
        JSONObject view = bufferViews.getJSONObject(bufferViewIndex);
        int start = view.optInt("byteOffset", 0) + accessor.optInt("byteOffset", 0);
        int[] out = new int[count];
        ByteBuffer slice = bin.duplicate().order(ByteOrder.LITTLE_ENDIAN);
        for (int index = 0; index < count; index += 1) {
            int position = start;
            if (componentType == 5125) {
                position += index * 4;
                slice.position(position);
                out[index] = slice.getInt();
            } else if (componentType == 5123) {
                position += index * 2;
                slice.position(position);
                out[index] = slice.getShort() & 0xffff;
            } else {
                position += index;
                slice.position(position);
                out[index] = slice.get() & 0xff;
            }
        }
        return out;
    }

    private static int[] sequentialIndices(int vertexCount) {
        int[] indices = new int[vertexCount];
        for (int index = 0; index < vertexCount; index += 1) indices[index] = index;
        return indices;
    }

    private static FloatBuffer direct(float[] values) {
        FloatBuffer buffer = ByteBuffer.allocateDirect(values.length * 4).order(ByteOrder.nativeOrder()).asFloatBuffer();
        buffer.put(values);
        buffer.position(0);
        return buffer;
    }

    private static boolean allFinite(float[] values) {
        for (float value : values) {
            if (Float.isNaN(value) || Float.isInfinite(value)) return false;
        }
        return true;
    }

    private static ShortBuffer directIndices(int[] values) {
        ShortBuffer buffer = ByteBuffer.allocateDirect(values.length * 2).order(ByteOrder.nativeOrder()).asShortBuffer();
        for (int index = 0; index < values.length; index += 1) buffer.put((short) values[index]);
        buffer.position(0);
        return buffer;
    }
}
