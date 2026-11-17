package org.fangcun.ar.poc;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Talks to the Fangcun Host: one-time pairing code -> bearer token -> WebSocket
 * replica session. Only the messages needed by this client slice are handled.
 */
final class HostClient {
    interface Listener {
        void onStatus(String text);

        void onWorldLoaded(int rev);

        void onCommitApplied(int rev);
    }

    private final String host;
    private final int port;
    private final String clientId;
    private final VoxelWorld world;
    private final Listener listener;
    private WebSocketClient socket;
    private String worldId = "";
    private int seq;

    HostClient(String host, int port, String clientId, VoxelWorld world, Listener listener) {
        this.host = host;
        this.port = port;
        this.clientId = clientId;
        this.world = world;
        this.listener = listener;
    }

    /** Pairs with the one-time code and opens the replica socket. Blocking; call off the UI thread. */
    void connect(String pairingCode) {
        String token;
        try {
            JSONObject response = postJson("/api/pair", new JSONObject()
                .put("code", pairingCode.trim().toUpperCase(java.util.Locale.ROOT))
                .put("clientId", clientId));
            token = response.getString("token");
            worldId = response.getString("worldId");
        } catch (IOException | JSONException error) {
            listener.onStatus("Pairing failed: " + describe(error));
            return;
        }

        WebSocketClient client = new WebSocketClient();
        try {
            client.connect(host, port, "/api/ws", new WebSocketClient.Listener() {
                @Override public void onOpen() {
                    listener.onStatus("Connected. Loading world…");
                }

                @Override public void onMessage(String text) {
                    handleMessage(text);
                }

                @Override public void onClosed(String reason) {
                    listener.onStatus("Host connection closed (" + reason + ")");
                }
            });
        } catch (IOException error) {
            listener.onStatus("WebSocket failed: " + describe(error));
            return;
        }
        socket = client;
        try {
            send(new JSONObject()
                .put("protocolVersion", 1)
                .put("type", "hello")
                .put("worldId", worldId)
                .put("clientId", clientId)
                .put("credential", token)
                .put("lastAppliedRev", Math.max(world.revision(), 0)));
        } catch (JSONException error) {
            listener.onStatus("Hello failed: " + describe(error));
        }
    }

    void disconnect() {
        WebSocketClient current = socket;
        socket = null;
        if (current != null) current.close();
    }

    /** Places on top of a column, or removes the top block when the column is full. */
    void editColumn(int x, int z) {
        int placeY = world.firstEmptyY(x, z);
        try {
            JSONObject operation;
            if (placeY >= 0) {
                operation = new JSONObject().put("type", "place")
                    .put("at", coord(x, placeY, z))
                    .put("blockId", "planks");
            } else {
                int topY = world.topSolidY(x, z);
                if (topY < VoxelWorld.BUILD_MIN_Y) {
                    listener.onStatus("No editable cell in that column.");
                    return;
                }
                operation = new JSONObject().put("type", "break")
                    .put("at", coord(x, topY, z))
                    .put("expectedBlock", blockNameAt(x, topY, z));
            }
            seq += 1;
            send(new JSONObject()
                .put("protocolVersion", 1)
                .put("type", "intent")
                .put("worldId", worldId)
                .put("clientId", clientId)
                .put("seq", seq)
                .put("baseRev", world.revision())
                .put("operation", operation));
        } catch (JSONException error) {
            listener.onStatus("Intent failed: " + describe(error));
        }
    }

    private String blockNameAt(int x, int y, int z) {
        byte code = world.blockAt(x, y, z);
        return VoxelWorld.blockIdForCode(code);
    }

    private static JSONObject coord(int x, int y, int z) throws JSONException {
        return new JSONObject().put("x", x).put("y", y).put("z", z);
    }

    private void handleMessage(String text) {
        try {
            JSONObject message = new JSONObject(text);
            String type = message.getString("type");
            if ("welcome".equals(type)) {
                if (world.loadSnapshot(message.getJSONObject("snapshot"))) {
                    listener.onWorldLoaded(world.revision());
                } else {
                    listener.onStatus("Rejected world snapshot (schema mismatch).");
                }
                return;
            }
            if ("ack".equals(type)) {
                if (!message.getBoolean("accepted")) {
                    String reason = message.optString("reason", "rejected");
                    listener.onStatus("Server rejected edit: " + reason);
                }
                return;
            }
            if ("commit".equals(type)) {
                if (world.applyCommit(message)) {
                    listener.onCommitApplied(world.revision());
                } else {
                    listener.onStatus("Commit gap detected; resyncing.");
                    requestResync();
                }
                return;
            }
            if ("error".equals(type)) {
                listener.onStatus("Host error: " + message.optString("code", "unknown"));
            }
        } catch (JSONException error) {
            listener.onStatus("Malformed host message.");
        }
    }

    private void requestResync() {
        try {
            send(new JSONObject()
                .put("protocolVersion", 1)
                .put("type", "resync")
                .put("worldId", worldId)
                .put("lastAppliedRev", Math.max(world.revision(), 0)));
        } catch (JSONException error) {
            listener.onStatus("Resync failed: " + describe(error));
        }
    }

    private void send(JSONObject message) {
        WebSocketClient current = socket;
        if (current == null) {
            listener.onStatus("Not connected to the Host.");
            return;
        }
        current.sendText(message.toString());
    }

    private JSONObject postJson(String path, JSONObject body) throws IOException, JSONException {
        HttpURLConnection connection = (HttpURLConnection) new URL("http://" + host + ":" + port + path).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream out = connection.getOutputStream()) {
                out.write(payload);
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            StringBuilder text = new StringBuilder();
            if (stream != null) {
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) text.append(line);
                }
            }
            if (status != 200) throw new IOException("HTTP " + status + ": " + text);
            return new JSONObject(text.toString());
        } finally {
            connection.disconnect();
        }
    }

    private static String describe(Exception error) {
        String message = error.getMessage();
        return message == null ? error.getClass().getSimpleName() : message;
    }
}
