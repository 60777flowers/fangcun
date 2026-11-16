package org.fangcun.ar.poc;

import android.content.Context;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import com.google.ar.core.Frame;
import com.google.ar.core.Session;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/** Camera background renderer adapted from the official ARCore Hello AR GLES sample pattern. */
final class BackgroundRenderer {
    private static final int FLOAT_BYTES = 4;
    private static final float[] UV = {0f,1f, 1f,1f, 1f,0f, 0f,1f, 1f,0f, 0f,0f};
    private final FloatBuffer uv = direct(UV);
    private int textureId;
    private int program;
    private int position;
    private int texCoord;
    private int textureUniform;
    private final FloatBuffer transformedUv = ByteBuffer.allocateDirect(12 * FLOAT_BYTES).order(ByteOrder.nativeOrder()).asFloatBuffer();
    private final FloatBuffer positions = direct(new float[]{-1f,-1f, 1f,-1f, 1f,1f, -1f,-1f, 1f,1f, -1f,1f});
    private final FloatBuffer interleaved = ByteBuffer.allocateDirect(6 * 5 * FLOAT_BYTES).order(ByteOrder.nativeOrder()).asFloatBuffer();

    void createOnGlThread(Context context) {
        int[] textures = new int[1];
        GLES20.glGenTextures(1, textures, 0);
        textureId = textures[0];
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
        program = link(VERTEX, FRAGMENT);
        position = GLES20.glGetAttribLocation(program, "a_Position");
        texCoord = GLES20.glGetAttribLocation(program, "a_TexCoord");
        textureUniform = GLES20.glGetUniformLocation(program, "s_Camera");
    }

    int textureId() { return textureId; }

    void attachToSession(Session session) {
        if (textureId == 0) throw new IllegalStateException("camera texture is not initialized");
        session.setCameraTextureName(textureId);
    }

    void draw(Frame frame) {
        if (textureId == 0) return;
        uv.position(0);
        transformedUv.position(0);
        frame.transformDisplayUvCoords(uv, transformedUv);
        interleaved.position(0);
        for (int i = 0; i < 6; i++) {
            interleaved.put(positions.get(i * 2));
            interleaved.put(positions.get(i * 2 + 1));
            interleaved.put(0f);
            interleaved.put(transformedUv.get(i * 2));
            interleaved.put(transformedUv.get(i * 2 + 1));
        }
        interleaved.position(0);
        GLES20.glDisable(GLES20.GL_DEPTH_TEST);
        GLES20.glDepthMask(false);
        GLES20.glUseProgram(program);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, textureId);
        GLES20.glUniform1i(textureUniform, 0);
        GLES20.glEnableVertexAttribArray(position);
        GLES20.glVertexAttribPointer(position, 3, GLES20.GL_FLOAT, false, 5 * FLOAT_BYTES, interleaved);
        interleaved.position(3);
        GLES20.glEnableVertexAttribArray(texCoord);
        GLES20.glVertexAttribPointer(texCoord, 2, GLES20.GL_FLOAT, false, 5 * FLOAT_BYTES, interleaved);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6);
        GLES20.glDisableVertexAttribArray(position);
        GLES20.glDisableVertexAttribArray(texCoord);
        GLES20.glDepthMask(true);
        GLES20.glEnable(GLES20.GL_DEPTH_TEST);
    }

    private static FloatBuffer direct(float[] data) {
        FloatBuffer buffer = ByteBuffer.allocateDirect(data.length * FLOAT_BYTES).order(ByteOrder.nativeOrder()).asFloatBuffer();
        buffer.put(data).position(0);
        return buffer;
    }
    private static int compile(int type, String source) {
        int shader = GLES20.glCreateShader(type);
        if (shader == 0) throw new IllegalStateException("glCreateShader returned 0; EGL context may be unavailable");
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);
        int[] ok = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, ok, 0);
        if (ok[0] == 0) {
            String log = GLES20.glGetShaderInfoLog(shader);
            GLES20.glDeleteShader(shader);
            throw new IllegalStateException("Background shader compile failed (type=" + type + "): " + log + " source=" + source);
        }
        return shader;
    }
    private static int link(String vertex, String fragment) {
        int program = GLES20.glCreateProgram();
        if (program == 0) throw new IllegalStateException("glCreateProgram returned 0; EGL context may be unavailable");
        int vertexShader = compile(GLES20.GL_VERTEX_SHADER, vertex);
        int fragmentShader = compile(GLES20.GL_FRAGMENT_SHADER, fragment);
        GLES20.glAttachShader(program, vertexShader);
        GLES20.glAttachShader(program, fragmentShader);
        GLES20.glLinkProgram(program);
        int[] ok = new int[1];
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, ok, 0);
        GLES20.glDeleteShader(vertexShader);
        GLES20.glDeleteShader(fragmentShader);
        if (ok[0] == 0) {
            String log = GLES20.glGetProgramInfoLog(program);
            GLES20.glDeleteProgram(program);
            throw new IllegalStateException("Background program link failed: " + log);
        }
        return program;
    }
    private static final String VERTEX = "attribute vec4 a_Position; attribute vec2 a_TexCoord; varying vec2 v_TexCoord; void main(){ gl_Position=a_Position; v_TexCoord=a_TexCoord; }";
    private static final String FRAGMENT = "#extension GL_OES_EGL_image_external : require\nprecision mediump float; uniform samplerExternalOES s_Camera; varying vec2 v_TexCoord; void main(){ gl_FragColor=texture2D(s_Camera,v_TexCoord); }";
}
