package com.zenix.musicplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class AssistantAttachments implements AssistantModel.AttachmentStore {
    private static final int MAX_IMAGE = 2 * 1024 * 1024;
    private final File folder;
    private final AtomicFile history;
    private Set<String> retained = new HashSet<>();
    private boolean historyError;

    AssistantAttachments(Context context) {
        folder = new File(context.getFilesDir(), "assistant-attachments");
        history = new AtomicFile(new File(context.getFilesDir(), "assistant-conversations.v1.json"));
    }

    private File file(String id) throws IOException {
        if (!id.matches("[a-f0-9-]{36}")) throw AssistantModelProtocol.error("attachment", "图片引用无效");
        return new File(folder, id + ".jpg");
    }

    private byte[] read(File file, int maximum) throws Exception {
        try (InputStream input = new FileInputStream(file)) {
            return AssistantModel.readBounded(input, maximum, () -> {});
        }
    }

    public synchronized JSONObject importImage(JSONObject value) throws Exception {
        String encoded = value.getString("base64");
        if (encoded.length() > 28 * 1024 * 1024 || !encoded.matches("[A-Za-z0-9+/]*={0,2}")) throw AssistantModelProtocol.error("attachment", "图片数据无效或超过 20 MiB");
        byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
        if (bytes.length == 0 || bytes.length > 20 * 1024 * 1024) throw AssistantModelProtocol.error("attachment", "图片超过 20 MiB");
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (!Set.of("image/png", "image/jpeg", "image/webp").contains(bounds.outMimeType == null ? "" : bounds.outMimeType)) throw AssistantModelProtocol.error("attachment", "只支持真实的 PNG、JPEG 或 WebP 图片");
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0 || (long) bounds.outWidth * bounds.outHeight > 40_000_000 || bounds.outWidth > 20000 || bounds.outHeight > 20000) throw AssistantModelProtocol.error("attachment", "图片解码尺寸超过限制");
        long used = 0;
        File[] savedImages = folder.listFiles();
        if (savedImages != null) for (File savedImage : savedImages) used += savedImage.length();
        if (used + MAX_IMAGE > 128 * 1024 * 1024) throw AssistantModelProtocol.error("attachment", "助手图片存储已达 128 MiB，请删除部分历史图片");
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / (options.inSampleSize * 2) >= 2048) options.inSampleSize *= 2;
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (decoded == null) throw AssistantModelProtocol.error("attachment", "图片无法解码");
        Bitmap scaled = decoded;
        try {
            double factor = Math.min(1, 2048.0 / Math.max(decoded.getWidth(), decoded.getHeight()));
            if (factor < 1) scaled = Bitmap.createScaledBitmap(decoded, Math.max(1, (int) Math.round(decoded.getWidth() * factor)), Math.max(1, (int) Math.round(decoded.getHeight() * factor)), true);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!scaled.compress(Bitmap.CompressFormat.JPEG, 85, output)) throw AssistantModelProtocol.error("attachment", "图片编码失败");
            if (output.size() > MAX_IMAGE) {output.reset(); scaled.compress(Bitmap.CompressFormat.JPEG, 60, output);}
            if (output.size() > MAX_IMAGE) throw AssistantModelProtocol.error("attachment", "处理后的图片仍超过 2 MiB，请裁剪后再试");
            if (!folder.isDirectory() && !folder.mkdirs()) throw AssistantModelProtocol.error("attachment", "附件目录无法创建");
            String id = UUID.randomUUID().toString();
            try (FileOutputStream saved = new FileOutputStream(file(id))) {output.writeTo(saved);}
            String name = value.optString("name", "图片").replaceAll("[\\x00-\\x1f]", "");
            return new JSONObject().put("id", id).put("name", name.substring(0, Math.min(180, name.length())))
                .put("bytes", output.size()).put("width", scaled.getWidth()).put("height", scaled.getHeight()).put("preview", preview(id));
        } finally {if (scaled != decoded) scaled.recycle(); decoded.recycle();}
    }

    public synchronized String preview(String id) throws Exception {
        byte[] bytes = read(file(id), MAX_IMAGE);
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 4;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
        if (bitmap == null) throw AssistantModelProtocol.error("attachment", "已保存的图片损坏");
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 70, output);
            return "data:image/jpeg;base64," + Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
        } finally {bitmap.recycle();}
    }

    public synchronized JSONArray hydrate(JSONArray messages) throws Exception {
        JSONArray result = new JSONArray(messages.toString());
        int total = 0;
        for (int index = 0; index < result.length(); index++) {
            JSONObject message = result.getJSONObject(index);
            JSONArray content = message.optJSONArray("content");
            if (content == null) continue;
            for (int partIndex = 0; partIndex < content.length(); partIndex++) {
                JSONObject part = content.getJSONObject(partIndex);
                if (!part.getString("type").equals("image")) continue;
                byte[] image;
                try {image = read(file(part.getString("attachmentId")), MAX_IMAGE);} catch (Exception ignored) {throw AssistantModelProtocol.error("attachment", "图片已不可用，请重新添加");}
                total += image.length;
                if (total > 8 * 1024 * 1024) throw AssistantModelProtocol.error("attachment", "本次图片总量超过 8 MiB，请减少图片或开始新会话");
                content.put(partIndex, new JSONObject().put("type", "image_url").put("image_url", new JSONObject().put("url", "data:image/jpeg;base64," + Base64.encodeToString(image, Base64.NO_WRAP))));
            }
        }
        return result;
    }

    private Set<String> validateHistory(JSONObject value) throws Exception {
        if (value.getInt("schemaVersion") != 1 || value.toString().getBytes(StandardCharsets.UTF_8).length > 4 * 1024 * 1024) throw AssistantModelProtocol.error("attachment", "会话记录格式无效或过大");
        JSONArray conversations = value.getJSONArray("conversations");
        if (conversations.length() > 20) throw AssistantModelProtocol.error("attachment", "会话数量超出限制");
        Set<String> conversationIds = new HashSet<>(), ids = new HashSet<>();
        for (int index = 0; index < conversations.length(); index++) {
            JSONObject conversation = conversations.getJSONObject(index);
            String id = conversation.getString("id");
            if (!id.matches("[a-f0-9-]{36}") || !conversationIds.add(id) || conversation.getString("title").length() > 100) throw AssistantModelProtocol.error("attachment", "会话记录无效");
            JSONArray messages = new JSONArray(conversation.getJSONArray("messages").toString());
            if (messages.length() > 100) throw AssistantModelProtocol.error("attachment", "会话消息超出限制");
            JSONObject draft = conversation.getJSONObject("draft");
            if (draft.getString("text").length() > 4000) throw AssistantModelProtocol.error("attachment", "草稿过长");
            for (int messageIndex = 0; messageIndex < messages.length(); messageIndex++) {
                JSONObject message = messages.getJSONObject(messageIndex);
                if (!Set.of("user", "assistant").contains(message.getString("role")) || message.getString("text").length() > 24000) throw AssistantModelProtocol.error("attachment", "会话消息无效");
            }
            messages.put(draft);
            for (int messageIndex = 0; messageIndex < messages.length(); messageIndex++) {
                JSONArray images = messages.getJSONObject(messageIndex).getJSONArray("attachments");
                if (images.length() > 8) throw AssistantModelProtocol.error("attachment", "会话附件超出限制");
                for (int imageIndex = 0; imageIndex < images.length(); imageIndex++) {
                    JSONObject image = images.getJSONObject(imageIndex);
                    String imageId = image.getString("id");
                    file(imageId);
                    if (image.has("preview") || image.getString("name").length() > 180) throw AssistantModelProtocol.error("attachment", "会话附件资料无效");
                    ids.add(imageId);
                }
            }
        }
        if (conversations.length() > 0 && !conversationIds.contains(value.getString("activeId"))) throw AssistantModelProtocol.error("attachment", "当前会话无效");
        return ids;
    }

    public synchronized Object readHistory() throws Exception {
        try (FileInputStream input = history.openRead()) {
            JSONObject value = new JSONObject(new String(AssistantModel.readBounded(input, 4 * 1024 * 1024, () -> {}), StandardCharsets.UTF_8));
            retained = validateHistory(value);
            pruneOrphans();
            return value;
        } catch (FileNotFoundException ignored) {pruneOrphans(); return JSONObject.NULL;}
        catch (Exception failure) {historyError = true; throw AssistantModelProtocol.error("attachment", "历史会话无法读取，原文件已保留");}
    }

    private void pruneOrphans() {
        File[] images = folder.listFiles();
        if (images == null) return;
        for (File image : images) {
            String id = image.getName().replaceFirst("\\.jpg$", "");
            if (id.matches("[a-f0-9-]{36}") && !retained.contains(id) && System.currentTimeMillis() - image.lastModified() > 24 * 60 * 60 * 1000) image.delete();
        }
    }

    public synchronized boolean saveHistory(JSONObject value) throws Exception {
        if (historyError) throw AssistantModelProtocol.error("attachment", "历史文件无法读取，已保留原文件，本次未覆盖");
        Set<String> ids = validateHistory(value);
        FileOutputStream output = null;
        try {output = history.startWrite(); output.write(value.toString().getBytes(StandardCharsets.UTF_8)); history.finishWrite(output);}
        catch (Exception failure) {if (output != null) history.failWrite(output); throw failure;}
        for (String id : retained) if (!ids.contains(id)) file(id).delete();
        retained = ids;
        return true;
    }

    public synchronized boolean remove(String id) throws Exception {if (!retained.contains(id)) file(id).delete(); return true;}
}
