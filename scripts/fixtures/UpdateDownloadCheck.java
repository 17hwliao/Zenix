package com.zenix.musicplayer;

import com.sun.net.httpserver.*;
import javax.net.ssl.*;
import java.net.*;
import java.nio.file.*;
import java.io.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import okhttp3.*;

/** Real TLS streaming and filesystem checks against the production download core. */
public final class UpdateDownloadCheck {
    static void require(boolean ok,String message){if(!ok)throw new AssertionError(message);}
    static void rejected(Callable<?> action)throws Exception{try{action.call();}catch(IOException expected){return;}throw new AssertionError("Expected rejection");}
    static String hash(byte[] bytes)throws Exception{StringBuilder out=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
    public static void main(String[] args)throws Exception{
        KeyStore store=KeyStore.getInstance("PKCS12");try(InputStream input=Files.newInputStream(Path.of(args[0]))){store.load(input,"fixture-only".toCharArray());}
        KeyManagerFactory keys=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());keys.init(store,"fixture-only".toCharArray());
        TrustManagerFactory trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());trust.init(store);
        X509TrustManager manager=(X509TrustManager)trust.getTrustManagers()[0];SSLContext ssl=SSLContext.getInstance("TLS");ssl.init(keys.getKeyManagers(),trust.getTrustManagers(),new SecureRandom());
        HttpsServer server=HttpsServer.create(new InetSocketAddress("127.0.0.1",0),0);server.setHttpsConfigurator(new HttpsConfigurator(ssl));
        ExecutorService executor=Executors.newCachedThreadPool();server.setExecutor(executor);
        byte[] bytes=new byte[4096];new Random(41).nextBytes(bytes);String digest=hash(bytes);
        AtomicInteger requests=new AtomicInteger();AtomicReference<String> requestedRange=new AtomicReference<>();CountDownLatch stalled=new CountDownLatch(1),release=new CountDownLatch(1);
        server.createContext("/",exchange->{requests.incrementAndGet();requestedRange.set(exchange.getRequestHeaders().getFirst("Range"));String route=exchange.getRequestURI().getPath();try{
            if(route.equals("/stall")){exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes,0,1);exchange.getResponseBody().flush();stalled.countDown();release.await(4,TimeUnit.SECONDS);}
            else if(route.equals("/slow")){exchange.sendResponseHeaders(200,bytes.length);for(int i=0;i<bytes.length;i+=128){exchange.getResponseBody().write(bytes,i,128);exchange.getResponseBody().flush();Thread.sleep(35);}}
            else if(route.equals("/drop")){exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes,0,1024);exchange.getResponseBody().flush();}
            else if(route.equals("/416")){exchange.getResponseHeaders().set("Content-Range","bytes */"+bytes.length);exchange.sendResponseHeaders(416,-1);}
            else if(route.equals("/oversize")){exchange.sendResponseHeaders(200,0);exchange.getResponseBody().write(bytes);exchange.getResponseBody().write(12);}
            else if(route.equals("/wrong")){byte[] wrong=bytes.clone();wrong[0]^=1;exchange.sendResponseHeaders(200,wrong.length);exchange.getResponseBody().write(wrong);}
            else if(route.startsWith("/range")||route.startsWith("/bad")){
                String raw=exchange.getRequestHeaders().getFirst("Range");int offset=raw==null?0:Integer.parseInt(raw.substring(6,raw.length()-1));
                int start=route.equals("/bad-start")?offset+1:offset,total=route.equals("/bad-total")?bytes.length+1:bytes.length,end=route.equals("/bad-end")?bytes.length-2:bytes.length-1;
                exchange.getResponseHeaders().set("Content-Range","bytes "+start+"-"+end+"/"+total);
                exchange.sendResponseHeaders(206,route.equals("/bad-length")?bytes.length-offset-1:bytes.length-offset);exchange.getResponseBody().write(bytes,offset,bytes.length-offset);
            }else if(route.equals("/redirect")){exchange.getResponseHeaders().set("Location","https://release-assets.githubusercontent.com/range");exchange.sendResponseHeaders(302,-1);}
            else{exchange.sendResponseHeaders(200,bytes.length);exchange.getResponseBody().write(bytes);}
        }catch(Exception ignored){}finally{exchange.close();}});server.start();
        UpdateTransportCheck.RoutedSockets sockets=new UpdateTransportCheck.RoutedSockets(server.getAddress().getPort());
        OkHttpClient client=new OkHttpClient.Builder().sslSocketFactory(ssl.getSocketFactory(),manager).socketFactory(sockets)
            .dns(host->List.of(InetAddress.getByName("198.18.0.2"))).proxy(Proxy.NO_PROXY).protocols(List.of(Protocol.HTTP_1_1))
            .callTimeout(150,TimeUnit.MILLISECONDS).readTimeout(500,TimeUnit.MILLISECONDS).connectTimeout(2,TimeUnit.SECONDS).build();
        UpdateHttp http=new UpdateHttp(client);AtomicReference<Call> call=new AtomicReference<>();Path directory=Path.of(args[1]);File partial=directory.resolve("synthetic-r58-"+digest+".part").toFile();
        try{
            long began=System.nanoTime();AtomicInteger events=new AtomicInteger();
            UpdateDownload.fetch(http,"https://github.com/slow",partial,bytes.length,digest,()->false,call::set,n->events.incrementAndGet());
            require(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-began)>700,"Healthy streaming outlives inherited total call budget");require(events.get()>10,"Healthy streaming reports repeated byte progress");require(Arrays.equals(Files.readAllBytes(partial.toPath()),bytes),"Healthy download exact bytes");
            int before=requests.get();UpdateDownload.fetch(http,"https://github.com/full",partial,bytes.length,digest,()->false,call::set,n->{});require(requests.get()==before,"Complete partial verified without downloading again");partial.delete();
            rejected(()->{UpdateDownload.fetch(http,"https://github.com/drop",partial,bytes.length,digest,()->false,call::set,n->{});return null;});require(partial.length()>0&&partial.length()<bytes.length,"Interrupted response preserves partial");long offset=partial.length();
            UpdateDownload.fetch(http,"https://github.com/redirect",partial,bytes.length,digest,()->false,call::set,n->{});require(("bytes="+offset+"-").equals(requestedRange.get()),"Range survives trusted redirect");require(Arrays.equals(Files.readAllBytes(partial.toPath()),bytes),"Resumed file hashes entire original prefix and suffix");
            Files.write(partial.toPath(),Arrays.copyOf(bytes,1024));AtomicBoolean restarted=new AtomicBoolean();UpdateDownload.fetch(http,"https://github.com/full",partial,bytes.length,digest,()->false,call::set,n->{if(n==0)restarted.set(true);});require(restarted.get()&&partial.length()==bytes.length,"HTTP 200 truncates existing Range partial");
            for(String route:List.of("bad-start","bad-total","bad-end","bad-length","416")){
                Files.write(partial.toPath(),Arrays.copyOf(bytes,1024));rejected(()->{UpdateDownload.fetch(http,"https://github.com/"+route,partial,bytes.length,digest,()->false,call::set,n->{});return null;});require(!partial.exists(),"Invalid range discarded: "+route);
            }
            for(String route:List.of("wrong","oversize")){rejected(()->{UpdateDownload.fetch(http,"https://github.com/"+route,partial,bytes.length,digest,()->false,call::set,n->{});return null;});require(!partial.exists(),"Invalid download discarded: "+route);}
            byte[] badPrefix=Arrays.copyOf(bytes,1024);badPrefix[10]^=1;Files.write(partial.toPath(),badPrefix);rejected(()->{UpdateDownload.fetch(http,"https://github.com/range",partial,bytes.length,digest,()->false,call::set,n->{});return null;});require(!partial.exists(),"Resumed corrupted prefix fails whole-file hash");
            before=requests.get();Files.write(partial.toPath(),new byte[bytes.length]);rejected(()->{UpdateDownload.fetch(http,"https://github.com/full",partial,bytes.length,digest,()->false,call::set,n->{});return null;});require(!partial.exists()&&requests.get()==before,"Complete invalid partial discarded before network");
            long stalledAt=System.nanoTime();rejected(()->{UpdateDownload.fetch(http,"https://github.com/stall",partial,bytes.length,digest,()->false,call::set,n->{});return null;});require(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-stalledAt)<2200,"Continuous inactivity remains bounded");require(partial.length()==1,"Stall preserves written prefix");partial.delete();
            AtomicBoolean cancelled=new AtomicBoolean();CountDownLatch progressed=new CountDownLatch(1);Future<?> running=executor.submit(()->{try{UpdateDownload.fetch(http,"https://github.com/stall",partial,bytes.length,digest,cancelled::get,call::set,n->{if(n>0)progressed.countDown();});throw new AssertionError("Cancel must reject");}catch(IOException expected){}catch(Exception failure){throw new RuntimeException(failure);}});
            require(progressed.await(2,TimeUnit.SECONDS),"Cancel test entered blocking read");long cancelAt=System.nanoTime();cancelled.set(true);call.get().cancel();running.get(1,TimeUnit.SECONDS);require(TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-cancelAt)<900,"Explicit cancel interrupts active read promptly");require(partial.length()==1,"Explicit cancel retains resumable bytes");
            int pre=requests.get();rejected(()->{UpdateDownload.fetch(http,"https://github.com/full",partial,bytes.length,digest,()->true,call::set,n->{});return null;});require(requests.get()==pre,"Pre-cancel opens no network request");
            System.out.println("UPDATE_DOWNLOAD_PASS");
        }finally{release.countDown();server.stop(0);executor.shutdownNow();client.connectionPool().evictAll();client.dispatcher().executorService().shutdownNow();}
    }
}
