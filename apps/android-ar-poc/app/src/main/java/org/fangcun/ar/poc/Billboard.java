package org.fangcun.ar.poc;

import android.opengl.GLES20;
import android.opengl.Matrix;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/**
 * One camera-facing textured quad, used for the nameplate and the speech bubble.
 *
 * <p>Orientation is built from the camera's right/up vectors taken from the view matrix, so the
 * quad always faces the camera and keeps text upright even when the device is tilted down at the
 * tabletop. The renderer draws billboards last with depth testing disabled, so they never clip
 * into the avatar.</p>
 */
final class Billboard {
    private static final int FLOAT_BYTES = 4;
    /** Interleaved x, y, u, v per quad vertex. */
    private static final int COMPONENTS_PER_VERTEX = 4;

    private static final float[] CORNERS = {
        // x, y, u, v  (bitmap row 0 is the top of the texture, so v=0 is up)
        -0.5f, 0.5f, 0f, 0f,
        0.5f, 0.5f, 1f, 0f,
        0.5f, -0.5f, 1f, 1f,
        -0.5f, 0.5f, 0f, 0f,
        0.5f, -0.5f, 1f, 1f,
        -0.5f, -0.5f, 0f, 1f,
    };

    private final FloatBuffer vertices;
    private final float[] model = new float[16];
    private final float[] modelView = new float[16];
    private final float[] mvp = new float[16];
    private int program;
    private int positionHandle;
    private int uvHandle;
    private int mvpHandle;
    private int textureHandle;
    private int alphaHandle;

    private Billboard() {
        vertices = ByteBuffer.allocateDirect(CORNERS.length * FLOAT_BYTES)
            .order(ByteOrder.nativeOrder())
            .asFloatBuffer();
        vertices.put(CORNERS).position(0);
    }

    /** Compiles the program; call on the GL thread from {@code onSurfaceCreated}. */
    static Billboard create() {
        Billboard billboard = new Billboard();
        billboard.program = createProgram();
        billboard.positionHandle = GLES20.glGetAttribLocation(billboard.program, "a_Position");
        billboard.uvHandle = GLES20.glGetAttribLocation(billboard.program, "a_Uv");
        billboard.mvpHandle = GLES20.glGetUniformLocation(billboard.program, "u_Mvp");
        billboard.textureHandle = GLES20.glGetUniformLocation(billboard.program, "u_Tex");
        billboard.alphaHandle = GLES20.glGetUniformLocation(billboard.program, "u_Alpha");
        return billboard;
    }

    /**
     * Draws one quad centred on ({@code cx, cy, cz}) in world space. {@code rightX..} and
     * {@code upX..} are the camera's right/up unit vectors in world space; the quad is scaled to
     * {@code widthMeters} by {@code heightMeters} and blended with {@code alpha}.
     */
    void draw(int textureId, float alpha,
              float[] viewMatrix, float[] projectionMatrix,
              float[] cameraRight, float[] cameraUp,
              float cx, float cy, float cz,
              float widthMeters, float heightMeters) {
        if (textureId == 0 || program == 0) return;
        // Column-major model matrix: right * width, up * height, normal, centre. The unit quad
        // spans [-0.5, 0.5], so scaling each axis by the full size gives the requested extent.
        model[0] = cameraRight[0] * widthMeters;
        model[1] = cameraRight[1] * widthMeters;
        model[2] = cameraRight[2] * widthMeters;
        model[3] = 0f;
        model[4] = cameraUp[0] * heightMeters;
        model[5] = cameraUp[1] * heightMeters;
        model[6] = cameraUp[2] * heightMeters;
        model[7] = 0f;
        // The quad is one-sided; the normal column is never sampled but keep the matrix valid.
        model[8] = cameraRight[1] * cameraUp[2] - cameraRight[2] * cameraUp[1];
        model[9] = cameraRight[2] * cameraUp[0] - cameraRight[0] * cameraUp[2];
        model[10] = cameraRight[0] * cameraUp[1] - cameraRight[1] * cameraUp[0];
        model[11] = 0f;
        model[12] = cx;
        model[13] = cy;
        model[14] = cz;
        model[15] = 1f;
        Matrix.multiplyMM(modelView, 0, viewMatrix, 0, model, 0);
        Matrix.multiplyMM(mvp, 0, projectionMatrix, 0, modelView, 0);

        GLES20.glUseProgram(program);
        GLES20.glUniformMatrix4fv(mvpHandle, 1, false, mvp, 0);
        GLES20.glUniform1f(alphaHandle, alpha);
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, textureId);
        GLES20.glUniform1i(textureHandle, 0);
        vertices.position(0);
        GLES20.glEnableVertexAttribArray(positionHandle);
        GLES20.glVertexAttribPointer(positionHandle, 2, GLES20.GL_FLOAT, false,
            COMPONENTS_PER_VERTEX * FLOAT_BYTES, vertices);
        vertices.position(2);
        GLES20.glEnableVertexAttribArray(uvHandle);
        GLES20.glVertexAttribPointer(uvHandle, 2, GLES20.GL_FLOAT, false,
            COMPONENTS_PER_VERTEX * FLOAT_BYTES, vertices);
        GLES20.glDrawArrays(GLES20.GL_TRIANGLES, 0, 6);
        GLES20.glDisableVertexAttribArray(positionHandle);
        GLES20.glDisableVertexAttribArray(uvHandle);
    }

    void release() {
        if (program != 0) {
            GLES20.glDeleteProgram(program);
            program = 0;
        }
    }

    private static int createProgram() {
        int vertexShader = compileShader(GLES20.GL_VERTEX_SHADER, VERTEX_SHADER);
        int fragmentShader = compileShader(GLES20.GL_FRAGMENT_SHADER, FRAGMENT_SHADER);
        int handle = GLES20.glCreateProgram();
        GLES20.glAttachShader(handle, vertexShader);
        GLES20.glAttachShader(handle, fragmentShader);
        GLES20.glLinkProgram(handle);
        int[] status = new int[1];
        GLES20.glGetProgramiv(handle, GLES20.GL_LINK_STATUS, status, 0);
        if (status[0] == 0) throw new IllegalStateException("billboard program link failed: " + GLES20.glGetProgramInfoLog(handle));
        GLES20.glDeleteShader(vertexShader);
        GLES20.glDeleteShader(fragmentShader);
        return handle;
    }

    private static int compileShader(int type, String source) {
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);
        int[] status = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0);
        if (status[0] == 0) throw new IllegalStateException("billboard shader compile failed: " + GLES20.glGetShaderInfoLog(shader));
        return shader;
    }

    private static final String VERTEX_SHADER =
        "uniform mat4 u_Mvp; attribute vec2 a_Position; attribute vec2 a_Uv; varying vec2 v_Uv;"
        + "void main(){ gl_Position=u_Mvp*vec4(a_Position,0.0,1.0); v_Uv=a_Uv; }";
    private static final String FRAGMENT_SHADER =
        "precision mediump float; uniform sampler2D u_Tex; uniform float u_Alpha;"
        + "varying vec2 v_Uv;"
        + "void main(){ vec4 c=texture2D(u_Tex,v_Uv); if(c.a<0.01) discard;"
        + " gl_FragColor=vec4(c.rgb, c.a*u_Alpha); }";
}
