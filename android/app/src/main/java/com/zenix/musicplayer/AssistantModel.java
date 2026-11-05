package com.zenix.musicplayer;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import static com.zenix.musicplayer.AssistantModelProtocol.*;

/** Native model-only HTTP. It never delegates to music-source or application-update networking. */
final class AssistantModel {
    interface Vault { JSONObject read() throws Exception; void write(JSONObject value) throws Exception; }
    interface ConnectionFactory { HttpURLConnection open(URL url) throws Exception; }
    interface Check { void run() throws Exception; }
    private static final class Active {
        final AtomicBoolean cancelled = new AtomicBoolean();
        volatile HttpURLConnection connection;
        volatile boolean expired;
        void cancel() { cancelled.set(true); HttpURLConnection current = connection; if (current != null) current.disconnect(); }
    }
    private final Vault vault;
    private final ConnectionFactory factory;
    private final int timeoutMs;
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor();
    private final ConcurrentMap<String, Active> active = new ConcurrentHashMap<>();
    private final LinkedHashMap<String, Long> cancelled = new LinkedHashMap<>();
    private volatile JSONObject config;
    private volatile boolean storageError, closed;

    AssistantModel(Context context) { this(new AssistantModelCredentials(context), url -> (HttpsURLConnection) url.openConnection(), MODEL_TIMEOUT_MS); }
    AssistantModel(Vault vault, ConnectionFactory factory, int timeoutMs) {
        this.vault = vault; this.factory = factory; this.timeoutMs = timeoutMs;
        try {
            config = defaults(); JSONObject stored = vault.read();
            if (stored != null) {
                JSONObject checked = AssistantModelProtocol.config(new JSONObject().put("enabled", stored.getBoolean("enabled")).put("endpoint", stored.getString("endpoint")).put("model", stored.getString("model")).put("apiKey", stored.getString("apiKey")), null);
                checked.put("revision", text(stored.get("revision"), 100, 1)); config = checked;
            }
        } catch (Exception ignored) { storageError = true; }
    }
    private void ready() throws Exception {
        if (closed) throw error("closed", "远程助手已关闭");
        if (storageError || config == null) throw error("storage", "模型配置无法读取或解密，原文件已保留。可继续使用本地音乐指令");
    }
    synchronized JSONObject configure(JSONObject value) throws Exception {
        ready(); JSONObject next = AssistantModelProtocol.config(value, config);
        try { vault.write(next); } catch (Exception ignored) { throw error("storage", "模型配置保存失败，已保留上次配置"); }
        config = next;
        for (Active request : active.values()) request.cancel();
        return mask(next);
    }
    synchronized boolean cancel(String requestId) throws Exception {
        if (!requestId.matches(REQUEST_ID)) throw error("invalid_request", "模型请求编号无效");
        long now = System.currentTimeMillis(); cancelled.put(requestId, now);
        cancelled.entrySet().removeIf(entry -> now - entry.getValue() > 15 * 60 * 1000);
        while (cancelled.size() > 128) cancelled.remove(cancelled.keySet().iterator().next());
        Active request = active.get(requestId); if (request != null) request.cancel();
        return true;
    }
    private synchronized boolean wasCancelled(String requestId) { return cancelled.containsKey(requestId); }
    static byte[] readBounded(InputStream input, int maximum, Check check) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(); byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) {
            check.run(); if (bytes.size() + count > maximum) throw error("oversize", "模型回复过大，未执行功能");
            bytes.write(buffer, 0, count);
        }
        check.run(); return bytes.toByteArray();
    }
    private JSONObject complete(JSONObject value, boolean probe) throws Exception {
        ready(); JSONObject request = AssistantModelProtocol.request(value), selected = config;
        String requestId = request.getString("requestId"), revision = selected.getString("revision");
        if ((!selected.getBoolean("enabled") && !probe) || selected.getString("endpoint").isEmpty() || selected.getString("model").isEmpty() || selected.getString("apiKey").isEmpty()) throw error("not_configured", "请先配置模型服务和 API Key，或继续使用本地音乐指令");
        if (!revision.equals(request.getString("revision"))) throw error("configuration_changed", "模型配置已变化，请重新发送指令");
        if (wasCancelled(requestId)) throw error("cancelled", "模型请求已取消");
        Active state = new Active();
        synchronized (this) {
            if (active.size() >= 2 || active.putIfAbsent(requestId, state) != null) throw error("busy", "已有模型请求正在处理");
        }
        ScheduledFuture<?> timer = deadlines.schedule(() -> { state.expired = true; state.cancel(); }, timeoutMs, TimeUnit.MILLISECONDS);
        Check check = () -> {
            if (state.expired) throw error("timeout", "模型请求等待超时，可重新发送指令。音乐加载不受此限制影响");
            if (closed || state.cancelled.get() || wasCancelled(requestId)) throw error("cancelled", "模型请求已取消");
            if (!revision.equals(config.optString("revision"))) throw error("configuration_changed", "模型配置已变化，旧回复已丢弃");
        };
        try {
            check.run(); HttpURLConnection connection = factory.open(new URL(selected.getString("endpoint"))); state.connection = connection; check.run();
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(Math.min(timeoutMs, 20_000)); connection.setReadTimeout(timeoutMs);
            connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setUseCaches(false);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8"); connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + selected.getString("apiKey"));
            JSONArray tools = request.getJSONArray("tools");
            JSONObject body = new JSONObject().put("model", selected.getString("model")).put("messages", request.getJSONArray("messages")).put("stream", false);
            if (tools.length() > 0) body.put("tools", tools).put("tool_choice", probe ? new JSONObject().put("type", "function").put("function", new JSONObject().put("name", "zenix_connection_probe")) : "auto");
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(payload.length);
            try (OutputStream output = connection.getOutputStream()) { output.write(payload); }
            check.run(); int status = connection.getResponseCode(); check.run();
            if (status >= 300 && status < 400) throw error("redirect", "模型地址发生重定向，已停止发送凭据。请填写最终 HTTPS 接口地址");
            if (status < 200 || status >= 300) {
                if (status == 401 || status == 403) throw error("authentication", "模型鉴权失败，请检查 API Key 和服务归属");
                if (status == 429) throw error("rate_limit", "模型服务限流，请稍后重试");
                throw error("service", "模型服务返回 HTTP " + status + "，未执行功能");
            }
            if (connection.getContentLengthLong() > MAX_RESPONSE_BYTES) throw error("oversize", "模型回复过大，未执行功能");
            byte[] bytes; try (InputStream input = connection.getInputStream()) { bytes = readBounded(input, MAX_RESPONSE_BYTES, check); }
            JSONObject raw; try { raw = new JSONObject(new String(bytes, StandardCharsets.UTF_8)); } catch (Exception ignored) { throw error("protocol", "模型未返回兼容的完整 JSON 回复"); }
            Set<String> names = new HashSet<>(); for (int i = 0; i < tools.length(); i++) names.add(tools.getJSONObject(i).getJSONObject("function").getString("name"));
            check.run();
            try { return response(raw, names, selected.getString("apiKey")); }
            catch (ModelException known) { throw known; }
            catch (Exception ignored) { throw error("protocol", "模型返回的工具调用格式无效"); }
        } catch (Exception failure) {
            check.run(); if (failure instanceof ModelException) throw failure;
            throw error("network", "模型连接失败，请检查服务地址、网络和代理设置");
        } finally {
            timer.cancel(false); active.remove(requestId, state);
            HttpURLConnection connection = state.connection; if (connection != null) connection.disconnect();
        }
    }
    private JSONObject test(String requestId) throws Exception {
        ready(); String revision = config.getString("revision"), nonce = UUID.randomUUID().toString();
        JSONObject parameters = new JSONObject().put("type", "object").put("properties", new JSONObject().put("nonce", new JSONObject().put("type", "string").put("enum", new JSONArray().put(nonce)))).put("required", new JSONArray().put("nonce")).put("additionalProperties", false);
        JSONObject tool = new JSONObject().put("type", "function").put("function", new JSONObject().put("name", "zenix_connection_probe").put("description", "Return the nonce to verify tool-call format. This is a connection probe with no execution.").put("parameters", parameters));
        JSONObject request = new JSONObject().put("requestId", requestId).put("revision", revision).put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", "Call zenix_connection_probe with the provided nonce. Do not request any music operations."))).put("tools", new JSONArray().put(tool));
        JSONObject result = complete(request, true); boolean compatible = false;
        try { JSONArray calls = result.getJSONArray("toolCalls"); compatible = calls.length() == 1 && nonce.equals(new JSONObject(calls.getJSONObject(0).getString("arguments")).getString("nonce")); } catch (Exception ignored) {}
        return new JSONObject().put("ok", compatible).put("revision", revision).put("toolCalling", compatible).put("message", compatible ? "连接成功，已验证 Chat Completions 工具调用格式" : "服务可连接，但未返回兼容的工具调用。请检查模型是否支持 tools");
    }
    Object invoke(JSONObject args) throws Exception {
        try {
            object(args, Set.of("action", "value", "request", "requestId"), "action");
            switch (args.getString("action")) {
                case "read": ready(); return mask(config);
                case "configure": return configure(args.getJSONObject("value"));
                case "test": return test(args.getString("requestId"));
                case "complete": return complete(args.getJSONObject("request"), false);
                case "cancel": return cancel(args.getString("requestId"));
                default: throw error("invalid_request", "未知模型操作");
            }
        } catch (ModelException known) { throw known; }
        catch (Exception ignored) { throw error("invalid_request", "模型请求格式无效"); }
    }
    void close() { closed = true; for (Active request : active.values()) request.cancel(); deadlines.shutdownNow(); }
}
