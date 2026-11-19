package com.zenix.musicplayer;

import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import java.io.IOException;
import java.net.ConnectException;
import java.net.InetAddress;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** Client-only bridge. The WebView authenticates and encrypts every control frame. */
final class KaraokeSocket {
    private static final Pattern ADDRESS = Pattern.compile("((?:0|[1-9][0-9]{0,2})(?:\\.(?:0|[1-9][0-9]{0,2})){3}):([1-9][0-9]{0,4})");
    private final Handler cleanup = new Handler(Looper.getMainLooper());
    private final Set<KaraokeWebSocket> closing = new LinkedHashSet<>();
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(0, 8, 15L, TimeUnit.SECONDS,
            new SynchronousQueue<>(), task -> new Thread(task, "zenix-karaoke-socket"));
    private KaraokeWebSocket active;
    private String activeId;

    synchronized Object invoke(JSONObject args, Consumer<JSObject> notify) throws IOException {
        switch (args.optString("action")) {
            case "connect":
                return connect(args.optString("address"), args.optString("id"), notify);
            case "send":
                if (active == null || !args.optString("id").equals(activeId) || !active.send(args.optString("data"))) {
                    throw new IOException("K 歌连接当前无法发送消息");
                }
                return true;
            case "close":
                if (args.optString("id").equals(activeId)) close();
                return true;
            case "stop":
                close();
                return true;
            default:
                throw new IOException("无效的 K 歌网络操作");
        }
    }

    private boolean connect(String address, String id, Consumer<JSObject> notify) throws IOException {
        Matcher match = ADDRESS.matcher(address);
        if (active != null || !id.matches("guest-[0-9]{1,10}") || address.length() > 21 || !match.matches()) {
            throw new IOException("请输入局域网 IP 和端口");
        }
        String ip = match.group(1);
        int port = Integer.parseInt(match.group(2));
        if (port > 65535) throw new IOException("请输入局域网 IP 和端口");
        InetAddress target = privateIpv4(ip);
        KaraokeWebSocket socket = new KaraokeWebSocket(target, port, workers, new KaraokeWebSocket.Listener() {
            private void emit(String type, String field, String value, boolean terminal) {
                synchronized (KaraokeSocket.this) {
                    if (!id.equals(activeId)) return;
                    JSObject event = new JSObject().put("type", type).put("id", id).put("address", ip);
                    if (field != null) event.put(field, value);
                    if (terminal) {
                        active = null;
                        activeId = null;
                    }
                    notify.accept(event);
                }
            }

            @Override public void opened() { emit("open", null, null, false); }

            @Override public void text(String value) { emit("message", "data", value, false); }

            @Override public void ended(IOException error) {
                if (error == null) emit("closed", null, null, true);
                else {
                    String code = error instanceof ConnectException && error.getMessage() != null
                            && error.getMessage().toLowerCase(Locale.ROOT).contains("refused") ? "PORT_REFUSED" : "UNREACHABLE";
                    emit("error", "code", code, true);
                }
            }
        });
        active = socket;
        activeId = id;
        try { workers.execute(socket); }
        catch (RejectedExecutionException e) {
            active = null;
            activeId = null;
            socket.cancel();
            throw new IOException("K 歌连接正在关闭，请稍后重试", e);
        }
        return true;
    }

    private static InetAddress privateIpv4(String ip) throws IOException {
        String[] fields = ip.split("\\.");
        byte[] octets = new byte[4];
        for (int i = 0; i < octets.length; i++) {
            int value = Integer.parseInt(fields[i]);
            if (value > 255) throw new IOException("请输入局域网 IP 和端口");
            octets[i] = (byte) value;
        }
        int a = octets[0] & 255, b = octets[1] & 255;
        if (!(a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168))) {
            throw new IOException("请输入局域网 IP 和端口");
        }
        // Resolve nothing. The validated bytes are the only allowed destination.
        return InetAddress.getByAddress(octets);
    }

    synchronized void close() {
        KaraokeWebSocket previous = active;
        active = null;
        activeId = null;
        if (previous == null) return;
        if (closing.size() >= 2) {
            KaraokeWebSocket oldest = closing.iterator().next();
            closing.remove(oldest);
            oldest.cancel();
        }
        previous.close();
        closing.add(previous);
        cleanup.postDelayed(() -> {
            synchronized (KaraokeSocket.this) {
                if (closing.remove(previous)) previous.cancel();
            }
        }, 750);
    }

    synchronized void destroy() {
        if (active != null) active.cancel();
        active = null;
        activeId = null;
        cleanup.removeCallbacksAndMessages(null);
        for (KaraokeWebSocket socket : closing) socket.cancel();
        closing.clear();
        workers.shutdownNow();
    }
}
