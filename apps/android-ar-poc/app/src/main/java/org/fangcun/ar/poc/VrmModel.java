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
        final int vertexCount;
        /** Bind-pose positions in metres; skinning rewrites {@link #positions} from these. */
        final float[] restPositions;
        /** Four joint slots per vertex, already mapped to the skin's joint order. */
        final int[] joints;
        /** Four weights per vertex, normalised to sum to 1. */
        final float[] weights;

        Primitive(FloatBuffer positions, FloatBuffer normals, FloatBuffer uvs, ShortBuffer indices, int indexCount,
                  int textureId, int vertexCount, float[] restPositions, int[] joints, float[] weights) {
            this.positions = positions;
            this.normals = normals;
            this.uvs = uvs;
            this.indices = indices;
            this.indexCount = indexCount;
            this.textureId = textureId;
            this.vertexCount = vertexCount;
            this.restPositions = restPositions;
            this.joints = joints;
            this.weights = weights;
        }
    }

    private final List<Primitive> primitives = new ArrayList<>();
    private final float[] bounds = new float[6];
    private volatile boolean flipV;
    private SkinData skin;
    private float uniformScale = 1f;
    private float offsetX;
    private float offsetY;
    private float offsetZ;
    /** Rest-pose vertex used as the top-of-head anchor (model space, metres). */
    private float[] headTopRest;
    /** Posed top-of-head anchor in model space, refreshed by {@link #applyPose}. */
    private final float[] headTopModel = new float[3];
    /** Minimum posed vertex Y in model space, refreshed by {@link #applyPose} (floor clamp). */
    private float posedMinY = Float.MAX_VALUE;

    private VrmModel() { }

    int primitiveCount() { return primitives.size(); }

    void setFlipV(boolean value) { flipV = value; }

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
                String materialName = primitive.has("material") && materials != null
                    ? materials.optJSONObject(primitive.optInt("material", -1)) == null ? "?" : materials.optJSONObject(primitive.optInt("material", -1)).optString("name", "?")
                    : "(none)";
                Log.i(TAG, "primitive mesh=" + meshIndex + " material=" + materialName + " verts=" + vertexCount
                    + " indices=" + indexArray.length + " textureId=" + textureId);
                int[] joints = attributes.has("JOINTS_0") ? readJoints(gltf, bin, attributes.getInt("JOINTS_0"), vertexCount) : null;
                float[] weights = attributes.has("WEIGHTS_0") ? readWeights(gltf, bin, attributes.getInt("WEIGHTS_0"), vertexCount) : null;
                if (joints == null || weights == null) {
                    joints = new int[vertexCount * 4];
                    weights = new float[vertexCount * 4];
                    for (int vertex = 0; vertex < vertexCount; vertex += 1) weights[vertex * 4] = 1f;
                }
                normalizeWeights(weights, vertexCount);

                model.primitives.add(new Primitive(
                    direct(positions),
                    direct(normals),
                    direct(uvs),
                    directIndices(indexArray),
                    indexArray.length,
                    textureId,
                    vertexCount,
                    positions.clone(),
                    joints,
                    weights));
            }
        }

        if (model.primitives.isEmpty()) throw new IllegalStateException("no triangle primitives");
        model.skin = parseSkin(gltf, bin);
        model.bounds[0] = minX;
        model.bounds[1] = minY;
        model.bounds[2] = minZ;
        model.bounds[3] = maxX;
        model.bounds[4] = maxY;
        model.bounds[5] = maxZ;
        model.posedMinY = minY;
        model.findHeadTopAnchor();
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

    void draw(int program, int positionHandle, int normalHandle, int uvHandle, int textureHandle, int useTextureHandle, int flipVHandle) {
        // glTF UVs have their origin at the image's top-left while GL textures start bottom-left.
        GLES20.glUniform1f(flipVHandle, flipV ? 1f : 0f);
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
        if (bitmap == null) {
            Log.w(TAG, "texture decode failed: " + probe.outWidth + "x" + probe.outHeight + " sample=" + options.inSampleSize + " bytes=" + png.length);
            return 0;
        }
        Log.i(TAG, "texture " + probe.outWidth + "x" + probe.outHeight + " -> " + bitmap.getWidth() + "x" + bitmap.getHeight() + " sample=" + options.inSampleSize);
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

    /**
     * Skeleton needed to pose the avatar: the node graph, the skin's joint order with its
     * inverse bind matrices, and the humanoid bone names VRM guarantees.
     */
    private static final class SkinData {
        final int nodeCount;
        final int[] parent;
        final int[] order;
        final float[][] localT;
        final float[][] localR;
        final float[][] localS;
        final int[] jointNodes;
        final float[] inverseBind;
        final int[] slotOfNode;
        final java.util.Map<String, Integer> boneNode;

        SkinData(int nodeCount, int[] parent, int[] order, float[][] localT, float[][] localR, float[][] localS,
                 int[] jointNodes, float[] inverseBind, int[] slotOfNode, java.util.Map<String, Integer> boneNode) {
            this.nodeCount = nodeCount;
            this.parent = parent;
            this.order = order;
            this.localT = localT;
            this.localR = localR;
            this.localS = localS;
            this.jointNodes = jointNodes;
            this.inverseBind = inverseBind;
            this.slotOfNode = slotOfNode;
            this.boneNode = boneNode;
        }
    }

    private static SkinData parseSkin(JSONObject gltf, ByteBuffer bin) throws JSONException {
        JSONArray skins = gltf.optJSONArray("skins");
        if (skins == null || skins.length() == 0) return null;
        JSONObject skin = skins.getJSONObject(0);
        JSONArray jointNodesJson = skin.getJSONArray("joints");
        int jointCount = jointNodesJson.length();
        int[] jointNodes = new int[jointCount];
        for (int index = 0; index < jointCount; index += 1) jointNodes[index] = jointNodesJson.getInt(index);

        float[] inverseBind = new float[jointCount * 16];
        if (skin.has("inverseBindMatrices")) {
            float[] raw = readFloats(gltf, bin, skin.getInt("inverseBindMatrices"), 16);
            System.arraycopy(raw, 0, inverseBind, 0, Math.min(raw.length, inverseBind.length));
        } else {
            for (int joint = 0; joint < jointCount; joint += 1) {
                inverseBind[joint * 16] = 1f;
                inverseBind[joint * 16 + 5] = 1f;
                inverseBind[joint * 16 + 10] = 1f;
                inverseBind[joint * 16 + 15] = 1f;
            }
        }

        JSONArray nodes = gltf.getJSONArray("nodes");
        int nodeCount = nodes.length();
        float[][] localT = new float[nodeCount][3];
        float[][] localR = new float[nodeCount][4];
        float[][] localS = new float[nodeCount][3];
        int[] parent = new int[nodeCount];
        java.util.Arrays.fill(parent, -1);
        java.util.List<java.util.List<Integer>> children = new ArrayList<>();
        for (int index = 0; index < nodeCount; index += 1) children.add(new ArrayList<>());
        for (int index = 0; index < nodeCount; index += 1) {
            JSONObject node = nodes.getJSONObject(index);
            JSONArray translation = node.optJSONArray("translation");
            JSONArray rotation = node.optJSONArray("rotation");
            JSONArray scale = node.optJSONArray("scale");
            localT[index] = translation == null ? new float[] {0f, 0f, 0f} : new float[] {
                (float) translation.getDouble(0), (float) translation.getDouble(1), (float) translation.getDouble(2)};
            localR[index] = rotation == null ? new float[] {0f, 0f, 0f, 1f} : new float[] {
                (float) rotation.getDouble(0), (float) rotation.getDouble(1),
                (float) rotation.getDouble(2), (float) rotation.getDouble(3)};
            localS[index] = scale == null ? new float[] {1f, 1f, 1f} : new float[] {
                (float) scale.getDouble(0), (float) scale.getDouble(1), (float) scale.getDouble(2)};
            JSONArray nodeChildren = node.optJSONArray("children");
            if (nodeChildren != null) {
                for (int childIndex = 0; childIndex < nodeChildren.length(); childIndex += 1) {
                    int child = nodeChildren.getInt(childIndex);
                    parent[child] = index;
                    children.get(index).add(child);
                }
            }
        }

        // Parents before children, so world matrices can be composed in one pass.
        int[] order = new int[nodeCount];
        int cursor = 0;
        java.util.ArrayDeque<Integer> stack = new java.util.ArrayDeque<>();
        for (int index = 0; index < nodeCount; index += 1) if (parent[index] < 0) stack.push(index);
        while (!stack.isEmpty()) {
            int node = stack.pop();
            order[cursor++] = node;
            java.util.List<Integer> kids = children.get(node);
            for (int index = kids.size() - 1; index >= 0; index -= 1) stack.push(kids.get(index));
        }
        for (int index = cursor; index < nodeCount; index += 1) order[index] = index;

        int[] slotOfNode = new int[nodeCount];
        java.util.Arrays.fill(slotOfNode, -1);
        for (int slot = 0; slot < jointCount; slot += 1) {
            int node = jointNodes[slot];
            if (node >= 0 && node < nodeCount) slotOfNode[node] = slot;
        }

        java.util.Map<String, Integer> boneNode = new java.util.HashMap<>();
        JSONObject extensions = gltf.optJSONObject("extensions");
        JSONObject vrm = extensions == null ? null : extensions.optJSONObject("VRMC_vrm");
        JSONObject humanoid = vrm == null ? null : vrm.optJSONObject("humanoid");
        JSONObject humanBones = humanoid == null ? null : humanoid.optJSONObject("humanBones");
        if (humanBones != null) {
            java.util.Iterator<String> keys = humanBones.keys();
            while (keys.hasNext()) {
                String bone = keys.next();
                JSONObject entry = humanBones.optJSONObject(bone);
                if (entry != null && entry.has("node")) boneNode.put(bone, entry.getInt("node"));
            }
        }
        return new SkinData(nodeCount, parent, order, localT, localR, localS, jointNodes, inverseBind, slotOfNode, boneNode);
    }

    boolean hasSkin() { return skin != null; }

    /**
     * Rest-pose vertex that sits on top of the head and is mostly driven by the head bone. The
     * nameplate/speech-bubble anchor is that vertex skinned by the current pose, so it follows the
     * head through sit/lie/jump instead of assuming the standing height.
     */
    private void findHeadTopAnchor() {
        SkinData s = skin;
        if (s == null) return;
        Integer headNode = s.boneNode.get("head");
        if (headNode == null || headNode < 0 || headNode >= s.slotOfNode.length) return;
        int headSlot = s.slotOfNode[headNode];
        if (headSlot < 0) return;
        float bestY = -Float.MAX_VALUE;
        for (Primitive primitive : primitives) {
            for (int vertex = 0; vertex < primitive.vertexCount; vertex += 1) {
                float headWeight = 0f;
                for (int influence = 0; influence < 4; influence += 1) {
                    if (primitive.joints[vertex * 4 + influence] == headSlot) {
                        headWeight += primitive.weights[vertex * 4 + influence];
                    }
                }
                if (headWeight < 0.5f) continue;
                float y = primitive.restPositions[vertex * 3 + 1];
                if (y > bestY) {
                    bestY = y;
                    headTopRest = new float[] {
                        primitive.restPositions[vertex * 3], y, primitive.restPositions[vertex * 3 + 2]};
                }
            }
        }
        if (headTopRest == null) {
            headTopRest = new float[] {(bounds[0] + bounds[3]) * 0.5f, bounds[4], (bounds[2] + bounds[5]) * 0.5f};
        }
        headTopModel[0] = headTopRest[0];
        headTopModel[1] = headTopRest[1];
        headTopModel[2] = headTopRest[2];
    }

    /** Posed top-of-head anchor in model space (metres); follows the current pose. */
    void headTop(float[] out) {
        System.arraycopy(headTopModel, 0, out, 0, 3);
    }

    /**
     * Minimum Y of all skinned vertices in model space for the pose applied last. The renderer
     * uses it to lift the object so no pose (sit/lie/walk) pushes the mesh through the terrain.
     */
    float posedMinY() {
        return posedMinY;
    }

    /**
     * Re-skins the mesh for a procedural pose. {@code boneRotations} maps VRM humanoid bone
     * names to an axis-angle rotation in the bone's local space; {@code hipsOffset} is a
     * translation in bind units applied to the hips bone.
     */
    void applyPose(java.util.Map<String, float[]> boneRotations, float[] hipsOffset) {
        SkinData s = skin;
        if (s == null) return;
        int nodeCount = s.nodeCount;
        float[][] local = new float[nodeCount][16];
        int hipsNode = s.boneNode.getOrDefault("hips", -1);
        for (int node = 0; node < nodeCount; node += 1) {
            float[] rotation = s.localR[node];
            float qx = rotation[0], qy = rotation[1], qz = rotation[2], qw = rotation[3];
            float[] extra = boneRotations == null ? null : lookupBone(s, boneRotations, node);
            if (extra != null) {
                float ex = extra[0], ey = extra[1], ez = extra[2], ew = extra[3];
                float nx = ew * qx + ex * qw + ey * qz - ez * qy;
                float ny = ew * qy - ex * qz + ey * qw + ez * qx;
                float nz = ew * qz + ex * qy - ey * qx + ez * qw;
                float nw = ew * qw - ex * qx - ey * qy - ez * qz;
                qx = nx; qy = ny; qz = nz; qw = nw;
            }
            float tx = s.localT[node][0];
            float ty = s.localT[node][1];
            float tz = s.localT[node][2];
            if (node == hipsNode && hipsOffset != null) {
                tx += hipsOffset[0];
                ty += hipsOffset[1];
                tz += hipsOffset[2];
            }
            composeTRS(local[node], tx, ty, tz, qx, qy, qz, qw, s.localS[node][0], s.localS[node][1], s.localS[node][2]);
        }

        float[][] world = new float[nodeCount][16];
        for (int index = 0; index < nodeCount; index += 1) {
            int node = s.order[index];
            int parent = s.parent[node];
            if (parent < 0) System.arraycopy(local[node], 0, world[node], 0, 16);
            else android.opengl.Matrix.multiplyMM(world[node], 0, world[parent], 0, local[node], 0);
        }

        int jointCount = s.jointNodes.length;
        float[][] joints = new float[jointCount][16];
        for (int slot = 0; slot < jointCount; slot += 1) {
            int node = s.jointNodes[slot];
            if (node < 0 || node >= nodeCount) {
                android.opengl.Matrix.setIdentityM(joints[slot], 0);
                continue;
            }
            android.opengl.Matrix.multiplyMM(joints[slot], 0, world[node], 0, s.inverseBind, slot * 16);
        }

        // Track the top-of-head anchor through the same skinning matrix as the head vertices.
        if (headTopRest != null) {
            Integer headNode = s.boneNode.get("head");
            if (headNode != null && headNode >= 0 && headNode < s.slotOfNode.length) {
                int headSlot = s.slotOfNode[headNode];
                if (headSlot >= 0 && headSlot < jointCount) {
                    float[] m = joints[headSlot];
                    float x = headTopRest[0];
                    float y = headTopRest[1];
                    float z = headTopRest[2];
                    headTopModel[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
                    headTopModel[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
                    headTopModel[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
                }
            }
        }

        float minPosedY = Float.MAX_VALUE;
        for (Primitive primitive : primitives) {
            float[] rest = primitive.restPositions;
            int[] vertexJoints = primitive.joints;
            float[] vertexWeights = primitive.weights;
            FloatBuffer out = primitive.positions;
            for (int vertex = 0; vertex < primitive.vertexCount; vertex += 1) {
                float px = rest[vertex * 3];
                float py = rest[vertex * 3 + 1];
                float pz = rest[vertex * 3 + 2];
                float sx = 0f, sy = 0f, sz = 0f;
                for (int influence = 0; influence < 4; influence += 1) {
                    float weight = vertexWeights[vertex * 4 + influence];
                    if (weight == 0f) continue;
                    int slot = vertexJoints[vertex * 4 + influence];
                    if (slot < 0 || slot >= jointCount) continue;
                    float[] m = joints[slot];
                    sx += weight * (m[0] * px + m[4] * py + m[8] * pz + m[12]);
                    sy += weight * (m[1] * px + m[5] * py + m[9] * pz + m[13]);
                    sz += weight * (m[2] * px + m[6] * py + m[10] * pz + m[14]);
                }
                out.put(vertex * 3, sx);
                out.put(vertex * 3 + 1, sy);
                out.put(vertex * 3 + 2, sz);
                if (sy < minPosedY) minPosedY = sy;
            }
            out.position(0);
        }
        posedMinY = minPosedY == Float.MAX_VALUE ? bounds[1] : minPosedY;
    }

    private static float[] lookupBone(SkinData skin, java.util.Map<String, float[]> rotations, int node) {
        for (java.util.Map.Entry<String, float[]> entry : rotations.entrySet()) {
            Integer target = skin.boneNode.get(entry.getKey());
            if (target != null && target == node) return entry.getValue();
        }
        return null;
    }

    /** Column-major T*R*S for a unit quaternion. */
    private static void composeTRS(float[] out, float tx, float ty, float tz,
                                   float qx, float qy, float qz, float qw,
                                   float sx, float sy, float sz) {
        float x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
        float xx = qx * x2, xy = qx * y2, xz = qx * z2;
        float yy = qy * y2, yz = qy * z2, zz = qz * z2;
        float wx = qw * x2, wy = qw * y2, wz = qw * z2;
        out[0] = (1f - (yy + zz)) * sx;
        out[1] = (xy + wz) * sx;
        out[2] = (xz - wy) * sx;
        out[3] = 0f;
        out[4] = (xy - wz) * sy;
        out[5] = (1f - (xx + zz)) * sy;
        out[6] = (yz + wx) * sy;
        out[7] = 0f;
        out[8] = (xz + wy) * sz;
        out[9] = (yz - wx) * sz;
        out[10] = (1f - (xx + yy)) * sz;
        out[11] = 0f;
        out[12] = tx;
        out[13] = ty;
        out[14] = tz;
        out[15] = 1f;
    }

    /** Quaternion for an axis-angle rotation, used by the pose tables. */
    static float[] axisAngle(float x, float y, float z, float degrees) {
        double radians = Math.toRadians(degrees) * 0.5;
        double length = Math.sqrt(x * x + y * y + z * z);
        if (length < 1e-6) return new float[] {0f, 0f, 0f, 1f};
        float sin = (float) Math.sin(radians);
        return new float[] {(float) (x / length) * sin, (float) (y / length) * sin, (float) (z / length) * sin, (float) Math.cos(radians)};
    }

    private static int[] readJoints(JSONObject gltf, ByteBuffer bin, int accessorIndex, int vertexCount) throws JSONException {
        JSONArray accessors = gltf.getJSONArray("accessors");
        JSONObject accessor = accessors.getJSONObject(accessorIndex);
        int bufferViewIndex = accessor.getInt("bufferView");
        JSONObject view = gltf.getJSONArray("bufferViews").getJSONObject(bufferViewIndex);
        int start = view.optInt("byteOffset", 0) + accessor.optInt("byteOffset", 0);
        int stride = view.optInt("byteStride", 4);
        int componentType = accessor.getInt("componentType");
        int[] out = new int[vertexCount * 4];
        ByteBuffer slice = bin.duplicate().order(ByteOrder.LITTLE_ENDIAN);
        for (int vertex = 0; vertex < vertexCount; vertex += 1) {
            slice.position(start + vertex * stride);
            for (int component = 0; component < 4; component += 1) {
                out[vertex * 4 + component] = componentType == 5123 ? (slice.getShort() & 0xffff) : (slice.get() & 0xff);
            }
        }
        return out;
    }

    private static float[] readWeights(JSONObject gltf, ByteBuffer bin, int accessorIndex, int vertexCount) throws JSONException {
        JSONArray accessors = gltf.getJSONArray("accessors");
        JSONObject accessor = accessors.getJSONObject(accessorIndex);
        int componentType = accessor.getInt("componentType");
        if (componentType == 5126) return readFloats(gltf, bin, accessorIndex, 4);
        int bufferViewIndex = accessor.getInt("bufferView");
        JSONObject view = gltf.getJSONArray("bufferViews").getJSONObject(bufferViewIndex);
        int start = view.optInt("byteOffset", 0) + accessor.optInt("byteOffset", 0);
        int stride = view.optInt("byteStride", 8);
        float[] out = new float[vertexCount * 4];
        ByteBuffer slice = bin.duplicate().order(ByteOrder.LITTLE_ENDIAN);
        for (int vertex = 0; vertex < vertexCount; vertex += 1) {
            slice.position(start + vertex * stride);
            for (int component = 0; component < 4; component += 1) {
                out[vertex * 4 + component] = componentType == 5121 ? (slice.get() & 0xff) / 255f : (slice.getShort() & 0xffff) / 65535f;
            }
        }
        return out;
    }

    private static void normalizeWeights(float[] weights, int vertexCount) {
        for (int vertex = 0; vertex < vertexCount; vertex += 1) {
            float sum = 0f;
            for (int component = 0; component < 4; component += 1) sum += weights[vertex * 4 + component];
            if (sum <= 1e-6f) {
                weights[vertex * 4] = 1f;
                continue;
            }
            for (int component = 0; component < 4; component += 1) weights[vertex * 4 + component] /= sum;
        }
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
