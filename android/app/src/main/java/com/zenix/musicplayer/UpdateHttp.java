package com.zenix.musicplayer;

import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import okhttp3.*;

/** Fixed HTTPS origins use normal OS routing, including VPN Fake-IP; TLS still authenticates the host. */
final class UpdateHttp {
    private static final ExecutorService DNS = new ThreadPoolExecutor(2, 2, 0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(8));
    private static final OkHttpClient BASE = new OkHttpClient.Builder()
        .dns(UpdateHttp::addresses).connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS)
        .connectionPool(new ConnectionPool(2, 30, TimeUnit.SECONDS)).build();
    private final OkHttpClient client;
    private final OkHttpClient downloads;
    UpdateHttp() { this(BASE, 90000); }
    // Injection is package-private for isolated TLS integration tests, never exposed by the native bridge.
    UpdateHttp(OkHttpClient client) {
        this(client, client.readTimeoutMillis());
    }
    private UpdateHttp(OkHttpClient client, long downloadIdleMs) {
        this.client = client.newBuilder().followRedirects(false).followSslRedirects(false)
            .cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).build();
        // A large APK may legitimately take longer than ten minutes. A read
        // timeout protects a stalled transfer; it must not expire active work.
        this.downloads = this.client.newBuilder().readTimeout(downloadIdleMs, TimeUnit.MILLISECONDS)
            .callTimeout(0, TimeUnit.MILLISECONDS).build();
    }
    private static List<InetAddress> addresses(String host) throws UnknownHostException {
        Future<InetAddress[]> lookup;
        try { lookup = DNS.submit(() -> InetAddress.getAllByName(host)); }
        catch (RejectedExecutionException error) { throw new UnknownHostException("更新服务器域名查询队列已满"); }
        try {
            List<InetAddress> result = Arrays.asList(lookup.get(5, TimeUnit.SECONDS));
            if (result.isEmpty()) throw new UnknownHostException("更新服务器没有可用地址");
            return result;
        } catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new UnknownHostException("更新域名查询已取消"); }
        catch (Exception error) { throw new UnknownHostException("更新服务器域名查询超时或失败"); }
        finally { if (!lookup.isDone()) lookup.cancel(true); }
    }
    Response open(String address, long timeoutMs, BooleanSupplier cancelled, Consumer<Call> register) throws IOException {
        return open(address, timeoutMs, 0, client, cancelled, register);
    }
    Response openDownload(String address, long offset, BooleanSupplier cancelled, Consumer<Call> register) throws IOException {
        if (offset < 0) throw new IOException("更新续传位置无效");
        return open(address, 0, offset, downloads, cancelled, register);
    }
    private Response open(String address, long timeoutMs, long offset, OkHttpClient transport, BooleanSupplier cancelled, Consumer<Call> register) throws IOException {
        long deadline = timeoutMs > 0 ? System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs) : 0;
        for (int hop = 0; hop <= 5; hop++) {
            UpdateUrlPolicy.validate(address);
            if (cancelled.getAsBoolean()) throw new IOException("下载已取消");
            long remaining = deadline - System.nanoTime();
            if (timeoutMs > 0 && remaining <= 0) throw new IOException("更新连接超时，请重试");
            Request.Builder request = new Request.Builder().url(address).get().header("User-Agent", "Zenix Android Updates")
                .header("Accept-Encoding", "identity").header("Cache-Control", "no-cache");
            if (offset > 0) request.header("Range", "bytes=" + offset + "-");
            Call call = transport.newCall(request.build());
            if (timeoutMs > 0) call.timeout().timeout(remaining, TimeUnit.NANOSECONDS);
            register.accept(call);
            if (cancelled.getAsBoolean()) { call.cancel(); throw new IOException("下载已取消"); }
            Response response = call.execute(); int status = response.code();
            if (status != 301 && status != 302 && status != 303 && status != 307 && status != 308) return response;
            String location = response.header("Location"); HttpUrl next = location == null ? null : response.request().url().resolve(location);
            response.close();
            if (hop == 5 || next == null) throw new IOException("更新下载重定向无效或次数过多");
            address = next.toString(); // Validate every new origin before a connection is opened.
        }
        throw new IOException("更新下载重定向次数过多");
    }
}
