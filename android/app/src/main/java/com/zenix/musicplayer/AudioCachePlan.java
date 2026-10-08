package com.zenix.musicplayer;

/** A prefix is reusable online, but is never advertised as an offline song. */
final class AudioCachePlan {
    static String status(boolean enabled, boolean local, boolean segmented, long bytes, long length, boolean complete) {
        if (local) return "local";
        if (!enabled) return "disabled";
        if (segmented) return "stream";
        if (length > 0 && complete) return "complete";
        return bytes > 0 ? "partial" : "none";
    }
    static boolean reusePrefix(long prefixBytes, long savedAt, long now) {
        return prefixBytes >= 64 * 1024 && savedAt > 0 && now >= savedAt && now - savedAt <= 10 * 60000L;
    }
}
