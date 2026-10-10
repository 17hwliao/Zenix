package com.zenix.musicplayer;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.*;
import android.webkit.*;
import android.util.Base64;
import org.json.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.X509EncodedKeySpec;
import javax.crypto.*;
import javax.crypto.spec.*;
import java.io.*;
import java.util.concurrent.*;
import java.util.zip.*;

/** A source gets HTTP/crypto only. No application, file, playlist or credential bridge. */
final class ScriptEngine implements AutoCloseable {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ConcurrentHashMap<Long,CompletableFuture<Object>> pending=new ConcurrentHashMap<>();
    private final CompletableFuture<JSONObject> ready=new CompletableFuture<>();
    private final ExecutorService network=new ThreadPoolExecutor(3,3,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(8));
    private final JSONArray apiHosts;
    private final boolean allowHttp;
    private WebView view; private long sequence; private volatile boolean closed;
    private final java.util.Set<okhttp3.Call> requests=ConcurrentHashMap.newKeySet();
    boolean isClosed(){return closed;}
    boolean isBusy(){return !closed&&(!ready.isDone()||!pending.isEmpty());}
    @SuppressLint({"SetJavaScriptEnabled","AddJavascriptInterface"})
    ScriptEngine(Context context,String script,JSONObject info,JSONArray allowed,boolean catalog) {
        this(context,script,info,allowed,catalog,false);
    }
    @SuppressLint({"SetJavaScriptEnabled","AddJavascriptInterface"})
    ScriptEngine(Context context,String script,JSONObject info,JSONArray allowed,boolean catalog,boolean allowHttp) {
        apiHosts=allowed;
        this.allowHttp=allowHttp;
        main.post(() -> {
            try {
                if(closed) return;
                view=new WebView(context.getApplicationContext());
                WebSettings settings=view.getSettings(); settings.setJavaScriptEnabled(true); settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setBlockNetworkLoads(true); settings.setDomStorageEnabled(false); settings.setMediaPlaybackRequiresUserGesture(true);
                view.addJavascriptInterface(new Host(),"NativeHost");
                view.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request) { return true; }
                    @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request) { return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0])); }
                    @Override public void onPageFinished(WebView v,String url) {
                        if(closed)return;
                        try {
                            evaluate("globalThis.__scriptInfo="+info+";\n"+asset(context,"host.js"));
                            if(catalog) evaluate(asset(context,"catalog.js")+"; NativeHost.ready('{}');");
                            else evaluate(script);
                        } catch(Exception e) { ready.completeExceptionally(e); }
                    }
                    @Override public boolean onRenderProcessGone(WebView v,RenderProcessGoneDetail detail) {
                        fail(new Exception("音乐源运行进程已退出，请重试")); close(); return true;
                    }
                });
                view.setWebChromeClient(new WebChromeClient(){ @Override public boolean onConsoleMessage(ConsoleMessage message) { if(message.messageLevel()==ConsoleMessage.MessageLevel.ERROR&&!ready.isDone()) ready.completeExceptionally(new Exception("音乐源初始化失败："+message.message().substring(0,Math.min(180,message.message().length())))); return true; } });
                view.loadDataWithBaseURL("https://source.zenix.invalid/","<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-eval' 'unsafe-inline'\">","text/html","UTF-8",null);
            } catch(Exception e) { ready.completeExceptionally(e); }
        });
    }
    private static String asset(Context context,String name) throws IOException { return new String(SourceHttp.bounded(context.getAssets().open("zenix/"+name),2*1024*1024),StandardCharsets.UTF_8); }
    JSONObject ready() throws Exception {return ready(18000);}
    JSONObject ready(long timeoutMs) throws Exception {try{return ready.get(Math.max(1,timeoutMs),TimeUnit.MILLISECONDS);}catch(TimeoutException error){close();throw new TimeoutException("音乐源初始化等待超时");}catch(InterruptedException error){close();Thread.currentThread().interrupt();throw error;}}
    Object call(String method,Object payload,JSONObject settings) throws Exception {return call(method,payload,settings,20000);}
    synchronized Object call(String method,Object payload,JSONObject settings,long timeoutMs) throws Exception {
        long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(Math.max(1,timeoutMs));
        ready(timeoutMs); if(closed)throw new Exception("音乐源运行层已关闭");
        long id=++sequence; CompletableFuture<Object> result=new CompletableFuture<>(); pending.put(id,result);
        main.post(() -> { if(!closed) evaluate("__invoke("+id+","+JSONObject.quote(method)+","+payload+","+settings+")"); });
        try { return result.get(Math.max(1,deadline-System.nanoTime()),TimeUnit.NANOSECONDS); }
        catch(TimeoutException error){close();throw new TimeoutException("音乐源解析等待超时");}
        catch(InterruptedException error){close();Thread.currentThread().interrupt();throw error;}
        finally { pending.remove(id); }
    }
    private void evaluate(String code) { if(view!=null&&!closed) view.evaluateJavascript(code,null); }
    private void fail(Exception e) { ready.completeExceptionally(e); pending.values().forEach(f -> f.completeExceptionally(e));pending.clear(); }
    @Override public void close() { closed=true; fail(new Exception("音乐源已关闭"));for(okhttp3.Call call:requests)call.cancel();requests.clear();network.shutdownNow(); main.post(() -> { if(view!=null) { view.removeJavascriptInterface("NativeHost");view.destroy();view=null; } }); }
    private final class Host {
        @JavascriptInterface public void ready(String json) { try { if(json.length()>256*1024)throw new IOException("源声明过大");ready.complete(new JSONObject(json)); } catch(Exception e) { ready.completeExceptionally(e); } }
        @JavascriptInterface public void result(String json) {
            if(json==null||json.length()>SourceHttp.MAX_BYTES){fail(new IOException("音乐源返回数据超过大小限制"));close();return;}
            try { JSONObject value=new JSONObject(json); CompletableFuture<Object> f=pending.get(value.getLong("id")); if(f==null)return; if(value.has("error"))f.completeExceptionally(new Exception(value.optString("error")));else f.complete(value.opt("value")); }catch(Exception error){fail(new IOException("音乐源返回数据格式错误",error));close();}
        }
        @JavascriptInterface public void http(String json) {
            if(closed)return;
            if(json==null||json.length()>SourceHttp.MAX_BYTES){fail(new IOException("音乐源网络请求超过大小限制"));close();return;}
            try {
                JSONObject request=new JSONObject(json); long id=request.getLong("id");
                network.execute(() -> {
                    String result,error;
                    okhttp3.Call[] running=new okhttp3.Call[1];
                    try { result=SourceHttp.request(request.getString("url"),request.optJSONObject("options")==null ? new JSONObject() : request.getJSONObject("options"),apiHosts,call->{running[0]=call;requests.add(call);if(closed)call.cancel();},allowHttp).toString();error="null"; }
                    catch(Exception e) { result="null";error=JSONObject.quote(Json.message(e)); }
                    finally{if(running[0]!=null)requests.remove(running[0]);}
                    String js="__networkResult("+id+","+result+","+error+")"; main.post(() -> evaluate(js));
                });
            } catch(Exception error) {try{long id=new JSONObject(json).getLong("id");main.post(()->evaluate("__networkResult("+id+",null,\"网络请求队列已满或关闭\")"));}catch(Exception ignored){}}
        }
        @JavascriptInterface public String crypto(String json) {
            try {
                if(json.length()>256*1024)throw new Exception("加密数据过大");
                JSONObject request=new JSONObject(json),values=request.getJSONObject("values"); String action=request.getString("action"); byte[] input=decode(values.optString("buffer"));byte[] output;
                switch(action) {
                    case "md5": output=MessageDigest.getInstance("MD5").digest(input);StringBuilder hex=new StringBuilder();for(byte b:output)hex.append(String.format("%02x",b&255));return Json.obj("value",hex.toString()).toString();
                    case "randomBytes": int size=values.getInt("size");if(size<0||size>4096)throw new Exception("随机字节大小无效"); output=new byte[size];new SecureRandom().nextBytes(output);break;
                    case "aesEncrypt": String mode=values.getString("mode").toLowerCase(java.util.Locale.ROOT);boolean cbc=mode.contains("cbc"); Cipher aes=Cipher.getInstance("AES/"+(cbc?"CBC":"ECB")+"/PKCS5Padding");SecretKeySpec key=new SecretKeySpec(decode(values.getString("key")),"AES"); if(cbc)aes.init(Cipher.ENCRYPT_MODE,key,new IvParameterSpec(decode(values.getString("iv"))));else aes.init(Cipher.ENCRYPT_MODE,key);output=aes.doFinal(input);break;
                    case "rsaEncrypt": String pem=values.getString("key").replaceAll("-----[^-]+-----","").replaceAll("\\s",""); RSAPublicKey rsaKey=(RSAPublicKey)KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(decode(pem))); int block=(rsaKey.getModulus().bitLength()+7)/8;if(input.length>block)throw new Exception("RSA 数据过大");byte[] padded=new byte[block];System.arraycopy(input,0,padded,block-input.length,input.length);Cipher rsa=Cipher.getInstance("RSA/ECB/NoPadding");rsa.init(Cipher.ENCRYPT_MODE,rsaKey);output=rsa.doFinal(padded);break;
                    default: throw new Exception("不支持的加密方法");
                }
                return Json.obj("bytes",Base64.encodeToString(output,Base64.NO_WRAP)).toString();
            } catch(Exception e) { return Json.obj("error",Json.message(e)).toString(); }
        }
        @JavascriptInterface public String zlib(String action,String encoded) {
            try {
                if(encoded.length()>2*1024*1024)throw new IOException("压缩数据过大");byte[] input=decode(encoded),output;
                if(action.equals("inflate"))output=SourceHttp.bounded(new InflaterInputStream(new ByteArrayInputStream(input)),4*1024*1024);
                else if(action.equals("deflate")) { ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(DeflaterOutputStream deflater=new DeflaterOutputStream(bytes)) { deflater.write(input); }output=bytes.toByteArray(); }
                else throw new IOException("无效压缩方式");
                return Base64.encodeToString(output,Base64.NO_WRAP);
            } catch(Exception e) { throw new IllegalArgumentException(Json.message(e)); }
        }
        private byte[] decode(String value) { return Base64.decode(value,Base64.DEFAULT); }
    }
}
