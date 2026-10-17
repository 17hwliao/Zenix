package com.zenix.acceptance;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import org.json.JSONObject;
import java.io.*;
import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/** Opt-in original-signed test. Source comparison includes only the selected song,
 * source hashes and redacted transport results; never exports the complete store or scripts. */
public final class UpdateAcceptanceInstrumentation extends Instrumentation {
    private Bundle arguments;
    private volatile Activity foregroundActivity;
    @Override public void callActivityOnResume(Activity activity) {
        super.callActivityOnResume(activity);foregroundActivity=activity;
        activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    @Override public void onCreate(Bundle args) { arguments=args==null?new Bundle():args; super.onCreate(args); start(); }
    @Override public void onStart() {
        Bundle result=new Bundle();
        try { result.putString("zenixAcceptance",run().toString());finish(Activity.RESULT_OK,result); }
        catch(Throwable error) {
            Throwable cause=error instanceof InvocationTargetException?((InvocationTargetException)error).getTargetException():error;
            result.putString("zenixAcceptance","{\"ok\":false,\"errorType\":"+JSONObject.quote(cause.getClass().getSimpleName())+",\"message\":"+JSONObject.quote(String.valueOf(cause.getMessage()))+"}");
            finish(Activity.RESULT_CANCELED,result);
        }
    }
    private JSONObject run() throws Exception {
        Context target=getTargetContext();String mode=arguments.getString("mode","snapshot");
        PackageInfo installed=target.getPackageManager().getPackageInfo(target.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        JSONObject out=new JSONObject().put("ok",true).put("mode",mode).put("version",installed.versionName).put("build",installed.getLongVersionCode())
            .put("certificateSha256",hex(MessageDigest.getInstance("SHA-256").digest(installed.signingInfo.getApkContentsSigners()[0].toByteArray())));
        out.put("encryptedData",fileDigest(new File(target.getFilesDir(),"zenix.json")));
        out.put("encryptedBackup",fileDigest(new File(target.getFilesDir(),"zenix.json.bak")));
        File root=new File(target.getFilesDir(),"update-acceptance/first-stable-20261008");
        if (!root.isDirectory()&&!root.mkdirs())throw new IOException("Cannot create isolated acceptance directory");
        File marker=new File(root,"retention-marker.txt");
        if (mode.equals("snapshot")&&!marker.exists())try(FileOutputStream stream=new FileOutputStream(marker)){stream.write("zenix-first-stable-retention-20261008".getBytes(StandardCharsets.UTF_8));}
        out.put("retentionMarker",fileDigest(marker));
        Object mainStore=create(target,"PrivateStore",target);
        JSONObject mainData=(JSONObject)call(mainStore,"read",new Class<?>[]{});
        JSONObject mainPersonal=mainData.getJSONObject("personal");
        out.put("personalSnapshot",new JSONObject().put("liked",mainPersonal.getJSONArray("liked").length())
            .put("favorites",mainPersonal.getJSONArray("favorites").length()).put("playlists",mainPersonal.getJSONArray("playlists").length())
            .put("history",mainPersonal.getJSONArray("history").length())
            .put("sha256",hex(MessageDigest.getInstance("SHA-256").digest(canonical(mainPersonal).getBytes(StandardCharsets.UTF_8)))));
        out.put("configurationSha256",hex(MessageDigest.getInstance("SHA-256").digest(canonical(new JSONObject().put("sources",mainData.opt("sources")).put("profile",mainData.opt("profile")).put("appearance",mainData.opt("appearance"))).getBytes(StandardCharsets.UTF_8))));
        if (mode.equals("uiPerformance")) {
            Intent launch=target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);runOnMainSync(()->target.startActivity(launch));
            long started=android.os.SystemClock.elapsedRealtime();while(foregroundActivity==null&&android.os.SystemClock.elapsedRealtime()-started<15000)Thread.sleep(100);
            if(foregroundActivity==null)throw new IOException("Target Activity not resumed");
            android.webkit.WebView view=((com.getcapacitor.BridgeActivity)foregroundActivity).getBridge().getWebView();
            started=android.os.SystemClock.elapsedRealtime();
            while(!evaluate(view,"!!document.querySelector('.mobile-nav')&&!document.querySelector('.mobile-boot')").equals("true")) {
                if(android.os.SystemClock.elapsedRealtime()-started>20000)throw new IOException("Mobile UI did not become ready");Thread.sleep(200);
            }
            String asset=arguments.getString("scenario","").equals("stickerSwitch")?"mobile-sticker-switch.js":"mobile-performance.js";
            String script;try(InputStream stream=getContext().getAssets().open(asset)){script=new String(stream.readAllBytes(),StandardCharsets.UTF_8);}
            boolean trace=arguments.getString("trace","false").equals("true");
            try {
                if(trace){runOnMainSync(()->android.webkit.WebView.setWebContentsDebuggingEnabled(true));Thread.sleep(3000);}
                evaluate(view,script);started=android.os.SystemClock.elapsedRealtime();String report;
                while((report=evaluate(view,"JSON.stringify(window.__zenixMobilePerf?.report||null)")).equals("\"null\"")) {
                    if(asset.equals("mobile-sticker-switch.js")){
                        String request=evaluate(view,"JSON.stringify(window.__zenixMobilePerf?.swipe||null)");
                        if(!request.equals("\"null\"")){
                            JSONObject swipe=new JSONObject(String.valueOf(new org.json.JSONTokener(request).nextValue()));
                            double scale=view.getWidth()/Double.parseDouble(evaluate(view,"innerWidth"));
                            long down=android.os.SystemClock.uptimeMillis();
                            for(int step=0;step<=16;step++){
                                int action=step==0?android.view.MotionEvent.ACTION_DOWN:step==16?android.view.MotionEvent.ACTION_UP:android.view.MotionEvent.ACTION_MOVE;
                                float px=(float)((swipe.getDouble("x")+(swipe.getDouble("toX")-swipe.getDouble("x"))*step/16)*scale),py=(float)((swipe.getDouble("y")+(swipe.getDouble("toY")-swipe.getDouble("y"))*step/16)*scale);
                                android.view.MotionEvent event=android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),action,px,py,0);
                                try{runOnMainSync(()->view.dispatchTouchEvent(event));}finally{event.recycle();}
                                Thread.sleep(12);
                            }
                            evaluate(view,"window.__zenixMobilePerf.swipe=null");
                        }
                    }
                    if(android.os.SystemClock.elapsedRealtime()-started>90000)throw new IOException("Mobile performance probe timed out");Thread.sleep(250);
                }
                Object decoded=new org.json.JSONTokener(report).nextValue();out.put("uiPerformance",new JSONObject(String.valueOf(decoded)));
            } finally { if(trace)runOnMainSync(()->android.webkit.WebView.setWebContentsDebuggingEnabled(false)); }
            out.put("configurationSha256",hex(MessageDigest.getInstance("SHA-256").digest(canonical(new JSONObject().put("sources",mainData.opt("sources")).put("profile",mainData.opt("profile")).put("appearance",mainData.opt("appearance"))).getBytes(StandardCharsets.UTF_8))));
        } else if (mode.equals("playbackCheck")) {
            Intent launch=target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);runOnMainSync(()->target.startActivity(launch));
            Class<?> runtimeClass=target.getClassLoader().loadClass("com.zenix.musicplayer.ZenixRuntime");Method get=runtimeClass.getDeclaredMethod("get",Context.class);get.setAccessible(true);Object runtime=get.invoke(null,target);
            long until=android.os.SystemClock.elapsedRealtime()+15000;Object service;
            while((service=field(runtime,"service"))==null&&android.os.SystemClock.elapsedRealtime()<until)Thread.sleep(100);
            if(service==null)throw new IOException("Playback service not available");Object player=service;
            JSONObject before=playbackSnapshot(player);boolean wasWanted=before.optBoolean("playWhenReady");
            JSONObject selected=before.optJSONObject("track");if(selected!=null)out.put("title",selected.optString("title")).put("artist",selected.optString("artist"));
            try{
                runOnMainSync(()->{try{call(player,"resume",new Class<?>[]{});}catch(Exception failure){throw new RuntimeException(failure);}});
                double first=-1;until=android.os.SystemClock.elapsedRealtime()+120000;
                while(android.os.SystemClock.elapsedRealtime()<until){Thread.sleep(400);JSONObject state=playbackSnapshot(player);
                    if(state.optBoolean("playing")){if(first<0)first=state.optDouble("position");if(state.optDouble("position")>=first+1.2){out.put("playingObserved",true).put("positionBefore",first).put("positionAfter",state.optDouble("position")).put("cacheStatus",state.optString("cacheStatus"));JSONObject resolution=(JSONObject)field(player,"resolution");if(resolution!=null)out.put("provider",resolution.optString("providerName")).put("quality",resolution.optString("quality"));break;}}
                    JSONObject activity=state.optJSONObject("sourceActivity");if(activity!=null&&activity.optString("phase").equals("failed")){out.put("failure",activity);break;}
                    if(state.has("error")&&!state.optBoolean("playWhenReady")){out.put("failure",state.optString("error"));break;}
                }
                if(!out.optBoolean("playingObserved"))out.put("ok",false);
            }finally{if(!wasWanted)runOnMainSync(()->{try{call(player,"pausePlayback",new Class<?>[]{});}catch(Exception failure){throw new RuntimeException(failure);}});}
        } else if (mode.equals("sourceDiagnostic")) {
            Intent launch=target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);runOnMainSync(()->target.startActivity(launch));
            long started=android.os.SystemClock.elapsedRealtime();while(foregroundActivity==null&&android.os.SystemClock.elapsedRealtime()-started<15000)Thread.sleep(100);
            if(foregroundActivity==null)throw new IOException("Target Activity not resumed");
            Class<?> sourcesClass=target.getClassLoader().loadClass("com.zenix.musicplayer.MusicSources");
            Constructor<?> sourcesConstructor=sourcesClass.getDeclaredConstructor(Context.class,mainStore.getClass());sourcesConstructor.setAccessible(true);
            Object sources=sourcesConstructor.newInstance(target,mainStore);
            org.json.JSONArray records=(org.json.JSONArray)call(sources,"list",new Class<?>[]{}),summary=new org.json.JSONArray();
            org.json.JSONArray queue=mainData.optJSONArray("queue");int index=mainData.optInt("queueIndex",-1);
            JSONObject track=queue!=null&&index>=0&&index<queue.length()?queue.optJSONObject(index):null;
            out.put("queueCount",queue==null?0:queue.length()).put("queueIndex",index);
            if(track!=null){JSONObject selected=new JSONObject();for(String key:new String[]{"id","source","providerId","remoteId","title","artist","duration"})if(track.has(key))selected.put(key,track.opt(key));out.put("diagnosedTrack",selected);}
            JSONObject info=null;if(track!=null&&track.optString("source").equals("custom"))try{
                info=new JSONObject(new String(android.util.Base64.decode(track.getString("remoteId"),android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING),StandardCharsets.UTF_8));
                out.put("catalogPlatform",info.optString("source"));
            }catch(Exception ignored){}
            try {for(int i=0;i<records.length();i++){
                JSONObject record=new JSONObject(records.getJSONObject(i).toString()),policy=record.optJSONObject("networkPolicy"),settings=record.optJSONObject("settings");
                String only=arguments.getString("sourceName","");if(!only.isEmpty()&&!record.getJSONObject("manifest").optString("name").equals(only))continue;
                boolean httpProbe=arguments.getString("allowHttpProbe","false").equals("true");
                if(httpProbe){if(policy==null)policy=new JSONObject();policy.put("allowHttp",true);record.put("networkPolicy",policy);}
                JSONObject item=new JSONObject().put("id",record.optString("id")).put("name",record.getJSONObject("manifest").optString("name")).put("sha256",record.optString("sha256"))
                    .put("temporaryHttpProbe",httpProbe)
                    .put("enabled",record.optBoolean("enabled")).put("kind",record.optString("kind"))
                    .put("allowHttp",policy!=null&&policy.optBoolean("allowHttp"))
                    .put("restrictedHostCount",policy==null||policy.optJSONArray("hosts")==null?0:policy.getJSONArray("hosts").length())
                    .put("settingsKeys",settings==null?new org.json.JSONArray():settings.names());
                summary.put(item);if(!record.optBoolean("enabled")||info==null||!record.optString("kind").equals("lx"))continue;
                JSONObject platform=record.getJSONObject("manifest").getJSONObject("lxPlatforms").optJSONObject(info.optString("source"));
                if(platform==null){item.put("result","platformUnsupported");continue;}
                long begin=android.os.SystemClock.elapsedRealtime();Object engine=null;
                try{
                    engine=call(sources,"engine",new Class<?>[]{JSONObject.class},record);
                    call(engine,"ready",new Class<?>[]{});
                    Object activeEngine=engine;
                    String shim=arguments.getString("bufferProbe","false").equals("true")?"Buffer.isBuffer=value=>value instanceof Buffer;":"";
                    runOnMainSync(()->{try{call(activeEngine,"evaluate",new Class<?>[]{String.class},shim+"globalThis.__sourceEvents=[];const originalNetworkResult=globalThis.__networkResult;globalThis.__networkResult=(id,data,error)=>{__sourceEvents.push({status:data?.status,type:data?.headers?.['content-type'],encoding:data?.headers?.['content-encoding'],bytes:data?.data?.length,error:error?String(error).replace(/https?:\\/\\/\\S+/g,'[URL]'):null});return originalNetworkResult(id,data,error);};");}catch(Exception failure){throw new RuntimeException(failure);}});
                    String quality=platform.getJSONArray("qualitys").toString().contains("320k")?"320k":platform.getJSONArray("qualitys").getString(0);
                    JSONObject request=new JSONObject().put("source",info.getString("source")).put("action","musicUrl")
                        .put("info",new JSONObject().put("type",quality).put("musicInfo",info));
                    Object resolved=call(engine,"call",new Class<?>[]{String.class,Object.class,JSONObject.class,long.class},"lx",request,settings,45000L);
                    String url=resolved instanceof JSONObject?((JSONObject)resolved).optString("url"):String.valueOf(resolved);
                    java.net.URL parsed=new java.net.URL(url);item.put("resolvedScheme",parsed.getProtocol()).put("resolvedHost",parsed.getHost());
                    org.json.JSONArray dns=new org.json.JSONArray();for(java.net.InetAddress address:java.net.InetAddress.getAllByName(parsed.getHost()))dns.put(address.getHostAddress());item.put("resolvedAddresses",dns);
                    if(arguments.getString("networkDns","false").equals("true")){getUiAutomation().adoptShellPermissionIdentity("android.permission.ACCESS_NETWORK_STATE");try{android.net.ConnectivityManager cm=(android.net.ConnectivityManager)target.getSystemService(Context.CONNECTIVITY_SERVICE);org.json.JSONArray networks=new org.json.JSONArray();for(android.net.Network network:cm.getAllNetworks()){android.net.NetworkCapabilities caps=cm.getNetworkCapabilities(network);if(caps==null||!caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET))continue;JSONObject result=new JSONObject().put("vpn",caps.hasTransport(android.net.NetworkCapabilities.TRANSPORT_VPN));try{org.json.JSONArray answers=new org.json.JSONArray();for(java.net.InetAddress address:network.getAllByName(parsed.getHost()))answers.put(address.getHostAddress());result.put("addresses",answers);}catch(Exception failure){result.put("error",failure.getClass().getSimpleName());}networks.put(result);}item.put("networkDns",networks);}finally{getUiAutomation().dropShellPermissionIdentity();}}
                    Class<?> policyClass=target.getClassLoader().loadClass("com.zenix.musicplayer.SourcePolicy");
                    Method hosts=policyClass.getDeclaredMethod("hosts",JSONObject.class,String.class);hosts.setAccessible(true);
                    org.json.JSONArray allowed=(org.json.JSONArray)hosts.invoke(null,record,"mediaHosts");
                    Class<?> httpClass=target.getClassLoader().loadClass("com.zenix.musicplayer.SourceHttp");
                    Method check=httpClass.getDeclaredMethod("check",String.class,org.json.JSONArray.class,boolean.class);check.setAccessible(true);check.invoke(null,url,allowed,item.optBoolean("allowHttp"));
                    item.put("result","resolvedAndNetworkPolicyPassed");
                    Method client=httpClass.getDeclaredMethod("client",org.json.JSONArray.class,int.class,boolean.class);client.setAccessible(true);
                    okhttp3.OkHttpClient media=(okhttp3.OkHttpClient)client.invoke(null,allowed,8000,item.optBoolean("allowHttp"));
                    okhttp3.Request.Builder mediaRequest=new okhttp3.Request.Builder().url(url).header("User-Agent","Zenix Android").header("Range","bytes=0-1023");
                    JSONObject mediaHeaders=resolved instanceof JSONObject?((JSONObject)resolved).optJSONObject("headers"):null;
                    if(mediaHeaders!=null)for(java.util.Iterator<String> keys=mediaHeaders.keys();keys.hasNext();){String key=keys.next();if(!key.equalsIgnoreCase("Host")&&!key.equalsIgnoreCase("Content-Length"))mediaRequest.header(key,mediaHeaders.optString(key));}
                    okhttp3.Call mediaCall=media.newCall(mediaRequest.build());mediaCall.timeout().timeout(12000,java.util.concurrent.TimeUnit.MILLISECONDS);
                    try(okhttp3.Response response=mediaCall.execute()){
                        item.put("mediaStatus",response.code()).put("mediaType",response.header("Content-Type",""));
                        java.io.InputStream stream=response.body()==null?null:response.body().byteStream();byte[] prefix=new byte[16];int received=stream==null?-1:stream.read(prefix);
                        item.put("mediaPrefixBytes",Math.max(0,received));item.put("result",response.isSuccessful()&&received>0?"audioBytesReceived":"mediaRejected");
                    }
                }catch(Throwable failure){Throwable cause=failure;while(cause instanceof InvocationTargetException||cause instanceof java.util.concurrent.ExecutionException){Throwable next=cause.getCause();if(next==null)break;cause=next;}
                    String message=String.valueOf(cause.getMessage()).replaceAll("https?://\\S+","[URL]").replaceAll("(?i)(token|password|authorization|api[-_]?key)[=: ]+\\S+","[REDACTED]");
                    item.put("result","failed").put("errorType",cause.getClass().getSimpleName()).put("message",message);
                }finally{item.put("elapsedMs",android.os.SystemClock.elapsedRealtime()-begin);if(engine!=null){try{Object events=new org.json.JSONTokener(evaluate((android.webkit.WebView)field(engine,"view"),"JSON.stringify(globalThis.__sourceEvents||[])")).nextValue();if(events instanceof String)item.put("httpEvents",new org.json.JSONArray((String)events));}catch(Exception ignored){}call(engine,"close",new Class<?>[]{});}}
            }}finally{call(sources,"close",new Class<?>[]{});}
            out.put("sourceDiagnostics",summary);
        } else if(mode.equals("artworkInfo")) {
            File[] covers=new File(target.getCacheDir(),"source-artwork").listFiles();int count=0,large=0,maxWidth=0,maxHeight=0;long bytes=0;
            if(covers!=null)for(File cover:covers)if(cover.isFile()){
                android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeFile(cover.getAbsolutePath(),options);
                if(options.outWidth>0){count++;bytes+=cover.length();maxWidth=Math.max(maxWidth,options.outWidth);maxHeight=Math.max(maxHeight,options.outHeight);if(Math.max(options.outWidth,options.outHeight)>1024)large++;}
            }
            out.put("artworkInfo",new JSONObject().put("count",count).put("over1024",large).put("maxWidth",maxWidth).put("maxHeight",maxHeight).put("bytes",bytes));
            JSONObject appearance=mainData.optJSONObject("appearance"),background=appearance==null?null:appearance.optJSONObject("background");
            if(background!=null&&background.optString("kind").equals("image")){
                android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeFile(background.optString("url"),options);
                out.put("backgroundDimensions",new JSONObject().put("width",options.outWidth).put("height",options.outHeight));
            }
        } else if (mode.equals("cache")) {
            org.json.JSONArray packages=new org.json.JSONArray();
            File[] files=new File(target.getFilesDir(),"updates").listFiles((dir,name)->name.endsWith(".apk"));
            if(files!=null)for(File file:files)packages.put(archiveDigest(target,file));
            out.put("cachedUpdates",packages);
        } else if (mode.equals("seed")||mode.equals("verify")) {
            Context isolated=new ContextWrapper(target) {
                @Override public Context getApplicationContext(){return this;}
                @Override public File getFilesDir(){File path=new File(root,"synthetic-profile");path.mkdirs();return path;}
                @Override public File getCacheDir(){File path=new File(root,"synthetic-cache");path.mkdirs();return path;}
            };
            Object store=create(target,"PrivateStore",isolated);
            if(mode.equals("seed")) {
                if(new File(root,"synthetic-profile/zenix.json").exists())throw new IOException("Synthetic profile already exists; will not reset it");
                JSONObject track=new JSONObject().put("id","acceptance-song").put("title","Synthetic acceptance song").put("artist","Synthetic artist").put("source","acceptance-source");
                call(store,"personal",new Class<?>[]{String.class,JSONObject.class},"toggle",new JSONObject().put("kind","liked").put("track",track));
                call(store,"personal",new Class<?>[]{String.class,JSONObject.class},"toggle",new JSONObject().put("kind","favorites").put("track",track));
                call(store,"personal",new Class<?>[]{String.class,JSONObject.class},"createPlaylist",new JSONObject().put("name","Synthetic acceptance playlist").put("track",track));
                call(store,"set",new Class<?>[]{String.class,Object.class},"profile",new JSONObject().put("name","Synthetic acceptance profile"));
                call(store,"set",new Class<?>[]{String.class,Object.class},"cacheLimitMiB",128);
            }
            JSONObject data=(JSONObject)call(store,"read",new Class<?>[]{});JSONObject personal=data.getJSONObject("personal");
            boolean retained=personal.getJSONArray("liked").length()==1&&personal.getJSONArray("favorites").length()==1
                &&personal.getJSONArray("playlists").length()==1&&personal.getJSONArray("playlists").getJSONObject(0).getJSONArray("tracks").length()==1
                &&data.getJSONObject("profile").optString("name").equals("Synthetic acceptance profile")&&data.optInt("cacheLimitMiB")==128;
            if(!retained)throw new IOException("Synthetic personal data was not retained");
            out.put("syntheticCollectionsRetained",true).put("syntheticEncryptedData",fileDigest(new File(root,"synthetic-profile/zenix.json")));
        } else if(mode.equals("check")||mode.equals("download")||mode.equals("install")) {
            // Keep the real app foreground during lengthy network acceptance. Some
            // OEMs kill headless instrumentation as a cached background process.
            Intent launch=target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);runOnMainSync(()->target.startActivity(launch));
            long foregroundDeadline=android.os.SystemClock.elapsedRealtime()+15000;
            while(foregroundActivity==null&&android.os.SystemClock.elapsedRealtime()<foregroundDeadline)Thread.sleep(100);
            Activity activity=foregroundActivity;
            if(activity==null)throw new IOException("Target Activity did not resume within 15 seconds");
            Object updates=create(target,"AppUpdates",target);
            JSONObject state=(JSONObject)call(updates,"check",new Class<?>[]{String.class},arguments.getString("channel","preview"));
            if(!mode.equals("check")&&state.optString("status").equals("available"))state=(JSONObject)call(updates,"download",new Class<?>[]{});
            if(mode.equals("install")&&state.optString("status").equals("ready")) {
                JSONObject incoming=archiveDigest(target,(File)field(updates,"ready"));
                JSONObject artifact=(JSONObject)field(updates,"artifact");
                incoming.put("expectedBuild",artifact.getLong("build")).put("expectedSha256",artifact.getString("sha256"));
                Bundle packageProgress=new Bundle();packageProgress.putString("zenixIncomingPackage",incoming.toString());sendStatus(3,packageProgress);
                state=(JSONObject)call(updates,"install",new Class<?>[]{Activity.class},activity);
                // The production installer posts to the main thread. Drain that
                // runnable before instrumentation finishes and terminates the app.
                runOnMainSync(()->{});Thread.sleep(1000);
                if(!target.getPackageManager().canRequestPackageInstalls()) {
                    Bundle progress=new Bundle();progress.putString("zenixAcceptanceProgress","awaiting Zenix system installation permission");sendStatus(1,progress);
                    long permissionDeadline=android.os.SystemClock.elapsedRealtime()+180000;
                    while(!target.getPackageManager().canRequestPackageInstalls()&&android.os.SystemClock.elapsedRealtime()<permissionDeadline)Thread.sleep(500);
                    if(target.getPackageManager().canRequestPackageInstalls()) {
                        state=(JSONObject)call(updates,"install",new Class<?>[]{Activity.class},activity);runOnMainSync(()->{});
                    }
                }
                if(target.getPackageManager().canRequestPackageInstalls()) {
                    Bundle progress=new Bundle();progress.putString("zenixAcceptanceProgress","awaiting Android system installer confirmation");sendStatus(2,progress);
                    Thread.sleep(180000);
                }
            }
            out.put("updateState",state);
            Object worker=field(updates,"worker");((java.util.concurrent.ExecutorService)worker).shutdownNow();
        } else if(!mode.equals("snapshot"))throw new IOException("Unsupported acceptance mode");
        return out;
    }
    private static Object create(Context target,String name,Context context)throws Exception {
        Class<?> type=target.getClassLoader().loadClass("com.zenix.musicplayer."+name);Constructor<?> constructor=type.getDeclaredConstructor(Context.class);constructor.setAccessible(true);return constructor.newInstance(context);
    }
    private JSONObject playbackSnapshot(Object player)throws Exception {
        java.util.concurrent.atomic.AtomicReference<JSONObject> snapshot=new java.util.concurrent.atomic.AtomicReference<>();java.util.concurrent.atomic.AtomicReference<Exception> failure=new java.util.concurrent.atomic.AtomicReference<>();
        runOnMainSync(()->{try{snapshot.set((JSONObject)call(player,"state",new Class<?>[]{}));}catch(Exception error){failure.set(error);}});
        if(failure.get()!=null)throw failure.get();return snapshot.get();
    }
    private static Object call(Object receiver,String name,Class<?>[] types,Object... args)throws Exception {Method method=receiver.getClass().getDeclaredMethod(name,types);method.setAccessible(true);return method.invoke(receiver,args);}
    private static Object field(Object receiver,String name)throws Exception {Field field=receiver.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(receiver);}
    private static JSONObject fileDigest(File file)throws Exception {
        JSONObject info=new JSONObject().put("exists",file.isFile());if(!file.isFile())return info;
        MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] bytes=new byte[65536];int n;while((n=input.read(bytes))!=-1)digest.update(bytes,0,n);}
        return info.put("size",file.length()).put("sha256",hex(digest.digest()));
    }
    private static JSONObject archiveDigest(Context target,File file)throws Exception {
        JSONObject result=fileDigest(file).put("filename",file.getName());if(!file.isFile())return result;
        android.net.Uri providerUri=androidx.core.content.FileProvider.getUriForFile(target,target.getPackageName()+".fileprovider",file);
        MessageDigest providerHash=MessageDigest.getInstance("SHA-256");long providerSize=0;
        try(InputStream stream=target.getContentResolver().openInputStream(providerUri)){byte[] chunk=new byte[65536];int n;while((n=stream.read(chunk))!=-1){providerHash.update(chunk,0,n);providerSize+=n;}}
        result.put("providerSha256",hex(providerHash.digest())).put("providerSize",providerSize);
        PackageInfo archive=target.getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(),0);
        if(archive!=null)result.put("build",archive.getLongVersionCode()).put("packageName",archive.packageName).put("version",archive.versionName);
        return result;
    }
    private String evaluate(android.webkit.WebView view,String script)throws Exception {
        java.util.concurrent.CountDownLatch latch=new java.util.concurrent.CountDownLatch(1);java.util.concurrent.atomic.AtomicReference<String> value=new java.util.concurrent.atomic.AtomicReference<>();
        runOnMainSync(()->view.evaluateJavascript(script,result->{value.set(result);latch.countDown();}));
        if(!latch.await(8,java.util.concurrent.TimeUnit.SECONDS))throw new IOException("UI evaluation timeout");return value.get();
    }
    private static String hex(byte[] bytes){StringBuilder text=new StringBuilder();for(byte value:bytes)text.append(String.format(Locale.ROOT,"%02x",value&255));return text.toString();}
    private static String canonical(Object value)throws Exception {
        if(value instanceof JSONObject){JSONObject object=(JSONObject)value;java.util.TreeSet<String> keys=new java.util.TreeSet<>();object.keys().forEachRemaining(keys::add);StringBuilder result=new StringBuilder("{");for(String key:keys){if(result.length()>1)result.append(',');result.append(JSONObject.quote(key)).append(':').append(canonical(object.get(key)));}return result.append('}').toString();}
        if(value instanceof org.json.JSONArray){org.json.JSONArray array=(org.json.JSONArray)value;StringBuilder result=new StringBuilder("[");for(int i=0;i<array.length();i++){if(i>0)result.append(',');result.append(canonical(array.get(i)));}return result.append(']').toString();}
        String scalar=new org.json.JSONArray().put(value).toString();return scalar.substring(1,scalar.length()-1);
    }
}
