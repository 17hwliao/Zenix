package com.zenix.musicplayer;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;

public final class AssistantModelCheck {
    static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
    interface Run { void run() throws Exception; }
    static void rejected(String code, Run action) throws Exception {
        try { action.run(); throw new AssertionError("expected " + code); }
        catch (AssistantModelProtocol.ModelException failure) { check(failure.code.equals(code), failure.code + " expected " + code); check(!failure.getMessage().contains("fixture-secret"), "credential leak"); }
    }
    static final class Vault implements AssistantModel.Vault {
        JSONObject saved;
        boolean fail;
        public JSONObject read() throws Exception { return saved == null ? null : new JSONObject(saved.toString()); }
        public void write(JSONObject value) throws Exception { if (fail) throw new IOException("fixture-secret must not escape"); saved = new JSONObject(value.toString()); }
    }
    static final class Server implements AssistantModel.ConnectionFactory {
        volatile Fake last;
        volatile int status = 200;
        volatile boolean block;
        volatile String reply = "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"ready\"}}]}";
        int calls;
        public HttpURLConnection open(URL url) { calls++; return last = new Fake(url, this); }
    }
    static final class Fake extends HttpURLConnection {
        final Server server;
        final ByteArrayOutputStream output = new ByteArrayOutputStream();
        final Map<String, String> headers = new HashMap<>();
        volatile boolean stopped;
        Fake(URL url, Server server) { super(url); this.server = server; }
        @Override public void setRequestProperty(String key, String value) { headers.put(key, value); }
        @Override public OutputStream getOutputStream() { return output; }
        @Override public int getResponseCode() { return server.status; }
        @Override public long getContentLengthLong() { return server.reply.getBytes(StandardCharsets.UTF_8).length; }
        @Override public InputStream getInputStream() throws IOException {
            while (server.block && !stopped) try { Thread.sleep(5); } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException(); }
            if (stopped) throw new IOException("fixture-secret");
            String value = server.reply;
            try {
                JSONObject body = new JSONObject(output.toString("UTF-8"));
                JSONObject first = body.optJSONArray("tools") == null ? null : body.getJSONArray("tools").optJSONObject(0);
                if (first != null && "zenix_connection_probe".equals(first.getJSONObject("function").getString("name"))) {
                    String nonce = first.getJSONObject("function").getJSONObject("parameters").getJSONObject("properties").getJSONObject("nonce").getJSONArray("enum").getString(0);
                    value = "{\"choices\":[{\"finish_reason\":\"tool_calls\",\"message\":{\"content\":null,\"tool_calls\":[{\"id\":\"call_probe\",\"type\":\"function\",\"function\":{\"name\":\"zenix_connection_probe\",\"arguments\":" + JSONObject.quote(new JSONObject().put("nonce", nonce).toString()) + "}}]}}]}";
                }
            } catch (Exception error) { throw new IOException(error); }
            return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
        }
        @Override public void disconnect() { stopped = true; }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
    }
    static JSONObject settings(String endpoint, boolean withKey) throws Exception {
        JSONObject value = new JSONObject().put("enabled", true).put("endpoint", endpoint).put("model", "fixture");
        if (withKey) value.put("apiKey", "fixture-secret");
        return value;
    }
    static JSONObject request(String revision) throws Exception {
        return new JSONObject().put("requestId", UUID.randomUUID().toString()).put("revision", revision).put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", "当前歌手"))).put("tools", new JSONArray());
    }
    static Object complete(AssistantModel model, JSONObject request) throws Exception { return model.invoke(new JSONObject().put("action", "complete").put("request", request)); }
    static JSONObject read(AssistantModel model) throws Exception { return (JSONObject) model.invoke(new JSONObject().put("action", "read")); }
    public static void main(String[] ignored) throws Exception {
        Vault vault = new Vault(); Server server = new Server();
        AssistantModel model = new AssistantModel(vault, server, 5000);
        try {
            JSONObject empty = read(model); check(!empty.getBoolean("keyPresent"), "empty config");
            rejected("not_configured", () -> complete(model, request(empty.getString("revision")))); check(server.calls == 0, "no key starts no network");
            JSONObject configured = model.configure(settings("https://model.example/v1", true));
            check(configured.getString("endpoint").equals("https://model.example/v1/chat/completions"), "endpoint expansion");
            check(!configured.toString().contains("fixture-secret"), "masked config");
            JSONObject result = (JSONObject) complete(model, request(configured.getString("revision")));
            check(result.getString("content").equals("ready"), "normalized response");
            check(server.last.headers.get("Authorization").equals("Bearer fixture-secret"), "native-only auth");
            check(!server.last.getInstanceFollowRedirects(), "redirect disabled");
            check(!server.last.output.toString("UTF-8").contains("fixture-secret"), "no key in model context");
            result = (JSONObject) model.invoke(new JSONObject().put("action", "test").put("requestId", UUID.randomUUID().toString()));
            check(result.getBoolean("ok") && result.getBoolean("toolCalling"), "connection tool probe");
            server.status = 302; rejected("redirect", () -> complete(model, request(configured.getString("revision"))));
            server.status = 401; rejected("authentication", () -> complete(model, request(configured.getString("revision"))));
            server.status = 200; server.reply = "x".repeat(AssistantModelProtocol.MAX_RESPONSE_BYTES + 1);
            rejected("oversize", () -> complete(model, request(configured.getString("revision"))));
            server.reply = "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"fixture-secret\"}}]}";
            result = (JSONObject) complete(model, request(configured.getString("revision"))); check(!result.toString().contains("fixture-secret"), "response redaction");
            JSONObject cancelled = request(configured.getString("revision")); model.cancel(cancelled.getString("requestId"));
            rejected("cancelled", () -> complete(model, cancelled));
            for (String url : List.of("http://model.example", "https://user:secret@model.example", "https://model.example?secret=yes")) rejected("invalid_request", () -> AssistantModelProtocol.endpoint(url));
            JSONObject malformed = request(configured.getString("revision")); malformed.getJSONArray("messages").getJSONObject(0).put("operation", "exec");
            rejected("invalid_request", () -> complete(model, malformed));
            JSONObject moved = model.configure(settings("https://other.example/v1", false)); check(!moved.getBoolean("keyPresent"), "credentials cannot move endpoints");
            vault.fail = true; rejected("storage", () -> model.configure(settings("https://third.example/v1", true))); check(read(model).getString("revision").equals(moved.getString("revision")), "failed write preserves config"); vault.fail = false;
            String currentRevision = model.configure(settings("https://model.example/v1", true)).getString("revision");
            server.block = true; server.last = null;
            ExecutorService work = Executors.newSingleThreadExecutor();
            try {
                JSONObject ongoing = request(currentRevision);
                Future<?> pending = work.submit(() -> { try { rejected("cancelled", () -> complete(model, ongoing)); } catch (Exception error) { throw new RuntimeException(error); } });
                long until = System.nanoTime() + 2_000_000_000L;
                while (server.last == null && System.nanoTime() < until) Thread.sleep(5);
                check(server.last != null, "request started"); model.cancel(ongoing.getString("requestId")); pending.get(3, TimeUnit.SECONDS);
            } finally { work.shutdownNow(); server.block = false; }
        } finally { model.close(); }
        AssistantModel deadline = new AssistantModel(vault, server, 25);
        try { server.block = true; String revision = read(deadline).getString("revision"); rejected("timeout", () -> complete(deadline, request(revision))); }
        finally { deadline.close(); server.block = false; }
        AssistantModel broken = new AssistantModel(new AssistantModel.Vault() { public JSONObject read() throws Exception { throw new IOException("broken"); } public void write(JSONObject value) { throw new AssertionError("must preserve broken vault"); } }, server, 1000);
        try { rejected("storage", () -> read(broken)); } finally { broken.close(); }
        System.out.println("ASSISTANT_MODEL_JVM_PASS");
    }
}
