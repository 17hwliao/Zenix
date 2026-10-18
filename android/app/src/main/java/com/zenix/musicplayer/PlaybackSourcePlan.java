package com.zenix.musicplayer;

import org.json.*;
import java.util.*;
import java.util.function.LongSupplier;

/** Recent successful sources first, with bounded waits and temporary failure cooldown. */
final class PlaybackSourcePlan {
    static final long COOLDOWN_MS = 60000;
    private final LongSupplier clock;
    private final Map<String, Long> failed = new HashMap<>();
    private final Map<String, String> winners = new LinkedHashMap<>();
    PlaybackSourcePlan(LongSupplier clock) { this.clock = clock; }
    static boolean retryTransient(Throwable error) {
        for(Throwable value=error;value!=null;value=value.getCause()) {
            String message=String.valueOf(value.getMessage()).toLowerCase(Locale.ROOT);
            if(value instanceof java.net.SocketException||value instanceof java.io.EOFException
                ||value instanceof java.net.SocketTimeoutException
                ||message.matches("(?s).*(connection reset|连接重置|unexpected end|econnreset|timed out|timeout|超时|(?:http|状态|status)[ :：]*(?:502|503|504)).*"))return true;
        }
        return false;
    }
    synchronized void success(String family, String id) {
        failed.remove(id);
        if (winners.size() >= 64) winners.remove(winners.keySet().iterator().next());
        winners.put(family, id);
    }
    synchronized void failure(String id) {
        if (failed.size() >= 100) failed.clear();
        failed.put(id, clock.getAsLong() + COOLDOWN_MS);
    }
    synchronized boolean cooling(String id){return failed.getOrDefault(id,0L)>clock.getAsLong();}
    synchronized List<JSONObject> order(JSONArray installed, String family, String origin) {
        List<JSONObject> healthy = new ArrayList<>(), cooling = new ArrayList<>();
        for (int i = 0; i < installed.length(); i++) {
            JSONObject source = installed.optJSONObject(i);
            if (source == null || !source.optBoolean("enabled")) continue;
            (failed.getOrDefault(source.optString("id"), 0L) > clock.getAsLong() ? cooling : healthy).add(source);
        }
        String winner = winners.get(family);
        // Stable sort preserves the user's order among other healthy sources.
        healthy.sort(Comparator.comparingInt(source -> source.optString("id").equals(winner) ? 0 : source.optString("id").equals(origin) ? 1 : 2));
        // Cooldown changes priority, not availability. Otherwise an unrelated
        // healthy source (e.g. QQ-only) can hide every cooling NetEase source
        // before MusicSources filters unsupported catalogue platforms.
        healthy.addAll(cooling);
        return healthy;
    }
    static boolean transportFailure(Throwable error) {
        if(retryTransient(error))return true;
        for (Throwable value = error; value != null; value = value.getCause()) {
            if (value instanceof java.util.concurrent.TimeoutException || value instanceof java.io.IOException) return true;
            String message = String.valueOf(value.getMessage()).toLowerCase(Locale.ROOT);
            if (message.matches("(?s).*?(timeout|timed out|超时|econn|enotfound|dns|network|网络请求|http (5[0-9][0-9]|401|403|429)).*")) return true;
        }
        return false;
    }
}
