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
    UpdateHttp() { this(BASE); }
    // Injection is package-private for isolated TLS integration tests, never exposed by the native bridge.
    UpdateHttp(OkHttpClient client) {
        this.client = client.newBuilder().followRedirects(false).followSslRedirects(false)
            .cookieJar(CookieJar.NO_COOKIES).authenticator(Authenticator.NONE).build();
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
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs);
        for (int hop = 0; hop <= 5; hop++) {
            UpdateUrlPolicy.validate(address);
            if (cancelled.getAsBoolean()) throw new IOException("下载已取消");
            long remaining = deadline - System.nanoTime();
            if (remaining <= 0) throw new IOException("更新连接超时，请重试");
            Request request = new Request.Builder().url(address).get().header("User-Agent", "Zenix Android Updates")
                .header("Accept-Encoding", "identity").header("Cache-Control", "no-cache").build();
            Call call = client.newCall(request); call.timeout().timeout(remaining, TimeUnit.NANOSECONDS); register.accept(call);
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
