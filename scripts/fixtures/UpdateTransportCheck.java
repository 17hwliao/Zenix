package com.zenix.musicplayer;

import com.sun.net.httpserver.*;
import javax.net.SocketFactory;
import javax.net.ssl.*;
import java.net.*;
import java.nio.file.*;
import java.io.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import okhttp3.*;

public final class UpdateTransportCheck {
    static void require(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    static void rejected(Callable<?> action) throws Exception { try { action.call(); } catch (IOException expected) { return; } throw new AssertionError("Expected rejection"); }
    static final class RoutedSockets extends SocketFactory {
        final int port; final AtomicInteger connections = new AtomicInteger();
        RoutedSockets(int port) { this.port = port; }
        @Override public Socket createSocket() { return new Socket() {
            @Override public void connect(SocketAddress endpoint, int timeout) throws IOException {
                InetSocketAddress remote = (InetSocketAddress) endpoint;
                require(remote.getPort() == 443, "Production request must keep HTTPS port");
                require(remote.getAddress().getHostAddress().equals("198.18.0.2"), "Fake-IP resolution used");
                connections.incrementAndGet();super.connect(new InetSocketAddress("127.0.0.1", port), timeout);
            }
        }; }
        @Override public Socket createSocket(String h,int p) throws IOException {throw new IOException("Unexpected socket creation");}
        @Override public Socket createSocket(String h,int p,InetAddress l,int lp) throws IOException {throw new IOException("Unexpected socket creation");}
        @Override public Socket createSocket(InetAddress h,int p) throws IOException {throw new IOException("Unexpected socket creation");}
        @Override public Socket createSocket(InetAddress h,int p,InetAddress l,int lp) throws IOException {throw new IOException("Unexpected socket creation");}
    }
    public static void main(String[] args) throws Exception {
        for(String url:List.of("http://github.com/x","https://127.0.0.1/x","https://localhost/x","https://github.com.evil.test/x","https://evil.test/x","https://user@github.com/x","https://github.com:444/x","https://github.com/x#fragment","file:///x"))rejected(()->{UpdateUrlPolicy.validate(url);return null;});
        for(String host:List.of("github.com","raw.githubusercontent.com","release-assets.githubusercontent.com","objects.githubusercontent.com"))UpdateUrlPolicy.validate("https://"+host+"/x?synthetic=1");
        require(SourceAddressPolicy.blocked(InetAddress.getByName("198.18.0.2")), "Music sources still block Fake-IP");
        require(SourceAddressPolicy.blocked(InetAddress.getByName("127.0.0.1")), "Music sources still block loopback");
        KeyStore store=KeyStore.getInstance("PKCS12");try(InputStream input=Files.newInputStream(Path.of(args[0]))){store.load(input,"fixture-only".toCharArray());}
        KeyManagerFactory keys=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());keys.init(store,"fixture-only".toCharArray());
        TrustManagerFactory trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());trust.init(store);
        X509TrustManager manager=(X509TrustManager)trust.getTrustManagers()[0];SSLContext ssl=SSLContext.getInstance("TLS");ssl.init(keys.getKeyManagers(),trust.getTrustManagers(),new SecureRandom());
        HttpsServer server=HttpsServer.create(new InetSocketAddress("127.0.0.1",0),0);server.setHttpsConfigurator(new HttpsConfigurator(ssl));
        ExecutorService executor=Executors.newCachedThreadPool();server.setExecutor(executor);AtomicInteger requests=new AtomicInteger();CountDownLatch stalled=new CountDownLatch(1),release=new CountDownLatch(1);
        byte[] bytes="Synthetic update payload".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        server.createContext("/",exchange->{requests.incrementAndGet();try{
            String path=exchange.getRequestURI().getPath();
            if(path.equals("/redirect")||path.equals("/blocked")||path.equals("/loop")){
                exchange.getResponseHeaders().set("Location",path.equals("/redirect")?"https://release-assets.githubusercontent.com/artifact":path.equals("/blocked")?"http://127.0.0.1/internal":"https://github.com/loop");exchange.sendResponseHeaders(302,-1);
            }else if(path.equals("/slow")){exchange.sendResponseHeaders(200,1000);exchange.getResponseBody().write(new byte[]{1});exchange.getResponseBody().flush();stalled.countDown();try{release.await(5,TimeUnit.SECONDS);}catch(InterruptedException e){Thread.currentThread().interrupt();}}
            else{exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);}
        }finally{exchange.close();}});
        server.start();RoutedSockets sockets=new RoutedSockets(server.getAddress().getPort());
        OkHttpClient client=new OkHttpClient.Builder().sslSocketFactory(ssl.getSocketFactory(),manager).socketFactory(sockets)
            .dns(host->List.of(InetAddress.getByName("198.18.0.2"))).proxy(Proxy.NO_PROXY).protocols(List.of(Protocol.HTTP_1_1)).build();
        UpdateHttp http=new UpdateHttp(client);AtomicReference<Call> call=new AtomicReference<>();
        try{
            try(Response response=http.open("https://github.com/redirect",5000,()->false,call::set)){require(Arrays.equals(response.body().bytes(),bytes),"Valid TLS over Fake-IP downloads after redirect");}
            int before=requests.get();rejected(()->http.open("https://github.com/blocked",5000,()->false,call::set));require(requests.get()==before+1,"Forbidden redirect rejected before connecting");
            rejected(()->http.open("https://github.com/loop",5000,()->false,call::set));
            rejected(()->http.open("https://raw.githubusercontent.com/artifact",5000,()->false,call::set)); // Certificate deliberately lacks this hostname.
            UpdateHttp untrusted=new UpdateHttp(new OkHttpClient.Builder().socketFactory(sockets).dns(host->List.of(InetAddress.getByName("198.18.0.2"))).proxy(Proxy.NO_PROXY).build());
            rejected(()->untrusted.open("https://github.com/artifact",5000,()->false,call::set)); // A self-signed certificate is never trusted by production defaults.
            before=requests.get();rejected(()->http.open("https://github.com/artifact",5000,()->true,call::set));require(requests.get()==before,"Pre-cancel does not connect");
            AtomicBoolean cancelled=new AtomicBoolean();rejected(()->http.open("https://github.com/artifact",5000,cancelled::get,c->{call.set(c);cancelled.set(true);}));require(requests.get()==before,"Cancel during registration does not connect");
            try(Response response=http.open("https://github.com/slow",5000,()->false,call::set)){require(stalled.await(2,TimeUnit.SECONDS),"Slow body started");call.get().cancel();rejected(()->response.body().bytes());}
            System.out.println("UPDATE_TRANSPORT_PASS");
        }finally{release.countDown();server.stop(0);executor.shutdownNow();client.connectionPool().evictAll();}
    }
}
