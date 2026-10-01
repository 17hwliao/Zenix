package com.zenix.musicplayer;

import org.json.JSONObject;
import java.util.*;
import java.util.regex.*;

/** Native overlay timeline, independent of the Activity and its WebView. */
final class LyricTimeline {
    static final class Line {
        final double time;
        final String text;
        String translation = "";
        Line(double time, String text) { this.time = time; this.text = text; }
    }
    private static final Pattern CLOCK = Pattern.compile("\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]");
    private static final Pattern WORD_CLOCK = Pattern.compile("<\\d+:\\d+(?:[.:]\\d+)?>|\\(\\d+,\\d+(?:,\\d+)?\\)");
    private static final Pattern YRC = Pattern.compile("^\\[(\\d+),(\\d+)\\](.*)$");
    private static final Pattern OFFSET = Pattern.compile("\\[offset:([+-]?\\d+)\\]", Pattern.CASE_INSENSITIVE);

    static List<Line> parse(Object raw) {
        if (raw == null || raw == JSONObject.NULL) return Collections.emptyList();
        String text = raw instanceof JSONObject ? ((JSONObject) raw).optString("text") : raw.toString();
        List<Line> lines = parseText(text);
        if (raw instanceof JSONObject) {
            List<Line> translated = parseText(((JSONObject) raw).optString("translationText"));
            int cursor = 0;
            for (Line line : lines) {
                while (cursor < translated.size() && translated.get(cursor).time < line.time - .5) cursor++;
                if (cursor < translated.size() && Math.abs(translated.get(cursor).time - line.time) < .5) line.translation = translated.get(cursor).text;
            }
        }
        return lines;
    }
    private static List<Line> parseText(String text) {
        List<Line> lines = new ArrayList<>();
        double offset = 0;
        Matcher offsetTag = OFFSET.matcher(text);
        if (offsetTag.find()) try { offset = Double.parseDouble(offsetTag.group(1)) / 1000; } catch (Exception ignored) {}
        for (String row : text.replace("\r", "").split("\n")) {
            Matcher stamps = CLOCK.matcher(row);
            String content = WORD_CLOCK.matcher(CLOCK.matcher(row).replaceAll("")).replaceAll("").trim();
            while (stamps.find()) {
                String fraction = stamps.group(3);
                double time = Integer.parseInt(stamps.group(1)) * 60 + Integer.parseInt(stamps.group(2));
                if (fraction != null) time += Double.parseDouble(fraction) / Math.pow(10, fraction.length());
                if (!content.isEmpty()) lines.add(new Line(Math.max(0, time + offset), content));
            }
            Matcher yrc = YRC.matcher(row);
            if (yrc.matches()) {
                String words = WORD_CLOCK.matcher(yrc.group(3)).replaceAll("").trim();
                if (!words.isEmpty()) lines.add(new Line(Long.parseLong(yrc.group(1)) / 1000.0, words));
            }
        }
        lines.sort(Comparator.comparingDouble(line -> line.time));
        // Some providers encode translation as a second row with the same timestamp.
        List<Line> merged = new ArrayList<>();
        for (Line line : lines) {
            Line previous = merged.isEmpty() ? null : merged.get(merged.size() - 1);
            if (previous != null && Math.abs(previous.time - line.time) < .001) {
                if (!previous.text.equals(line.text)) previous.translation = line.text;
            } else merged.add(line);
        }
        return merged;
    }
    static int active(List<Line> lines, double position) {
        int low = 0, high = lines.size() - 1, result = -1;
        while (low <= high) { int middle = (low + high) >>> 1; if (lines.get(middle).time <= position) { result = middle; low = middle + 1; } else high = middle - 1; }
        return result;
    }
}
