package com.zenix.musicplayer;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name="ZenixNative",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class ZenixNativePlugin extends Plugin {
    private ZenixRuntime runtime;
    private AppUpdates updates;
    @Override public void load(){runtime=ZenixRuntime.get(getContext());runtime.ensureService();runtime.observe(this,true);}
    @Override protected void handleOnResume(){runtime.observe(this,true);}
    @Override protected void handleOnPause(){runtime.observe(this,false);}
    @Override protected void handleOnDestroy(){runtime.removeObserver(this);if(updates!=null){updates.cancel();updates.worker.shutdown();}}
    void publish(JSONObject state){try{notifyListeners("snapshot",new JSObject(state.toString()));}catch(Exception ignored){}}
    void publishPrepared(JSObject state){notifyListeners("snapshot",state);}
    private void result(PluginCall call,Object value){JSObject response=new JSObject();response.put("value",value==null?JSONObject.NULL:value);call.resolve(response);}
    @PluginMethod public void invoke(PluginCall call){
        String action=call.getString("action","");JSONObject args=call.getObject("payload",new JSObject());
        if(action.equals("features")){
            String operation=args.optString("operation");
            if(operation.equals("exportFile")||operation.equals("saveImage")){Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType(operation.equals("saveImage")?"image/png":"application/octet-stream");intent.putExtra(Intent.EXTRA_TITLE,operation.equals("saveImage")?"Zenix-音乐回忆.png":"Zenix-歌单.zenixlist");startActivityForResult(call,intent,"featureFile");return;}
            if(operation.equals("importFile")){Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.setType("*/*");startActivityForResult(call,intent,"featureFile");return;}
            if(operation.startsWith("timer")||operation.equals("widgetPin")){
                runtime.main.post(()->{try{PlaybackService service=runtime.service;if(service==null)throw new Exception("播放器正在启动，请稍后重试");Object value;if(operation.equals("timerSet"))value=service.setSleepTimer(args.optDouble("minutes"));else if(operation.equals("timerCancel"))value=service.setSleepTimer(0);else if(operation.equals("timerState"))value=service.sleepTimerState();else if(operation.equals("widgetPin"))value=MusicWidget.requestPin(getContext(),args.optString("size","3x3"));else throw new Exception("未知定时操作");result(call,value);}catch(Exception e){call.reject(Json.message(e));}});return;
            }
            runtime.work.execute(()->{try{result(call,runtime.companion.invoke(args));}catch(Exception e){call.reject(Json.message(e));}});return;
        }
        if(action.equals("updates")) {
            try { if(updates==null)updates=new AppUpdates(getContext());
                String operation=args.optString("operation");
                if(operation.equals("state")){result(call,updates.state());return;}
                if(operation.equals("cancel")){updates.cancel();result(call,updates.state());return;}
                updates.worker.execute(()->{try{Object value;switch(operation){case "check":value=updates.check(args.optString("channel","stable"));break;case "download":value=updates.download();break;case "install":value=updates.install(getActivity());break;case "sourceBundle":value=updates.sourceBundle(args.optString("url"));break;default:throw new Exception("无效更新操作");}result(call,value);}catch(Exception e){call.reject(Json.message(e));}});
            }catch(Exception e){call.reject(Json.message(e));}return;
        }
        if(action.equals("exit")){getActivity().moveTaskToBack(true);result(call,true);return;}
        if(action.equals("overlayEnable")) {
            if (!args.optBoolean("enabled",true)) { getContext().stopService(new Intent(getContext(),LyricOverlayService.class)); result(call,runtime.overlayStatus());runtime.emit();return; }
            if (!LyricOverlayService.allowed(getContext())) {
                Intent permission=new Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+getContext().getPackageName()));
                startActivityForResult(call,permission,"overlayPermissionReturned");return;
            }
            try{LyricOverlayService.start(getContext());result(call,runtime.overlayStatus());}catch(Exception e){call.reject(Json.message(e));}return;
        }
        if(action.equals("overlayConfigure")) {
            runtime.main.post(()->{try{JSONObject settings=runtime.store.object("overlay");if(settings==null)settings=new JSONObject();for(java.util.Iterator<String> keys=args.keys();keys.hasNext();){String key=keys.next();if(java.util.Set.of("fontSize","color","locked","compact","font").contains(key))Json.put(settings,key,args.opt(key));}runtime.store.enqueue(Json.obj("overlay",settings));if(runtime.overlay!=null)runtime.overlay.configure(settings);runtime.emit();result(call,runtime.overlayStatus());}catch(Exception e){call.reject(Json.message(e));}});return;
        }
        if(action.equals("notifications")){if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED)requestPermissionForAlias("notifications",call,"notificationResult");else result(call,true);return;}
        if(action.equals("pickSourceBundle")||action.equals("pickSource")||action.equals("pickBackground")||action.equals("pickLocal")) {
            Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.addCategory(Intent.CATEGORY_OPENABLE);intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
            intent.setType(action.equals("pickLocal")?"audio/*":"*/*");
            if(action.equals("pickBackground"))intent.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/*","video/*"});
            if(action.equals("pickLocal"))intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,true);
            startActivityForResult(call,intent,"filePicked");return;
        }
        if(java.util.Set.of("play","toggle","seek","next","previous","mode","removeQueue","cacheConfigure","cacheClear","snapshot","roamingStart","roamingStop","roamingRetry","roamingPlay").contains(action)) {
            getActivity().runOnUiThread(() -> {try {
                PlaybackService player=runtime.service;if(player==null){runtime.ensureService();call.reject("播放器正在启动，请稍后重试");return;}
                switch(action){case "roamingStart":case "roamingStop":case "roamingRetry":case "roamingPlay":player.roamingCommand(action,args);break;case "play":player.setQueue(args.getJSONArray("tracks"),args.optInt("index",0));break;case "toggle":player.toggle();break;case "seek":player.seek(args.optDouble("seconds"));break;case "next":player.advance(1);break;case "previous":player.advance(-1);break;case "mode":player.mode(args);break;case "removeQueue":player.remove(args.getString("id"));break;case "cacheConfigure":player.configureCache(args);break;case "cacheClear":player.clearCache(error->{if(error!=null)call.reject(Json.message(error));else result(call,runtime.dynamicSnapshot());});return;case "snapshot":runtime.snapshot(value->result(call,value),error->call.reject(Json.message(error)));return;}
                result(call,runtime.dynamicSnapshot());runtime.emit();
            }catch(Exception e){call.reject(Json.message(e));}});return;
        }
        java.util.concurrent.ExecutorService worker=java.util.Set.of("search","artwork","lyrics","importUrl","install").contains(action)?runtime.sourceWork:runtime.work;
        try{worker.execute(() -> {try {
            Object value;
            switch(action){
                case "search":value=runtime.sources.search(args.getString("id"),args.getString("keyword").trim().substring(0,Math.min(120,args.getString("keyword").trim().length())),args.optString("cursor"));break;
                case "artwork":value=runtime.sources.artwork(args.getJSONObject("track"));String artUrl=((JSONObject)value).optString("url"),artId=args.getJSONObject("track").optString("id");if(!artUrl.isEmpty()){runtime.store.artwork(artId,artUrl);runtime.main.post(()->{if(runtime.service!=null)runtime.service.artwork(artId,artUrl);});}break;
                case "lyrics":value=runtime.sources.lyrics(args.getJSONObject("track"));break;
                case "sourceDigest":String digestText=args.getString("text");if(digestText.getBytes(StandardCharsets.UTF_8).length>512*1024)throw new Exception("脚本不能超过 512 KiB");value=MusicSources.sha(digestText);break;
                case "importUrl":value=runtime.sources.importUrl(args.getString("url"));break;
                case "previewSourceText":String sourceOrigin=args.getString("url");boolean localSource=args.optString("originKind").equals("file");if(localSource){if(sourceOrigin.isBlank()||sourceOrigin.length()>240)throw new Exception("本地源文件名无效");}else{java.net.URI sourceAddress=new java.net.URI(sourceOrigin);if(!java.util.Set.of("https","http").contains(sourceAddress.getScheme())||sourceAddress.getHost()==null||sourceAddress.getUserInfo()!=null)throw new Exception("分享源地址无效");}value=runtime.sources.preview(args.getString("text"),sourceOrigin,localSource?"file":"url");break;
                case "install":value=runtime.sources.install(args.getString("token"),args.optJSONObject("networkPolicy"));break;
                case "sourceEnable":value=runtime.sources.update(args.getString("id"),"enable",args);break;
                case "sourceRemove":value=runtime.sources.update(args.getString("id"),"remove",args);break;
                case "sourceConfigure":value=runtime.sources.update(args.getString("id"),"configure",args);break;
                case "sourceMove":value=runtime.sources.move(args.getString("id"),args.optInt("direction",1));break;
                case "personal":value=runtime.store.personal(args.getString("operation"),args);break;
                case "profile":runtime.store.set("profile",args);value=args;break;
                case "clearBackground":runtime.store.set("appearance",Json.obj("completed",true,"background",null));value=JSONObject.NULL;break;
                case "completeWelcome":JSONObject appearance=runtime.store.object("appearance");if(appearance==null)appearance=Json.obj("background",null);Json.put(appearance,"completed",true);runtime.store.set("appearance",appearance);value=appearance;break;
                case "licenses":StringBuilder text=new StringBuilder();for(String path:java.util.List.of("THIRD_PARTY_NOTICES.md","LICENSE","licenses/capacitor/LICENSE","licenses/androidx-media/LICENSE","licenses/undici/LICENSE","licenses/okhttp/LICENSE.txt","licenses/okio/LICENSE.txt")){text.append("\n\n").append(path).append("\n\n");text.append(new String(SourceHttp.bounded(getContext().getAssets().open("zenix/legal/"+path),256*1024),StandardCharsets.UTF_8));}value=text.toString();break;
                default:throw new Exception("未知 Android 操作");
            }
            result(call,value);runtime.emit();
        }catch(Exception e){call.reject(Json.message(e));}});}catch(java.util.concurrent.RejectedExecutionException error){call.reject("音乐资料加载较多，请稍后重试");}
    }
    @PermissionCallback private void notificationResult(PluginCall call){result(call,getPermissionState("notifications")==PermissionState.GRANTED);}
    @ActivityCallback private void overlayPermissionReturned(PluginCall call,ActivityResult returned){if(call==null)return;try{if(LyricOverlayService.allowed(getContext()))LyricOverlayService.start(getContext());result(call,runtime.overlayStatus());runtime.emit();}catch(Exception e){call.reject(Json.message(e));}}
    @ActivityCallback private void filePicked(PluginCall call,ActivityResult returned){
        if(call==null)return;Intent data=returned.getData();if(returned.getResultCode()!=Activity.RESULT_OK||data==null){result(call,null);return;}
        runtime.work.execute(() -> {try {
            String action=call.getString("action","");Uri uri=data.getData();
            if(action.equals("pickSourceBundle")){if(uri==null)throw new Exception("未选择分享源包");byte[] bytes=SourceHttp.bounded(getContext().getContentResolver().openInputStream(uri),8*1024*1024);result(call,Json.obj("name",displayName(uri),"base64",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP)));}
            else if(action.equals("pickSource")){if(uri==null)throw new Exception("未选择音乐源文件");String text=new String(SourceHttp.bounded(getContext().getContentResolver().openInputStream(uri),1024*1024),StandardCharsets.UTF_8);result(call,runtime.sources.preview(text,displayName(uri),"file"));}
            else if(action.equals("pickBackground")) {
                if(uri==null)throw new Exception("未选择背景");String type=getContext().getContentResolver().getType(uri);boolean video=type!=null&&type.startsWith("video/");if(type==null||!video&&!type.startsWith("image/"))throw new Exception("请选择图片或视频");
                File directory=new File(getContext().getFilesDir(),"background");directory.mkdirs();File file=new File(directory,"backdrop-"+System.currentTimeMillis()+(video?".mp4":".image"));long size=0;
                try(InputStream input=getContext().getContentResolver().openInputStream(uri);OutputStream output=new FileOutputStream(file)){byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){size+=n;if(size>256L*1024*1024)throw new Exception("背景不能超过 256 MiB");output.write(buffer,0,n);}}catch(Exception e){file.delete();throw e;}
                JSONObject background=Json.obj("kind",video?"video":"image","name",displayName(uri),"url",file.getAbsolutePath());runtime.store.set("appearance",Json.obj("completed",true,"background",background));for(File old:directory.listFiles())if(!old.equals(file))old.delete();result(call,background);
            } else {
                JSONArray local=runtime.store.array("localTracks");if(local==null)local=new JSONArray();java.util.List<Uri> chosen=new java.util.ArrayList<>();if(data.getClipData()!=null)for(int i=0;i<data.getClipData().getItemCount()&&i<100;i++)chosen.add(data.getClipData().getItemAt(i).getUri());else if(uri!=null)chosen.add(uri);
                for(Uri item:chosen) {getContext().getContentResolver().takePersistableUriPermission(item,Intent.FLAG_GRANT_READ_URI_PERMISSION);String id="local:"+MusicSources.sha(item.toString()).substring(0,24);boolean found=false;for(int j=0;j<local.length();j++)if(local.getJSONObject(j).optString("id").equals(id))found=true;if(found)continue;
                    JSONObject track=Json.obj("id",id,"path",item.toString(),"audioUrl",item.toString(),"source","local","title",displayName(item),"artist","本地音乐","duration",0);
                    try(MediaMetadataRetriever reader=new MediaMetadataRetriever()){reader.setDataSource(getContext(),item);String title=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE),artist=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST),duration=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);if(title!=null)Json.put(track,"title",title);if(artist!=null)Json.put(track,"artist",artist);if(duration!=null)Json.put(track,"duration",Long.parseLong(duration)/1000.0);String album=reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);if(album!=null)Json.put(track,"album",album);byte[] cover=reader.getEmbeddedPicture();if(cover!=null&&cover.length<=2*1024*1024){File artDirectory=new File(getContext().getFilesDir(),"covers");artDirectory.mkdirs();File art=new File(artDirectory,id.substring(6)+".jpg");try(OutputStream out=new FileOutputStream(art)){out.write(cover);}Json.put(track,"coverUrl",art.getAbsolutePath());}}
                    local.put(track);
                }
                runtime.store.set("localTracks",local);result(call,local);
            }
            runtime.emit();
        }catch(Exception e){call.reject(Json.message(e));}});
    }
    private String displayName(Uri uri){try(Cursor cursor=getContext().getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME},null,null,null)){if(cursor!=null&&cursor.moveToFirst())return cursor.getString(0);}catch(Exception ignored){}return "用户文件";}

    @ActivityCallback private void featureFile(PluginCall call,ActivityResult returned){
        if(call==null)return;Intent data=returned.getData();if(returned.getResultCode()!=Activity.RESULT_OK||data==null||data.getData()==null){result(call,false);return;}Uri uri=data.getData();
        runtime.work.execute(()->{try{JSONObject args=call.getObject("payload",new JSObject());String operation=args.optString("operation");
            if(operation.equals("importFile")){String text=new String(SourceHttp.bounded(getContext().getContentResolver().openInputStream(uri),PlaylistExchange.MAX_BYTES),StandardCharsets.UTF_8);result(call,runtime.companion.preview(PlaylistExchange.decode(text)));}
            else{byte[] bytes;if(operation.equals("exportFile"))bytes=PlaylistExchange.bundle(runtime.store,args.optJSONArray("ids")).toString().getBytes(StandardCharsets.UTF_8);else{String encoded=args.optString("base64");if(encoded.length()>6*1024*1024)throw new Exception("回忆卡过大");bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);byte[] signature={(byte)137,80,78,71,13,10,26,10};if(bytes.length<8||!java.util.Arrays.equals(signature,java.util.Arrays.copyOf(bytes,8)))throw new Exception("图片格式无效");}try(OutputStream output=getContext().getContentResolver().openOutputStream(uri,"wt")){if(output==null)throw new IOException("文件无法写入");output.write(bytes);}result(call,true);}
        }catch(Exception e){call.reject(Json.message(e));}});
    }
}
