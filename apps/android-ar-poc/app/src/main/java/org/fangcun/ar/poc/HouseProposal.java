package org.fangcun.ar.poc;

import org.json.JSONObject;

/**
 * One pending house proposal from the Host.
 *
 * <p>The Host broadcasts {@code companion_build_proposal} frames and also exposes the same data as
 * {@code houseProposal} in {@code GET /api/core/state}. The renderer highlights the footprint (the
 * X/Z cells between {@code min} and {@code maxExclusive}, with the top face at
 * {@code maxExclusive.y}) and the activity shows the "may I build here?" card.</p>
 */
final class HouseProposal {
    final String proposalId;
    final int minX;
    final int minY;
    final int minZ;
    final int maxX;
    final int maxY;
    final int maxZ;
    final int blockCount;
    final long expiresAtMs;
    /** True for the {@code --es proposal} debug injection, which has no Host round-trip. */
    final boolean debug;

    HouseProposal(String proposalId, int minX, int minY, int minZ, int maxX, int maxY, int maxZ,
                  int blockCount, long expiresAtMs, boolean debug) {
        this.proposalId = proposalId == null ? "" : proposalId;
        this.minX = minX;
        this.minY = minY;
        this.minZ = minZ;
        this.maxX = maxX;
        this.maxY = maxY;
        this.maxZ = maxZ;
        this.blockCount = Math.max(0, blockCount);
        this.expiresAtMs = expiresAtMs;
        this.debug = debug;
    }

    /** True when the island column {@code (x, z)} is inside the proposed footprint. */
    boolean containsColumn(int x, int z) {
        return x >= minX && x < maxX && z >= minZ && z < maxZ;
    }

    boolean expired(long nowMs) {
        return expiresAtMs > 0L && nowMs > expiresAtMs;
    }

    int footprintCells() {
        return Math.max(0, maxX - minX) * Math.max(0, maxZ - minZ);
    }

    /**
     * Lenient parser for both the {@code companion_build_proposal} frame and the
     * {@code houseProposal} object from {@code /api/core/state}. Returns null when the required
     * bounds are missing so a malformed proposal never breaks the client.
     */
    static HouseProposal fromJson(JSONObject json) {
        if (json == null) return null;
        JSONObject bounds = json.optJSONObject("bounds");
        JSONObject min = bounds == null ? null : bounds.optJSONObject("min");
        JSONObject max = bounds == null ? null : bounds.optJSONObject("maxExclusive");
        if (min == null || max == null) return null;
        try {
            int minX = Math.min(min.getInt("x"), max.getInt("x"));
            int minY = Math.min(min.getInt("y"), max.getInt("y"));
            int minZ = Math.min(min.getInt("z"), max.getInt("z"));
            int maxX = Math.max(min.getInt("x"), max.getInt("x"));
            int maxY = Math.max(min.getInt("y"), max.getInt("y"));
            int maxZ = Math.max(min.getInt("z"), max.getInt("z"));
            // The Host frame/state carry `planBlockCount`; `blockCount` is accepted as a fallback
            // for the agreed contract. Without this the card showed "0 块".
            int blockCount = json.optInt("blockCount", json.optInt("planBlockCount", 0));
            if (blockCount <= 0) {
                blockCount = Math.max(1, (maxX - minX) * (maxY - minY) * (maxZ - minZ));
            }
            return new HouseProposal(
                json.optString("proposalId", json.optString("id", "")),
                minX, minY, minZ, maxX, maxY, maxZ,
                blockCount,
                json.optLong("expiresAtMs", 0L),
                false);
        } catch (Exception error) {
            return null;
        }
    }

    @Override public String toString() {
        return "HouseProposal{" + proposalId + " [" + minX + "," + minY + "," + minZ + ")->["
            + maxX + "," + maxY + "," + maxZ + ") blocks=" + blockCount + "}";
    }
}
