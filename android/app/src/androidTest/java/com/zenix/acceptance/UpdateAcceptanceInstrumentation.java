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
        out.put("playbackPolicy",new JSONObject().put("smoothPlayback",mainData.optBoolean("smoothPlayback")).put("quality",mainData.optString("quality","high")).put("cacheEnabled",mainData.optBoolean("cacheEnabled",true)));
        JSONObject mainPersonal=mainData.getJSONObject("personal");
        out.put("personalSnapshot",new JSONObject().put("liked",mainPersonal.getJSONArray("liked").length())
            .put("favorites",mainPersonal.getJSONArray("favorites").length()).put("playlists",mainPersonal.getJSONArray("playlists").length())
            .put("history",mainPersonal.getJSONArray("history").length())
            .put("sha256",hex(MessageDigest.getInstance("SHA-256").digest(canonical(mainPersonal).getBytes(StandardCharsets.UTF_8)))));
        out.put("configurationSha256",hex(MessageDigest.getInstance("SHA-256").digest(canonical(new JSONObject().put("sources",mainData.opt("sources")).put("profile",mainData.opt("profile")).put("appearance",mainData.opt("appearance"))).getBytes(StandardCharsets.UTF_8))));
        if (mode.equals("alignSources")) {
            File input=new File(target.getExternalFilesDir(null),"pc-source-alignment.json");
            JSONObject requested;try(InputStream stream=new FileInputStream(input)){byte[] bytes=stream.readAllBytes();if(bytes.length>65536)throw new IOException("Source alignment input too large");requested=new JSONObject(new String(bytes,StandardCharsets.UTF_8));}
            org.json.JSONArray desired=requested.getJSONArray("sources"),existing=mainData.getJSONArray("sources"),aligned=new org.json.JSONArray();java.util.Set<String> used=new java.util.HashSet<>();
            if(requested.optInt("schemaVersion")!=1||desired.length()!=existing.length())throw new IOException("Source sets differ; refusing replacement");
            Class<?> policyType=target.getClassLoader().loadClass("com.zenix.musicplayer.SourcePolicy");Method validate=policyType.getDeclaredMethod("validate",JSONObject.class);validate.setAccessible(true);
            for(int i=0;i<desired.length();i++){JSONObject want=desired.getJSONObject(i),source=null;String hash=want.getString("sha256");
                for(int j=0;j<existing.length();j++){JSONObject row=existing.getJSONObject(j);if(row.optString("sha256").equals(hash)){source=new JSONObject(row.toString());break;}}
                if(source==null||!used.add(hash))throw new IOException("Source content mismatch or duplicate");
                JSONObject pack;try(InputStream stream=new FileInputStream(new File(target.getFilesDir(),"sources/"+source.getString("id")+".json"))){pack=new JSONObject(new String(stream.readAllBytes(),StandardCharsets.UTF_8));}
                if(!hex(MessageDigest.getInstance("SHA-256").digest(pack.getString("script").getBytes(StandardCharsets.UTF_8))).equals(hash))throw new IOException("Actual source file changed");
                String catalog=want.getString("catalog");if(!source.getJSONObject("manifest").getJSONObject("lxPlatforms").has(catalog))throw new IOException("Unsupported desktop catalogue");
                JSONObject settings=source.optJSONObject("settings");if(settings==null)settings=new JSONObject();settings.put("lxCatalog",catalog);source.put("settings",settings).put("enabled",want.getBoolean("enabled")).put("networkPolicy",validate.invoke(null,want.getJSONObject("networkPolicy")));aligned.put(source);
            }
            File backups=new File(target.getFilesDir(),"source-alignment-backups");if(!backups.isDirectory()&&!backups.mkdirs())throw new IOException("Cannot create private source backup");File backup=File.createTempFile("before-pc-alignment-",".encrypted",backups);
            try(InputStream in=new FileInputStream(new File(target.getFilesDir(),"zenix.json"));OutputStream dest=new FileOutputStream(backup)){in.transferTo(dest);}
            call(mainStore,"apply",new Class<?>[]{JSONObject.class},new JSONObject().put("sources",aligned));call(mainStore,"flush",new Class<?>[]{});
            Object reloaded=create(target,"PrivateStore",target);JSONObject after=(JSONObject)call(reloaded,"read",new Class<?>[]{});
            if(!canonical(mainPersonal).equals(canonical(after.getJSONObject("personal"))))throw new IOException("Personal data changed during source alignment");
            if(!canonical(new JSONObject().put("sources",aligned)).equals(canonical(new JSONObject().put("sources",after.getJSONArray("sources")))))throw new IOException("Source alignment persistence mismatch");
            out.put("alignedCount",aligned.length()).put("personalUnchanged",true).put("backup",backup.getName());org.json.JSONArray report=new org.json.JSONArray();for(int i=0;i<aligned.length();i++){JSONObject source=aligned.getJSONObject(i);report.put(new JSONObject().put("order",i).put("name",source.getJSONObject("manifest").optString("name")).put("id",source.getString("id")).put("sha256",source.getString("sha256")).put("catalog",source.getJSONObject("settings").getString("lxCatalog")).put("networkPolicy",source.getJSONObject("networkPolicy")));}out.put("sources",report);
        } else if (mode.equals("replacementCompare")) {
            org.json.JSONArray records=mainData.optJSONArray("sources"),summary=new org.json.JSONArray();
            for(int i=0;records!=null&&i<records.length();i++){
                JSONObject source=records.getJSONObject(i),manifest=source.getJSONObject("manifest"),settings=source.optJSONObject("settings"),policy=source.optJSONObject("networkPolicy");
                JSONObject row=new JSONObject().put("order",i).put("id",source.optString("id")).put("name",manifest.optString("name")).put("enabled",source.optBoolean("enabled")).put("kind",source.optString("kind")).put("sha256",source.optString("sha256"));
                row.put("catalog",settings==null?"":settings.optString("lxCatalog")).put("capabilities",manifest.opt("capabilities")).put("platforms",manifest.opt("lxPlatforms")).put("allowHttp",policy!=null&&policy.optBoolean("allowHttp")).put("restrictedHostCount",policy==null||policy.optJSONArray("hosts")==null?0:policy.getJSONArray("hosts").length());summary.put(row);
            }
            out.put("sources",summary);
            org.json.JSONArray lists=mainPersonal.getJSONArray("playlists");JSONObject original=null;
            for(int i=0;i<lists.length();i++){JSONObject list=lists.getJSONObject(i);org.json.JSONArray tracks=list.getJSONArray("tracks");if(tracks.length()==296){out.put("playlist",new JSONObject().put("id",list.optString("id")).put("name",list.optString("name")).put("count",tracks.length()).put("autoReplacement",list.optBoolean("autoReplacement")));if(tracks.length()>0)original=new JSONObject(tracks.getJSONObject(0).toString());break;}}
            if(original!=null){out.put("original",original);String phase=arguments.getString("phase","summary");if(!phase.equals("summary")){
                Class<?> sourceType=target.getClassLoader().loadClass("com.zenix.musicplayer.MusicSources");Constructor<?> sourceConstructor=sourceType.getDeclaredConstructor(Context.class,mainStore.getClass());sourceConstructor.setAccessible(true);Object sources=sourceConstructor.newInstance(target,mainStore);java.util.function.BooleanSupplier cancel=()->false;
                try{
                    org.json.JSONArray rows=(org.json.JSONArray)call(sources,"replacementSearch",new Class<?>[]{String.class,java.util.function.BooleanSupplier.class,int.class},original.optString("title"),cancel,3);out.put("searchResults",rows);
                    if(phase.equals("normal")&&rows.length()>0){
                        Class<?> progressType=target.getClassLoader().loadClass("com.zenix.musicplayer.MusicSources$Progress");org.json.JSONArray steps=new org.json.JSONArray();
                        Object progress=java.lang.reflect.Proxy.newProxyInstance(target.getClassLoader(),new Class<?>[]{progressType},(proxy,method,values)->{if(method.getName().equals("update")){steps.put(new JSONObject().put("phase",values[0]).put("message",values[1]));Bundle status=new Bundle();status.putString("zenixAcceptanceProgress",String.valueOf(values[1]));sendStatus(1,status);}return null;});
                        try{JSONObject result=(JSONObject)call(sources,"resolve",new Class<?>[]{JSONObject.class,java.util.Set.class,String.class,progressType,java.util.function.BooleanSupplier.class},rows.getJSONObject(0),new java.util.HashSet<String>(),"high",progress,cancel);out.put("normalResolved",new JSONObject().put("providerId",result.optString("providerId")).put("providerName",result.optString("providerName")).put("quality",result.optString("quality")).put("host",new java.net.URI(result.getString("url")).getHost()));call(sources,"replacementProbe",new Class<?>[]{JSONObject.class},result);out.put("normalProbe","passed");}
                        catch(Exception failure){Throwable cause=failure;while(cause.getCause()!=null)cause=cause.getCause();out.put("normalError",String.valueOf(cause.getMessage()).replaceAll("https?://\\S+","[URL]"));}out.put("normalSteps",steps);
                    }
                    if(phase.equals("resolve"))for(int i=0;i<rows.length();i++){JSONObject candidate=rows.getJSONObject(i),attempt=new JSONObject().put("title",candidate.optString("title")).put("artist",candidate.optString("artist")).put("providerId",candidate.optString("providerId"));long start=android.os.SystemClock.elapsedRealtime();
                        try{JSONObject resolved=(JSONObject)call(sources,"replacementExact",new Class<?>[]{JSONObject.class,String.class},candidate,original.optString("id"));attempt.put("resolvedHost",new java.net.URI(resolved.getString("url")).getHost()).put("scheme",new java.net.URI(resolved.getString("url")).getScheme());call(sources,"replacementProbe",new Class<?>[]{JSONObject.class},resolved);attempt.put("result","probePassed");}
                        catch(Exception failure){Throwable cause=failure instanceof InvocationTargetException?((InvocationTargetException)failure).getTargetException():failure;attempt.put("error",String.valueOf(cause.getMessage()).replaceAll("https?://\\S+","[URL]")).put("errorType",cause.getClass().getSimpleName());}
                        attempt.put("elapsedMs",android.os.SystemClock.elapsedRealtime()-start);if(!out.has("attempts"))out.put("attempts",new org.json.JSONArray());out.getJSONArray("attempts").put(attempt);
                    }
                }finally{call(sources,"close",new Class<?>[]{});}
            }}
            JSONObject after=(JSONObject)call(mainStore,"read",new Class<?>[]{});out.put("personalUnchanged",canonical(mainPersonal).equals(canonical(after.getJSONObject("personal"))));
        } else if (mode.equals("uiPerformance")) {
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
        } else if (mode.equals("playbackStateCheck")) {
            Intent launch=target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);runOnMainSync(()->target.startActivity(launch));
            Class<?> runtimeClass=target.getClassLoader().loadClass("com.zenix.musicplayer.ZenixRuntime");Method get=runtimeClass.getDeclaredMethod("get",Context.class);get.setAccessible(true);Object runtime=get.invoke(null,target);
            long until=android.os.SystemClock.elapsedRealtime()+15000;Object active;
            while((active=field(runtime,"service"))==null&&android.os.SystemClock.elapsedRealtime()<until)Thread.sleep(100);
            if(active==null)throw new IOException("Playback service missing");Object service=active;
            JSONObject original=playbackSnapshot(service);if(original.optJSONObject("track")==null)throw new IOException("Select a song before targeted state check");
            Class<?> http=target.getClassLoader().loadClass("com.zenix.musicplayer.SourceHttp");Method playbackClient=http.getDeclaredMethod("playbackClient",org.json.JSONArray.class,boolean.class);playbackClient.setAccessible(true);
            okhttp3.OkHttpClient client=(okhttp3.OkHttpClient)playbackClient.invoke(null,null,false);
            if(client.callTimeoutMillis()!=0||client.readTimeoutMillis()!=0)throw new IOException("Playback still has an elapsed call/read expiry");out.put("playbackCallAndReadTimersDisabled",true);
            Class<?> engineClass=target.getClassLoader().loadClass("com.zenix.musicplayer.ScriptEngine");Constructor<?> ctor=engineClass.getDeclaredConstructor(Context.class,String.class,JSONObject.class,org.json.JSONArray.class,boolean.class,boolean.class,boolean.class);ctor.setAccessible(true);
            Object engine=ctor.newInstance(target,"zenix.register({resolvePlayback:()=>new Promise(resolve=>globalThis.releaseSong=resolve)});",new JSONObject(),null,false,false,true);
            java.util.concurrent.ExecutorService work=java.util.concurrent.Executors.newSingleThreadExecutor();
            try {
                call(engine,"ready",new Class<?>[]{long.class},0L);
                java.util.concurrent.Future<Object> pending=work.submit(()->call(engine,"call",new Class<?>[]{String.class,Object.class,JSONObject.class,long.class},"resolvePlayback",new JSONObject(),new JSONObject(),0L));
                android.webkit.WebView scriptView=(android.webkit.WebView)field(engine,"view");until=android.os.SystemClock.elapsedRealtime()+5000;
                while(!evaluate(scriptView,"typeof releaseSong==='function'").equals("true")){if(android.os.SystemClock.elapsedRealtime()>until)throw new IOException("Script request not started");Thread.sleep(50);}
                Thread.sleep(400);if(pending.isDone())throw new IOException("Pending script was prematurely ended");evaluate(scriptView,"releaseSong({url:'https://fixture.zenix.invalid/audio.mp3'});true");
                JSONObject resolved=(JSONObject)pending.get(5,java.util.concurrent.TimeUnit.SECONDS);if(!resolved.optString("url").endsWith("audio.mp3"))throw new IOException("Script completion result missing");out.put("explicitScriptCompletionObserved",true);
                evaluate(scriptView,"globalThis.releaseSong=null;true");java.util.concurrent.Future<Object> cancelled=work.submit(()->call(engine,"call",new Class<?>[]{String.class,Object.class,JSONObject.class,long.class},"resolvePlayback",new JSONObject(),new JSONObject(),0L));
                until=android.os.SystemClock.elapsedRealtime()+5000;while(!evaluate(scriptView,"typeof releaseSong==='function'").equals("true")){if(android.os.SystemClock.elapsedRealtime()>until)throw new IOException("Cancel request not started");Thread.sleep(50);}
                call(engine,"close",new Class<?>[]{});try{cancelled.get(5,java.util.concurrent.TimeUnit.SECONDS);throw new IOException("Cancelled script returned a successful result");}catch(java.util.concurrent.ExecutionException expected){out.put("pendingScriptCancellationObserved",true);}
            }finally{call(engine,"close",new Class<?>[]{});work.shutdownNow();}
            try {
                runOnMainSync(()->{try{
                    setField(service,"wanted",false);call(service,"cancelResolution",new Class<?>[]{});
                    androidx.media3.exoplayer.ExoPlayer decoder=(androidx.media3.exoplayer.ExoPlayer)field(service,"player");decoder.stop();
                    setField(service,"generation",((Long)field(service,"generation"))+1);setField(service,"wanted",true);
                    androidx.media3.datasource.DataSource.Factory waiting=()->new androidx.media3.datasource.BaseDataSource(false){
                        private volatile boolean closed;private android.net.Uri uri;
                        @Override public long open(androidx.media3.datasource.DataSpec spec){uri=spec.uri;return androidx.media3.common.C.LENGTH_UNSET;}
                        @Override public int read(byte[] buffer,int offset,int length)throws IOException{while(!closed){try{Thread.sleep(50);}catch(InterruptedException cancelled){Thread.currentThread().interrupt();throw new java.io.InterruptedIOException("test loader cancelled");}}return androidx.media3.common.C.RESULT_END_OF_INPUT;}
                        @Override public android.net.Uri getUri(){return uri;}
                        @Override public void close(){closed=true;}
                    };
                    decoder.setMediaSource(new androidx.media3.exoplayer.source.ProgressiveMediaSource.Factory(waiting).createMediaSource(androidx.media3.common.MediaItem.fromUri("https://fixture.zenix.invalid/waiting.mp3")));decoder.prepare();decoder.play();
                }catch(Exception failure){throw new RuntimeException(failure);}});
                Thread.sleep(3000);JSONObject waiting=playbackSnapshot(service);if(!waiting.optBoolean("playWhenReady")||waiting.has("error"))throw new IOException("Pending decoder was cancelled without a failure");out.put("pendingDecoderPreserved",true);
                runOnMainSync(()->{try{call(service,"pausePlayback",new Class<?>[]{});}catch(Exception failure){throw new RuntimeException(failure);}});
                if(playbackSnapshot(service).optBoolean("playWhenReady"))throw new IOException("Explicit stop was not honored");out.put("manualStopObserved",true);
                runOnMainSync(()->{try{call(service,"resume",new Class<?>[]{});}catch(Exception failure){throw new RuntimeException(failure);}});
                until=android.os.SystemClock.elapsedRealtime()+90000;double first=-1;
                while(android.os.SystemClock.elapsedRealtime()<until){Thread.sleep(400);JSONObject state=playbackSnapshot(service);if(state.optBoolean("playing")){if(first<0)first=state.optDouble("position");if(state.optDouble("position")>=first+5){out.put("manualRetryRecovered",true).put("positionBefore",first).put("positionAfter",state.optDouble("position"));break;}}if(state.optJSONObject("sourceActivity")!=null&&state.getJSONObject("sourceActivity").optString("phase").equals("failed"))break;}
                if(!out.optBoolean("manualRetryRecovered"))out.put("ok",false);
            }finally{runOnMainSync(()->{try{call(service,"setQueue",new Class<?>[]{org.json.JSONArray.class,int.class},original.getJSONArray("queue"),original.optInt("queueIndex",-1));call(service,"pausePlayback",new Class<?>[]{});}catch(Exception failure){throw new RuntimeException(failure);}});}

        } else if (mode.equals("playbackUiSurvey")) {
            Intent launch=target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);runOnMainSync(()->target.startActivity(launch));
            long until=android.os.SystemClock.elapsedRealtime()+20000;
            while(foregroundActivity==null&&android.os.SystemClock.elapsedRealtime()<until)Thread.sleep(100);
            if(foregroundActivity==null)throw new IOException("Target Activity not resumed");
            android.webkit.WebView view=((com.getcapacitor.BridgeActivity)foregroundActivity).getBridge().getWebView();
            while(!evaluate(view,"!!document.querySelector('.mobile-nav')&&!document.querySelector('.mobile-boot')&&!document.querySelector('.zenix-intro')").equals("true")){if(android.os.SystemClock.elapsedRealtime()>until)throw new IOException("UI not ready");Thread.sleep(150);}
            Class<?> runtimeClass=target.getClassLoader().loadClass("com.zenix.musicplayer.ZenixRuntime");Method get=runtimeClass.getDeclaredMethod("get",Context.class);get.setAccessible(true);Object runtime=get.invoke(null,target),service=field(runtime,"service");
            if(service==null)throw new IOException("Playback service missing");
            JSONObject before=playbackSnapshot(service);org.json.JSONArray originalQueue=new org.json.JSONArray(before.getJSONArray("queue").toString());int originalIndex=before.optInt("queueIndex",-1);boolean originalWanted=before.optBoolean("playWhenReady");double originalPosition=before.optDouble("position");
            evaluate(view,"window.__zenixPlaybackErrors=[];window.__zenixTouches=[];['pointerdown','pointerup','touchstart','touchend','click'].forEach(type=>document.addEventListener(type,e=>{window.__zenixTouches.push({type,target:e.target?.tagName,classes:String(e.target?.className||'').slice(0,80),x:e.clientX,y:e.clientY});if(window.__zenixTouches.length>50)window.__zenixTouches.shift();},true));window.addEventListener('unhandledrejection',e=>window.__zenixPlaybackErrors.push(String(e.reason).replace(/https?:\\/\\/\\S+/g,'[URL]')));[...document.querySelectorAll('.mobile-nav button')].find(b=>b.textContent.includes('个人')).click();true");
            until=android.os.SystemClock.elapsedRealtime()+10000;while(!evaluate(view,"!!document.querySelector('.recent-strip button')").equals("true")){if(android.os.SystemClock.elapsedRealtime()>until)throw new IOException("Recent songs unavailable");Thread.sleep(150);}
            String candidates=evaluate(view,"JSON.stringify([...document.querySelectorAll('.recent-strip button')].map(b=>({title:b.querySelector('strong')?.textContent,artist:b.querySelector('small')?.textContent})).filter((v,i,a)=>a.findIndex(w=>w.title===v.title)===i).slice(0,3))");
            org.json.JSONArray chosen=new org.json.JSONArray(String.valueOf(new org.json.JSONTokener(candidates).nextValue())),reports=new org.json.JSONArray();out.put("tracks",reports);
            String requestedTitle=arguments.getString("songTitle","");if(!requestedTitle.isEmpty()){org.json.JSONArray filtered=new org.json.JSONArray();for(int n=0;n<chosen.length();n++)if(chosen.getJSONObject(n).optString("title").equals(requestedTitle))filtered.put(chosen.getJSONObject(n));if(filtered.length()==0)throw new IOException("Requested recent song missing");chosen=filtered;}
            android.media.AudioManager audio=(android.media.AudioManager)target.getSystemService(Context.AUDIO_SERVICE);
            org.json.JSONArray routes=new org.json.JSONArray();for(android.media.AudioDeviceInfo device:audio.getDevices(android.media.AudioManager.GET_DEVICES_OUTPUTS))routes.put(device.getType());
            out.put("systemAudio",new JSONObject().put("musicVolume",audio.getStreamVolume(android.media.AudioManager.STREAM_MUSIC)).put("musicMax",audio.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)).put("mode",audio.getMode()).put("outputTypes",routes));
            try {
                for(int n=0;n<chosen.length();n++){
                    JSONObject chosenTrack=chosen.getJSONObject(n),report=new JSONObject().put("title",chosenTrack.optString("title")).put("artist",chosenTrack.optString("artist"));reports.put(report);
                    evaluate(view,"[...document.querySelectorAll('.mobile-nav button')].find(b=>b.textContent.includes('个人')).click();true");Thread.sleep(450);
                    evaluate(view,"(()=>{const b=[...document.querySelectorAll('.recent-strip button')].find(b=>b.querySelector('strong')?.textContent==="+JSONObject.quote(chosenTrack.getString("title"))+"&&b.querySelector('small')?.textContent==="+JSONObject.quote(chosenTrack.getString("artist"))+");b?.scrollIntoView({block:'center',inline:'center',behavior:'instant'});return !!b;})()");Thread.sleep(250);
                    String point=evaluate(view,"JSON.stringify((()=>{const b=[...document.querySelectorAll('.recent-strip button')].find(b=>b.querySelector('strong')?.textContent==="+JSONObject.quote(chosenTrack.getString("title"))+"&&b.querySelector('small')?.textContent==="+JSONObject.quote(chosenTrack.getString("artist"))+");if(!b)return null;const r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;return{x,y,hit:document.elementFromPoint(x,y)?.closest('button')===b};})())");
                    JSONObject targetPoint=new JSONObject(String.valueOf(new org.json.JSONTokener(point).nextValue()));report.put("touchTargetVisible",targetPoint.optBoolean("hit"));
                    double scale=view.getWidth()/Double.parseDouble(evaluate(view,"innerWidth"));int[] screenOrigin=new int[2];runOnMainSync(()->view.getLocationOnScreen(screenOrigin));float px=(float)(screenOrigin[0]+targetPoint.getDouble("x")*scale),py=(float)(screenOrigin[1]+targetPoint.getDouble("y")*scale);long down=android.os.SystemClock.uptimeMillis();
                    for(int touchAction:new int[]{android.view.MotionEvent.ACTION_DOWN,android.view.MotionEvent.ACTION_UP}){android.view.MotionEvent event=android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),touchAction,px,py,0);event.setSource(android.view.InputDevice.SOURCE_TOUCHSCREEN);try{getUiAutomation().injectInputEvent(event,true);}finally{event.recycle();}Thread.sleep(80);}
                    report.put("actualTouchDispatched",true);
                    Thread.sleep(300);report.put("touchEvents",evaluate(view,"JSON.stringify(window.__zenixTouches)"));Bundle clickReport=new Bundle();clickReport.putString("zenixTouch",report.toString());sendStatus(0,clickReport);
                    long began=android.os.SystemClock.elapsedRealtime();double first=-1;org.json.JSONArray samples=new org.json.JSONArray();report.put("samples",samples);
                    while(android.os.SystemClock.elapsedRealtime()-began<90000){
                        Thread.sleep(1000);JSONObject state=playbackSnapshot(service),selected=state.optJSONObject("track"),activity=state.optJSONObject("sourceActivity");
                        JSONObject sample=new JSONObject().put("elapsedMs",android.os.SystemClock.elapsedRealtime()-began).put("selected",selected==null?"":selected.optString("title")).put("playing",state.optBoolean("playing")).put("wanted",state.optBoolean("playWhenReady")).put("position",state.optDouble("position")).put("volume",state.optDouble("volume")).put("systemMusicActive",audio.isMusicActive());
                        if(activity!=null)sample.put("phase",activity.optString("phase")).put("message",activity.optString("message"));if(state.has("error"))sample.put("error",state.optString("error"));
                        runOnMainSync(()->{try{androidx.media3.exoplayer.ExoPlayer decoder=(androidx.media3.exoplayer.ExoPlayer)field(service,"player");sample.put("decoderState",decoder.getPlaybackState()).put("suppression",decoder.getPlaybackSuppressionReason());androidx.media3.exoplayer.DecoderCounters counters=decoder.getAudioDecoderCounters();if(counters!=null){counters.ensureUpdated();sample.put("renderedAudioBuffers",counters.renderedOutputBufferCount).put("skippedAudioBuffers",counters.skippedOutputBufferCount);}JSONObject resolved=(JSONObject)field(service,"resolution");if(resolved!=null)sample.put("provider",resolved.optString("providerName")).put("quality",resolved.optString("quality"));}catch(Exception failure){throw new RuntimeException(failure);}});
                        samples.put(sample);Bundle progress=new Bundle();progress.putString("zenixPlaybackSample",sample.toString());sendStatus(0,progress);
                        if(android.os.SystemClock.elapsedRealtime()-began>5000&&!state.optBoolean("playWhenReady")&&!state.optBoolean("playing")&&activity==null){report.put("noPlayCommandObserved",true);break;}
                        if(selected!=null&&selected.optString("title").equals(chosenTrack.optString("title"))&&state.optBoolean("playing")){if(first<0)first=state.optDouble("position");if(state.optDouble("position")>=first+20){report.put("sustainedProgress",true);break;}}
                        if(activity!=null&&activity.optString("phase").equals("failed")||state.has("error")&&!state.optBoolean("playWhenReady")){report.put("failed",true);break;}
                    }
                }
                out.put("uiErrors",evaluate(view,"JSON.stringify(window.__zenixPlaybackErrors)"));
                for(int n=0;n<reports.length();n++)if(!reports.getJSONObject(n).optBoolean("sustainedProgress")||!reports.getJSONObject(n).optBoolean("touchTargetVisible"))out.put("ok",false);
            } finally {
                runOnMainSync(()->{try{call(service,"setQueue",new Class<?>[]{org.json.JSONArray.class,int.class},originalQueue,originalIndex);call(service,"pausePlayback",new Class<?>[]{});if(originalPosition>0)call(service,"seek",new Class<?>[]{double.class},originalPosition);if(originalWanted)call(service,"resume",new Class<?>[]{});}catch(Exception failure){throw new RuntimeException(failure);}});
            }
        } else if (mode.equals("playbackCheck")) {
            Intent launch=target.getPackageManager().getLaunchIntentForPackage(target.getPackageName());launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);runOnMainSync(()->target.startActivity(launch));
            Class<?> runtimeClass=target.getClassLoader().loadClass("com.zenix.musicplayer.ZenixRuntime");Method get=runtimeClass.getDeclaredMethod("get",Context.class);get.setAccessible(true);Object runtime=get.invoke(null,target);
            long until=android.os.SystemClock.elapsedRealtime()+15000;Object service;
            while((service=field(runtime,"service"))==null&&android.os.SystemClock.elapsedRealtime()<until)Thread.sleep(100);
            if(service==null)throw new IOException("Playback service not available");Object player=service;
            JSONObject before=playbackSnapshot(player);boolean wasWanted=before.optBoolean("playWhenReady");
            if(arguments.getString("playlistFirst","false").equals("true")){
                org.json.JSONArray lists=mainPersonal.getJSONArray("playlists");JSONObject chosen=null;for(int i=0;i<lists.length();i++)if(lists.getJSONObject(i).getJSONArray("tracks").length()==296){chosen=lists.getJSONObject(i);break;}
                if(chosen==null)throw new IOException("296-song playlist not found");org.json.JSONArray queue=new org.json.JSONArray();for(int i=0;i<chosen.getJSONArray("tracks").length();i++)queue.put(new JSONObject(chosen.getJSONArray("tracks").getJSONObject(i).toString()).put("playlistId",chosen.getString("id")));
                runOnMainSync(()->{try{call(player,"setQueue",new Class<?>[]{org.json.JSONArray.class,int.class},queue,0);}catch(Exception error){throw new RuntimeException(error);}});out.put("testedPlaylistCount",queue.length());
                before=playbackSnapshot(player);
            }
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
    private static void setField(Object receiver,String name,Object value)throws Exception {Field field=receiver.getClass().getDeclaredField(name);field.setAccessible(true);field.set(receiver,value);}
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
