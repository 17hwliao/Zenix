package com.zenix.musicplayer;

import java.io.*;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.LongConsumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import okhttp3.Call;
import okhttp3.Response;
import okhttp3.ResponseBody;

/** Signed-size/hash-bound bytes only. APK identity validation remains with AppUpdates. */
final class UpdateDownload {
    private static final class InvalidDownload extends IOException { InvalidDownload(String message) { super(message); } }
    private static final Pattern RANGE = Pattern.compile("bytes ([0-9]+)-([0-9]+)/([0-9]+)");
    private static void active(BooleanSupplier cancelled) throws IOException {
        if (cancelled.getAsBoolean()) throw new InterruptedIOException("下载已取消");
    }
    private static IOException discard(File partial, String message) {
        if (partial.exists() && !partial.delete()) return new IOException(message + "；无法清理无效下载，请检查存储空间");
        return new IOException(message);
    }
    static void fetch(UpdateHttp http, String address, File partial, long expected, String sha256,
                      BooleanSupplier cancelled, Consumer<Call> register, LongConsumer progress) throws Exception {
        if (expected < 1 || expected > 512L * 1024 * 1024 || !sha256.matches("[a-f0-9]{64}")) throw new IOException("更新安装包声明无效");
        active(cancelled);
        long offset = partial.exists() ? partial.length() : 0;
        if (offset > expected) throw discard(partial,"已有下载超过声明大小，已清理，请重试");
        if (offset == expected) {
            if (hash(partial,cancelled).equals(sha256)) { progress.accept(expected); return; }
            throw discard(partial,"安装包校验失败，已清理，请重新下载");
        }
        long total = offset;
        progress.accept(total);
        try (Response response = http.openDownload(address, offset, cancelled, register)) {
            active(cancelled);
            int code = response.code();
            if (code == 416) throw discard(partial,"服务器拒绝续传位置，已清理，请重新下载");
            if (code != 200 && code != 206) throw new IOException("更新下载失败（HTTP " + code + "）");
            ResponseBody body = response.body();
            if (body == null) throw new IOException("更新安装包为空");
            String encoding = response.header("Content-Encoding");
            if (encoding != null && !"identity".equalsIgnoreCase(encoding)) throw discard(partial,"安装包响应编码无效");
            if (code == 206) {
                Matcher range = RANGE.matcher(response.header("Content-Range", ""));
                boolean valid = false;
                if (range.matches()) try {
                    valid = Long.parseLong(range.group(1)) == offset && Long.parseLong(range.group(2)) == expected - 1
                        && Long.parseLong(range.group(3)) == expected;
                } catch (NumberFormatException ignored) { /* Reject overflow. */ }
                if (!valid) throw discard(partial,"服务器续传范围与发布记录不一致");
            } else {
                // A server may ignore Range; never append the full response.
                total = 0;
                progress.accept(0);
            }
            long remaining = expected - total;
            if (body.contentLength() >= 0 && body.contentLength() != remaining) throw discard(partial,"安装包大小与发布记录不一致");
            try (InputStream input = body.byteStream(); OutputStream output = new FileOutputStream(partial, code == 206)) {
                byte[] buffer = new byte[65536]; int count;
                while (true) {
                    active(cancelled);
                    count = input.read(buffer);
                    active(cancelled);
                    if (count == -1) break;
                    if (count == 0) continue;
                    if (total + count > expected) throw new InvalidDownload("安装包超过声明大小");
                    output.write(buffer, 0, count); total += count;
                    progress.accept(total);
                }
            }
        } catch (InvalidDownload error) { throw discard(partial,error.getMessage()); }
        active(cancelled);
        // Truncated network responses retain useful bytes. The next attempt
        // validates the exact range and always hashes the entire final file.
        if (total != expected) throw new IOException("安装包下载尚未完成，重试将继续下载");
        if (!hash(partial,cancelled).equals(sha256)) throw discard(partial,"安装包校验失败，已清理，请重新下载");
    }
    private static String hash(File file, BooleanSupplier cancelled) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        try(InputStream input=new FileInputStream(file)) {
            byte[] buffer=new byte[65536]; int count;
            while((count=input.read(buffer))!=-1) { active(cancelled); digest.update(buffer,0,count); }
        }
        active(cancelled);
        StringBuilder text=new StringBuilder();for(byte value:digest.digest())text.append(String.format(Locale.ROOT,"%02x",value&255));return text.toString();
    }
}
