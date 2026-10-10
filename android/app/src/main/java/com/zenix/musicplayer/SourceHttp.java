package com.zenix.musicplayer;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;

final class SourceHttp {
    static final int MAX_BYTES=4*1024*1024;
    private static final ExecutorService DNS=new ThreadPoolExecutor(4,4,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(16));
    private static final OkHttpClient BASE=new OkHttpClient.Builder().dns(SourceHttp::addresses).followRedirects(false).followSslRedirects(false).connectTimeout(8,TimeUnit.SECONDS).readTimeout(15,TimeUnit.SECONDS).connectionPool(new ConnectionPool(4,30,TimeUnit.SECONDS)).build();
    private static List<InetAddress> addresses(String host)throws UnknownHostException {
        return addresses(host,5000);
    }
    private static List<InetAddress> addresses(String host,long timeoutMs)throws UnknownHostException {
        Future<InetAddress[]> lookup;
        try{lookup=DNS.submit(()->InetAddress.getAllByName(host));}catch(RejectedExecutionException error){throw new UnknownHostException("域名查询队列已满");}
        List<InetAddress> result;
        try{result=Arrays.asList(lookup.get(Math.max(1,Math.min(5000,timeoutMs)),TimeUnit.MILLISECONDS));}
        catch(InterruptedException error){Thread.currentThread().interrupt();throw new UnknownHostException("域名查询已取消");}
        catch(Exception error){throw new UnknownHostException("域名查询超时或失败");}
        finally{if(!lookup.isDone())lookup.cancel(true);}
        if(result.isEmpty())throw new UnknownHostException("资源服务器没有地址");
        for(InetAddress address:result)if(SourceAddressPolicy.blocked(address))throw new UnknownHostException("音乐源不能访问内网、本机或保留地址");
        return result;
    }
    private static URL rule(String address,JSONArray allowed,boolean allowHttp)throws IOException {
        URL url=new URL(address);String host=url.getHost().toLowerCase(Locale.ROOT);
        if(!(url.getProtocol().equals("https")||url.getProtocol().equals("http"))||url.getUserInfo()!=null||host.isEmpty()||host.equals("localhost")||host.endsWith(".localhost")||host.endsWith(".local")||host.endsWith(".internal"))throw new IOException("无效网络地址");
        if(!url.getProtocol().equals("https")&&!allowHttp)throw new IOException("该音乐源尚未授权 HTTP，请在源选项中开启兼容访问");
        if(allowed!=null){boolean match=false;for(int i=0;i<allowed.length();i++){String r=allowed.optString(i).toLowerCase(Locale.ROOT);if(host.equals(r)||r.startsWith("*.")&&host.endsWith(r.substring(1)))match=true;}if(!match)throw new IOException("网络地址不在音乐源声明范围");}return url;
    }
    // DNS is checked inside the actual connection, and the returned addresses are
    // the exact candidates OkHttp connects to. No second system lookup occurs.
    static OkHttpClient client(JSONArray allowed,int timeoutMs){return client(allowed,timeoutMs,false);}
    static OkHttpClient client(JSONArray allowed,int timeoutMs,boolean allowHttp){return BASE.newBuilder().readTimeout(timeoutMs,TimeUnit.MILLISECONDS).addInterceptor(chain->{
        Request request=chain.request();
        for(int hop=0;hop<=5;hop++){
            rule(request.url().toString(),allowed,allowHttp);Response response=chain.proceed(request);int status=response.code();
            if(status!=301&&status!=302&&status!=303&&status!=307&&status!=308)return response;
            String location=response.header("Location");if(location==null)return response;
            HttpUrl next=request.url().resolve(location);response.close();if(next==null||hop==5)throw new IOException("重定向无效或次数过多");
            rule(next.toString(),allowed,allowHttp);if(request.url().isHttps()&&!next.isHttps())throw new IOException("禁止 HTTPS 降级到 HTTP");
            Request.Builder builder=request.newBuilder().url(next);
            if(!next.scheme().equals(request.url().scheme())||!next.host().equals(request.url().host())||next.port()!=request.url().port())for(String key:request.headers().names())if(key.matches("(?i).*authorization.*|.*cookie.*|.*token.*|.*api[-_]?key.*"))builder.removeHeader(key);
            if(status==303&& !request.method().equals("HEAD")||(status==301||status==302)&&request.method().equals("POST")){builder.get().removeHeader("Content-Type").removeHeader("Content-Length");}
            request=builder.build();
        }throw new IOException("重定向次数过多");
    }).build();}
    static URL check(String address,JSONArray allowed) throws Exception {
        return check(address,allowed,false);
    }
    static URL check(String address,JSONArray allowed,boolean allowHttp) throws Exception {
        return check(address,allowed,allowHttp,5000);
    }
    static URL check(String address,JSONArray allowed,boolean allowHttp,long timeoutMs) throws Exception {
        URL url=rule(address,allowed,allowHttp);addresses(url.getHost(),timeoutMs);
        return url;
    }
    static JSONObject request(String address,JSONObject options,JSONArray allowed) throws Exception {
        return request(address,options,allowed,null);
    }
    static JSONObject request(String address,JSONObject options,JSONArray allowed,java.util.function.Consumer<Call> register) throws Exception {
        return request(address,options,allowed,register,false);
    }
    static JSONObject request(String address,JSONObject options,JSONArray allowed,java.util.function.Consumer<Call> register,boolean allowHttp) throws Exception {
        URL url=rule(address,allowed,allowHttp); String method=options.optString("method","GET").toUpperCase(Locale.ROOT);
        if(!method.equals("GET")&&!method.equals("POST")) throw new Exception("只支持 GET/POST");
        JSONObject headers=options.optJSONObject("headers");
        String body=options.has("body")?String.valueOf(options.opt("body")):"";
        if(options.optJSONObject("json")!=null) {body=options.getJSONObject("json").toString();if(headers==null)headers=new JSONObject();Json.put(headers,"Content-Type","application/json");}
        if(options.optJSONObject("formData")!=null) {
            String boundary="Zenix"+UUID.randomUUID().toString().replace("-","");JSONObject form=options.getJSONObject("formData");StringBuilder parts=new StringBuilder();
            for(Iterator<String> it=form.keys();it.hasNext();) {String key=it.next().replaceAll("[\\r\\n\"]","");parts.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"").append(key).append("\"\r\n\r\n").append(form.optString(key)).append("\r\n");}
            parts.append("--").append(boundary).append("--\r\n");body=parts.toString();if(headers==null)headers=new JSONObject();Json.put(headers,"Content-Type","multipart/form-data; boundary="+boundary);
        }
        if(options.optJSONObject("form")!=null) { JSONObject form=options.getJSONObject("form"); StringBuilder s=new StringBuilder(); for(Iterator<String> it=form.keys();it.hasNext();) { String key=it.next(); if(s.length()>0)s.append('&'); s.append(URLEncoder.encode(key,"UTF-8")).append('=').append(URLEncoder.encode(form.optString(key),"UTF-8")); } body=s.toString(); if(headers==null)headers=new JSONObject(); Json.put(headers,"Content-Type","application/x-www-form-urlencoded"); }
        if(body.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES) throw new Exception("请求内容过大");
        OkHttpClient client=client(allowed,Math.max(2000,Math.min(15000,options.optInt("timeout",10000))),allowHttp);
        Request.Builder builder=new Request.Builder().url(url.toString()).header("User-Agent","Zenix Android").header("Accept-Encoding","identity");
        if(headers!=null)for(Iterator<String> it=headers.keys();it.hasNext();){String key=it.next();if(key.equalsIgnoreCase("Host")||key.equalsIgnoreCase("Content-Length")||key.contains("\n")||key.contains("\r"))continue;builder.header(key,headers.optString(key));}
        if(method.equals("POST"))builder.post(RequestBody.create(body.getBytes(StandardCharsets.UTF_8),(MediaType)null));
        Call call=client.newCall(builder.build());call.timeout().timeout(18,TimeUnit.SECONDS);if(register!=null)register.accept(call);
        try(Response response=call.execute()){JSONObject resultHeaders=new JSONObject();for(String key:response.headers().names())Json.put(resultHeaders,key.toLowerCase(Locale.ROOT),String.join(", ",response.headers().values(key)));ResponseBody responseBody=response.body();if(responseBody!=null&&responseBody.contentLength()>MAX_BYTES)throw new IOException("内容超过大小限制");byte[] bytes=responseBody==null?new byte[0]:bounded(responseBody.byteStream(),MAX_BYTES);return Json.obj("status",response.code(),"headers",resultHeaders,"data",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP));}
    }
    static byte[] bounded(InputStream input,int limit) throws IOException {
        try(InputStream in=input;ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[8192]; int count;
            while((count=in.read(buffer))!=-1) { if(output.size()+count>limit)throw new IOException("内容超过大小限制");output.write(buffer,0,count); } return output.toByteArray();
        }
    }
}
