package com.zenix.musicplayer;

import org.json.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Transport shape checks only. The client tool registry owns business schemas and execution. */
final class AssistantModelProtocol {
    static final int MAX_RESPONSE_BYTES = 256 * 1024;
    static final int MAX_REQUEST_BYTES = 256 * 1024;
    static final int MODEL_TIMEOUT_MS = 90_000;
    static final String NAME = "[A-Za-z0-9_-]{1,64}";
    static final String REQUEST_ID = "[A-Za-z0-9_-]{8,100}";

    static final class ModelException extends IOException {
        final String code;
        ModelException(String code, String message) { super(message); this.code = code; }
    }
    static ModelException error(String code, String message) { return new ModelException(code, message); }
    static JSONObject object(Object raw, Set<String> allowed, String... required) throws Exception {
        if (!(raw instanceof JSONObject)) throw error("invalid_request", "模型请求格式无效");
        JSONObject value = (JSONObject) raw;
        for (Iterator<String> keys = value.keys(); keys.hasNext();) if (!allowed.contains(keys.next())) throw error("invalid_request", "模型请求字段无效");
        for (String key : required) if (!value.has(key)) throw error("invalid_request", "模型请求缺少必要字段");
        return value;
    }
    static String text(Object raw, int maximum, int minimum) throws Exception {
        if (!(raw instanceof String) || ((String) raw).length() < minimum || ((String) raw).length() > maximum) throw error("invalid_request", "模型请求文字长度无效");
        return (String) raw;
    }
    static String endpoint(String raw) throws Exception {
        text(raw, 2000, 0);
        if (raw.trim().isEmpty()) return "";
        URI uri;
        try { uri = new URI(raw.trim()); } catch (Exception ignored) { throw error("invalid_request", "请输入 HTTPS 模型服务地址"); }
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getPort() == 0 || uri.getPort() > 65535) throw error("invalid_request", "模型服务仅支持不含凭据、查询参数的 HTTPS 地址");
        String path = uri.getRawPath().replaceAll("/+$", "");
        if (!path.endsWith("/chat/completions")) path += "/chat/completions";
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        if (host.contains(":")) host = "[" + host.replace("[", "").replace("]", "") + "]";
        return "https://" + host + (uri.getPort() > 0 && uri.getPort() != 443 ? ":" + uri.getPort() : "") + path;
    }
    static JSONObject defaults() throws Exception {
        return new JSONObject().put("enabled", false).put("endpoint", "").put("model", "").put("apiKey", "").put("revision", UUID.randomUUID().toString());
    }
    static JSONObject config(JSONObject input, JSONObject previous) throws Exception {
        object(input, Set.of("enabled", "endpoint", "model", "apiKey", "clearKey", "replyStyle", "persona", "toolsEnabled", "streamMode"), "enabled", "endpoint", "model");
        if (!(input.get("enabled") instanceof Boolean) || input.has("clearKey") && !(input.get("clearKey") instanceof Boolean)) throw error("invalid_request", "模型开关无效");
        String address = endpoint(text(input.get("endpoint"), 2000, 0)), model = text(input.get("model"), 200, 0).trim();
        if (input.getBoolean("enabled") && (address.isEmpty() || model.isEmpty())) throw error("invalid_request", "启用远程助手前请填写服务地址和模型");
        if (model.contains("\r") || model.contains("\n") || model.indexOf(0) >= 0) throw error("invalid_request", "模型名称无效");
        String key = previous != null && address.equals(previous.optString("endpoint")) ? previous.optString("apiKey") : "";
        if (input.optBoolean("clearKey")) key = "";
        if (input.has("apiKey")) {
            String supplied = text(input.get("apiKey"), 4096, 0).trim();
            if (!supplied.isEmpty() && !supplied.matches("[\\x21-\\x7e]+")) throw error("invalid_request", "API Key 不能包含空白或控制字符");
            if (!supplied.isEmpty()) key = supplied;
        }
        JSONObject result = new JSONObject().put("enabled", input.getBoolean("enabled")).put("endpoint", address).put("model", model).put("apiKey", key).put("revision", UUID.randomUUID().toString());
        for (String field : List.of("replyStyle", "streamMode", "persona", "toolsEnabled")) {
            Object value = input.has(field) ? input.get(field) : previous == null ? null : previous.opt(field);
            if (value == null) continue;
            if (field.equals("replyStyle") && !Set.of("concise", "detailed").contains(value) || field.equals("streamMode") && !Set.of("stream", "json").contains(value) || field.equals("toolsEnabled") && !(value instanceof Boolean)) throw error("invalid_request", "回复偏好无效");
            if (field.equals("persona")) text(value, 2000, 0);
            result.put(field, value);
        }
        return result;
    }
    static JSONObject mask(JSONObject value) throws Exception {
        boolean saved = !value.optString("apiKey").isEmpty();
        JSONObject result = new JSONObject(value.toString());
        result.remove("apiKey");
        return result.put("keyPresent", saved).put("keyHint", saved ? "••••••••" : "");
    }
    static void schema(JSONObject value, int depth) throws Exception {
        if (depth > 8) throw error("invalid_request", "工具参数结构过深");
        object(value, Set.of("type", "description", "properties", "required", "additionalProperties", "enum", "minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems", "items"), "type");
        String type = value.getString("type");
        if (!Set.of("object", "string", "number", "integer", "boolean", "array").contains(type)) throw error("invalid_request", "工具参数类型无效");
        if (value.has("description")) text(value.get("description"), 2000, 0);
        if (value.has("enum")) {
            JSONArray choices = value.getJSONArray("enum");
            if (choices.length() > 100) throw error("invalid_request", "工具枚举无效");
            for (int i = 0; i < choices.length(); i++) if (!(choices.get(i) instanceof String || choices.get(i) instanceof Number || choices.get(i) instanceof Boolean)) throw error("invalid_request", "工具枚举无效");
        }
        for (String key : List.of("minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems")) {
            if (value.has(key) && (!(value.get(key) instanceof Number) || !Double.isFinite(value.getDouble(key)) || Math.abs(value.getDouble(key)) > 1_000_000)) throw error("invalid_request", "工具参数边界无效");
        }
        if (value.has("uniqueItems") && !(value.get("uniqueItems") instanceof Boolean)) throw error("invalid_request", "工具参数结构无效");
        if (type.equals("object")) {
            if (!value.has("additionalProperties") || !Boolean.FALSE.equals(value.get("additionalProperties"))) throw error("invalid_request", "工具对象必须拒绝未知字段");
            JSONObject properties = value.optJSONObject("properties");
            if (value.has("properties") && properties == null) throw error("invalid_request", "工具字段结构无效");
            if (properties == null) properties = new JSONObject();
            if (properties.length() > 32) throw error("invalid_request", "工具字段过多");
            for (Iterator<String> keys = properties.keys(); keys.hasNext();) {
                String key = keys.next();
                if (!key.matches(NAME)) throw error("invalid_request", "工具字段名无效");
                schema(properties.getJSONObject(key), depth + 1);
            }
            JSONArray required = value.optJSONArray("required");
            if (value.has("required") && required == null) throw error("invalid_request", "工具必填字段无效");
            if (required != null) for (int i = 0; i < required.length(); i++) if (!(required.get(i) instanceof String) || !properties.has(required.getString(i))) throw error("invalid_request", "工具必填字段无效");
        }
        if (type.equals("array")) schema(value.getJSONObject("items"), depth + 1);
    }
    static JSONObject request(JSONObject value) throws Exception {
        object(value, Set.of("requestId", "revision", "messages", "tools", "stream"), "requestId", "revision", "messages", "tools");
        if (value.has("stream") && !(value.get("stream") instanceof Boolean)) throw error("invalid_request", "流式设置无效");
        if (!text(value.get("requestId"), 100, 8).matches(REQUEST_ID)) throw error("invalid_request", "模型请求编号无效");
        text(value.get("revision"), 100, 1);
        JSONArray messages = value.getJSONArray("messages"), tools = value.getJSONArray("tools");
        if (messages.length() < 1 || messages.length() > 32 || tools.length() > 32) throw error("invalid_request", "对话或工具数量无效");
        Set<String> pending = new HashSet<>(), names = new HashSet<>();
        for (int i = 0; i < messages.length(); i++) {
            JSONObject message = object(messages.get(i), Set.of("role", "content", "tool_calls", "tool_call_id"), "role", "content");
            String role = message.getString("role");
            if (!Set.of("system", "user", "assistant", "tool").contains(role)) throw error("invalid_request", "对话角色无效");
            if (message.optJSONArray("content") != null) {
                JSONArray parts = message.getJSONArray("content");
                if (!role.equals("user") || parts.length() < 1 || parts.length() > 9) throw error("invalid_request", "图文消息格式无效");
                int images = 0, textLength = 0;
                for (int partIndex = 0; partIndex < parts.length(); partIndex++) {
                    JSONObject part = parts.getJSONObject(partIndex);
                    if (part.optString("type").equals("text")) {
                        object(part, Set.of("type", "text"), "type", "text");
                        textLength += text(part.get("text"), 4000, 0).length();
                    } else {
                        object(part, Set.of("type", "attachmentId"), "type", "attachmentId");
                        if (!part.getString("type").equals("image") || !part.getString("attachmentId").matches("[a-f0-9-]{36}")) throw error("invalid_request", "图片引用无效");
                        images++;
                    }
                }
                if (images > 8 || textLength > 4000) throw error("invalid_request", "图文消息超出限制");
            } else if (!message.isNull("content")) text(message.get("content"), role.equals("user") ? 4000 : 24000, 0);
            if (!role.equals("assistant") && message.has("tool_calls") || !role.equals("tool") && message.has("tool_call_id")) throw error("invalid_request", "对话工具字段无效");
            if (role.equals("tool")) { if (!pending.remove(message.optString("tool_call_id"))) throw error("invalid_request", "工具结果没有对应调用"); }
            else if (!pending.isEmpty()) throw error("invalid_request", "上一轮工具结果尚未齐全");
            if (message.has("tool_calls")) {
                JSONArray calls = message.getJSONArray("tool_calls");
                if (calls.length() > 4) throw error("invalid_request", "单轮工具调用过多");
                for (int j = 0; j < calls.length(); j++) {
                    JSONObject call = object(calls.get(j), Set.of("id", "type", "function"), "id", "type", "function");
                    JSONObject function = object(call.get("function"), Set.of("name", "arguments"), "name", "arguments");
                    if (!"function".equals(call.getString("type")) || !call.getString("id").matches(NAME) || !function.getString("name").matches(NAME) || !pending.add(call.getString("id"))) throw error("invalid_request", "工具调用无效");
                    text(function.get("arguments"), 12000, 0);
                }
            }
        }
        if (!pending.isEmpty()) throw error("invalid_request", "工具结果尚未齐全");
        for (int i = 0; i < tools.length(); i++) {
            JSONObject tool = object(tools.get(i), Set.of("type", "function"), "type", "function");
            JSONObject function = object(tool.get("function"), Set.of("name", "description", "parameters"), "name", "description", "parameters");
            if (!"function".equals(tool.getString("type")) || !function.getString("name").matches(NAME) || !names.add(function.getString("name"))) throw error("invalid_request", "工具名称无效或重复");
            text(function.get("description"), 4000, 0); schema(function.getJSONObject("parameters"), 0);
            if (!"object".equals(function.getJSONObject("parameters").getString("type"))) throw error("invalid_request", "工具参数必须为对象");
        }
        if (value.toString().getBytes(StandardCharsets.UTF_8).length > MAX_REQUEST_BYTES) throw error("invalid_request", "对话过长，请开始新对话");
        return value;
    }
    static final class StreamReply {
        final StringBuilder content = new StringBuilder();
        final Map<Integer, JSONObject> calls = new TreeMap<>();
        final java.util.function.Consumer<String> delta;
        final String secret;
        String held = "";
        boolean done, finished;

        StreamReply(String secret, java.util.function.Consumer<String> delta) {this.secret = secret; this.delta = delta;}

        void emit(String value, boolean flush) {
            held += value;
            if (!secret.isEmpty()) held = held.replace(secret, "[凭据已隐藏]");
            int end = flush ? held.length() : Math.max(0, held.length() - secret.length());
            if (end > 0 && delta != null) delta.accept(held.substring(0, end));
            held = held.substring(end);
        }

        void event(String payload) throws Exception {
            if (payload.isEmpty()) return;
            if (payload.equals("[DONE]")) {done = true; return;}
            if (done) throw error("protocol", "流式回复结束后又返回了数据");
            JSONObject raw = new JSONObject(payload);
            if (raw.has("error")) throw error("service", "模型流式回复中断");
            JSONArray choices = raw.optJSONArray("choices");
            if (choices == null || choices.length() == 0) return;
            JSONObject choice = choices.getJSONObject(0);
            if (choice.optInt("index", 0) != 0) return;
            JSONObject fragment = choice.optJSONObject("delta");
            if (fragment == null) fragment = new JSONObject();
            if (finished && (fragment.has("content") && !fragment.isNull("content") || fragment.has("tool_calls"))) throw error("protocol", "流式回复结束顺序无效");
            if (!fragment.optString("refusal").isEmpty()) throw error("refused", "模型拒绝处理这条请求");
            if (fragment.has("content") && !fragment.isNull("content")) {
                String text = text(fragment.get("content"), MAX_RESPONSE_BYTES, 0);
                content.append(text);
                if (content.toString().getBytes(StandardCharsets.UTF_8).length > MAX_RESPONSE_BYTES) throw error("oversize", "模型回复过大");
                emit(text, false);
            }
            JSONArray fragments = fragment.optJSONArray("tool_calls");
            if (fragment.has("tool_calls") && (fragments == null || fragments.length() > 4)) throw error("protocol", "流式工具格式无效");
            if (fragments != null) for (int index = 0; index < fragments.length(); index++) {
                JSONObject part = fragments.getJSONObject(index);
                Object rawIndex = part.get("index");
                if (!(rawIndex instanceof Number) || part.getDouble("index") != part.getInt("index") || part.getInt("index") < 0 || part.getInt("index") >= 4) throw error("protocol", "流式工具序号无效");
                int callIndex = part.getInt("index");
                if (part.has("type") && !part.getString("type").equals("function")) throw error("protocol", "流式工具类型无效");
                JSONObject call = calls.get(callIndex);
                if (call == null) {call = new JSONObject().put("id", "").put("type", "function").put("function", new JSONObject().put("name", "").put("arguments", "")); calls.put(callIndex, call);}
                JSONObject function = part.optJSONObject("function");
                for (String field : List.of("id", "name", "arguments")) {
                    JSONObject source = field.equals("id") ? part : function;
                    if (source == null || !source.has(field)) continue;
                    JSONObject target = field.equals("id") ? call : call.getJSONObject("function");
                    String value = target.getString(field) + text(source.get(field), field.equals("arguments") ? 12000 : 64, 0);
                    if (value.length() > (field.equals("arguments") ? 12000 : 64)) throw error("oversize", "流式工具参数超出限制");
                    target.put(field, value);
                }
            }
            if (choice.has("finish_reason") && !choice.isNull("finish_reason")) {
                if (!Set.of("stop", "tool_calls").contains(choice.getString("finish_reason"))) throw error("protocol", "模型回复未完整完成，未执行功能");
                finished = true;
            }
        }

        JSONObject read(InputStream input, AssistantModel.Check check) throws Exception {
            InputStream limited = new FilterInputStream(input) {
                int consumed;
                @Override public int read(byte[] bytes, int offset, int length) throws IOException {int count = super.read(bytes, offset, length); if (count > 0 && (consumed += count) > 2 * 1024 * 1024) throw error("oversize", "流式回复总量超出限制"); return count;}
            };
            java.nio.charset.CharsetDecoder decoder = StandardCharsets.UTF_8.newDecoder().onMalformedInput(java.nio.charset.CodingErrorAction.REPORT);
            BufferedReader reader = new BufferedReader(new InputStreamReader(limited, decoder));
            String line;
            StringBuilder payload = new StringBuilder();
            while ((line = reader.readLine()) != null) {
                check.run();
                if (line.length() > MAX_RESPONSE_BYTES) throw error("oversize", "流式消息行过大");
                if (line.isEmpty()) {event(payload.toString()); payload.setLength(0); if (done) break;}
                else if (line.startsWith("data:")) {if (payload.length() > 0) payload.append('\n'); payload.append(line.substring(5).replaceFirst("^ ", ""));}
                if (payload.length() > MAX_RESPONSE_BYTES) throw error("oversize", "流式消息过大");
            }
            if (payload.length() > 0) event(payload.toString());
            if (!done || !finished) throw error("protocol", "模型连接提前结束，已保留收到的文字，未执行半截工具调用");
            check.run(); emit("", true);
            JSONArray tools = new JSONArray(); for (JSONObject call : calls.values()) tools.put(call);
            return new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("finish_reason", calls.isEmpty() ? "stop" : "tool_calls").put("message", new JSONObject().put("content", content.toString()).put("tool_calls", tools))));
        }
    }

    static JSONObject response(JSONObject raw, Set<String> names, String secret) throws Exception {
        JSONObject choice = raw.getJSONArray("choices").getJSONObject(0), message = choice.getJSONObject("message");
        String finish = choice.optString("finish_reason");
        if (!finish.isEmpty() && !Set.of("stop", "tool_calls").contains(finish)) throw error("protocol", "模型回复未完整完成，未执行功能");
        if (message.has("refusal") && !message.isNull("refusal") && !message.optString("refusal").isEmpty()) throw error("refused", "模型拒绝处理这条请求");
        Object content = message.opt("content");
        if (content != null && content != JSONObject.NULL && !(content instanceof String)) throw error("protocol", "模型未返回支持的文字回复");
        JSONArray calls = message.optJSONArray("tool_calls"), normalized = new JSONArray();
        if (message.has("tool_calls") && calls == null || calls != null && calls.length() > 4) throw error("protocol", "模型返回的工具调用数量无效");
        Set<String> ids = new HashSet<>();
        if (calls != null) for (int i = 0; i < calls.length(); i++) {
            JSONObject call = calls.getJSONObject(i), function = call.getJSONObject("function");
            String id = call.getString("id"), name = function.getString("name"), arguments = function.getString("arguments");
            if (!id.matches(NAME) || !ids.add(id) || !"function".equals(call.getString("type")) || !names.contains(name) || arguments.length() > 12000) throw error("protocol", "模型返回了无效或未提供的功能调用");
            normalized.put(new JSONObject().put("id", id).put("name", name).put("arguments", arguments));
        }
        JSONObject result = new JSONObject().put("content", content instanceof String ? content : "").put("toolCalls", normalized);
        if (result.getString("content").isEmpty() && normalized.length() == 0) throw error("protocol", "模型没有返回文字或功能调用");
        if (!secret.isEmpty()) {
            String escaped = JSONObject.quote(secret);
            escaped = escaped.substring(1, escaped.length() - 1);
            result.put("content", result.getString("content").replace(secret, "[凭据已隐藏]").replace(escaped, "[凭据已隐藏]"));
            for (int i = 0; i < normalized.length(); i++) {
                JSONObject call = normalized.getJSONObject(i);
                call.put("arguments", call.getString("arguments").replace(secret, "[凭据已隐藏]").replace(escaped, "[凭据已隐藏]"));
            }
        }
        return result;
    }
}
