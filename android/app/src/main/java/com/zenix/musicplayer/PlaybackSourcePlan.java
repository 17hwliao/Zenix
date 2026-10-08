package com.zenix.musicplayer;

import org.json.*;
import java.util.*;
import java.util.function.LongSupplier;

/** Recent successful sources first, with bounded waits and temporary failure cooldown. */
final class PlaybackSourcePlan {
    static final long TOTAL_MS = 30000, SOURCE_MS = 10000, COOLDOWN_MS = 60000;
    private final LongSupplier clock;
    private final Map<String, Long> failed = new HashMap<>();
    private final Map<String, String> winners = new LinkedHashMap<>();
    PlaybackSourcePlan(LongSupplier clock) { this.clock = clock; }
    synchronized void success(String family, String id) {
        failed.remove(id);
        if (winners.size() >= 64) winners.remove(winners.keySet().iterator().next());
        winners.put(family, id);
    }
    synchronized void failure(String id) {
        if (failed.size() >= 100) failed.clear();
        failed.put(id, clock.getAsLong() + COOLDOWN_MS);
    }
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
        return healthy.isEmpty() ? cooling : healthy;
    }
    static boolean transportFailure(Throwable error) {
        for (Throwable value = error; value != null; value = value.getCause()) {
            if (value instanceof java.util.concurrent.TimeoutException || value instanceof java.io.IOException) return true;
            String message = String.valueOf(value.getMessage()).toLowerCase(Locale.ROOT);
            if (message.matches("(?s).*?(timeout|timed out|超时|econn|enotfound|dns|network|网络请求|http (5[0-9][0-9]|401|403|429)).*")) return true;
        }
        return false;
    }
}
