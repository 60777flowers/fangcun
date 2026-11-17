package org.fangcun.ar.poc;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Minimal RFC 6455 client so the APK needs no extra WebSocket dependency.
 * Supports text frames with masking, close and ping/pong; refuses binary and
 * fragmented frames instead of half-supporting them.
 */
final class WebSocketClient {
    interface Listener {
        void onOpen();

        void onMessage(String text);

        void onClosed(String reason);
    }

    private static final int MAX_MESSAGE_BYTES = 64 * 1024;
    private static final SecureRandom RANDOM = new SecureRandom();

    private Socket socket;
    private OutputStream out;
    private InputStream in;
    private Thread reader;
    private Listener listener = null;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    void connect(String host, int port, String path, Listener target) throws IOException {
        this.listener = target;
        Socket newSocket = new Socket();
        newSocket.connect(new InetSocketAddress(host, port), 4000);
        newSocket.setSoTimeout(0);
        this.socket = newSocket;
        this.out = newSocket.getOutputStream();
        this.in = newSocket.getInputStream();
        handshake(host, port, path);
        this.reader = new Thread(this::readLoop, "fangcun-ws");
        this.reader.setDaemon(true);
        this.reader.start();
        if (target != null) target.onOpen();
    }

    private void handshake(String host, int port, String path) throws IOException {
        byte[] nonce = new byte[16];
        RANDOM.nextBytes(nonce);
        String key = android.util.Base64.encodeToString(nonce, android.util.Base64.NO_WRAP);
        String request = "GET " + path + " HTTP/1.1\r\n"
            + "Host: " + host + ":" + port + "\r\n"
            + "Upgrade: websocket\r\n"
            + "Connection: Upgrade\r\n"
            + "Sec-WebSocket-Key: " + key + "\r\n"
            + "Sec-WebSocket-Version: 13\r\n\r\n";
        out.write(request.getBytes(StandardCharsets.US_ASCII));
        out.flush();

        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int matched = 0;
        byte[] terminator = {'\r', '\n', '\r', '\n'};
        while (matched < 4) {
            int value = in.read();
            if (value < 0) throw new EOFException("handshake closed early");
            head.write(value);
            matched = value == terminator[matched] ? matched + 1 : (value == '\r' ? 1 : 0);
            if (head.size() > 8192) throw new IOException("handshake too large");
        }
        String response = head.toString(StandardCharsets.US_ASCII.name());
        if (!response.startsWith("HTTP/1.1 101")) throw new IOException("websocket upgrade rejected");
    }

    void sendText(String text) {
        if (closed.get() || out == null) return;
        try {
            writeFrame(0x1, text.getBytes(StandardCharsets.UTF_8));
        } catch (IOException error) {
            finish("write_failed");
        }
    }

    void close() {
        if (closed.get()) return;
        try {
            writeFrame(0x8, new byte[] {0x03, (byte) 0xE8});
        } catch (IOException ignored) {
            // best effort
        }
        finish("local_close");
    }

    private void writeFrame(int opcode, byte[] payload) throws IOException {
        int length = payload.length;
        ByteArrayOutputStream frame = new ByteArrayOutputStream(length + 14);
        frame.write(0x80 | opcode);
        if (length < 126) {
            frame.write(0x80 | length);
        } else if (length < 65_536) {
            frame.write(0x80 | 126);
            frame.write((length >>> 8) & 0xff);
            frame.write(length & 0xff);
        } else {
            frame.write(0x80 | 127);
            for (int shift = 7; shift >= 0; shift -= 1) frame.write((int) (((long) length >>> (8 * shift)) & 0xff));
        }
        byte[] mask = new byte[4];
        RANDOM.nextBytes(mask);
        frame.write(mask, 0, 4);
        for (int index = 0; index < length; index += 1) {
            frame.write((payload[index] ^ mask[index & 3]) & 0xff);
        }
        out.write(frame.toByteArray());
        out.flush();
    }

    private void readLoop() {
        try {
            while (!closed.get()) {
                int first = in.read();
                int second = in.read();
                if (first < 0 || second < 0) {
                    finish("peer_closed");
                    return;
                }
                boolean fin = (first & 0x80) != 0;
                int opcode = first & 0x0f;
                boolean masked = (second & 0x80) != 0;
                long length = second & 0x7f;
                if (length == 126) {
                    length = ((long) (in.read() & 0xff) << 8) | (in.read() & 0xff);
                } else if (length == 127) {
                    length = 0;
                    for (int index = 0; index < 8; index += 1) length = (length << 8) | (in.read() & 0xff);
                }
                if (!fin || length > MAX_MESSAGE_BYTES) {
                    finish("protocol_error");
                    return;
                }
                byte[] mask = new byte[4];
                if (masked) readFully(mask);
                byte[] payload = new byte[(int) length];
                readFully(payload);
                if (masked) {
                    for (int index = 0; index < payload.length; index += 1) {
                        payload[index] ^= mask[index & 3];
                    }
                }
                if (opcode == 0x8) {
                    finish("peer_closed");
                    return;
                }
                if (opcode == 0x9) {
                    try {
                        writeFrame(0xa, payload);
                    } catch (IOException ignored) {
                        finish("write_failed");
                        return;
                    }
                    continue;
                }
                if (opcode != 0x1) continue;
                Listener target = listener;
                if (target != null) target.onMessage(new String(payload, StandardCharsets.UTF_8));
            }
        } catch (IOException error) {
            finish("transport_error");
        }
    }

    private void readFully(byte[] buffer) throws IOException {
        int offset = 0;
        while (offset < buffer.length) {
            int read = in.read(buffer, offset, buffer.length - offset);
            if (read < 0) throw new EOFException("stream closed");
            offset += read;
        }
    }

    private void finish(String reason) {
        if (!closed.compareAndSet(false, true)) return;
        Listener target = listener;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
            // best effort
        }
        if (target != null) target.onClosed(reason);
    }
}
