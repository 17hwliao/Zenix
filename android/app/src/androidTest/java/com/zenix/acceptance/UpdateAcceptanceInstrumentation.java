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

/** Opt-in, original-signed device test. Reports hashes, never personal configuration contents. */
public final class UpdateAcceptanceInstrumentation extends Instrumentation {
    private Bundle arguments;
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
        if (mode.equals("seed")||mode.equals("verify")) {
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
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);Activity activity=startActivitySync(launch);
            runOnMainSync(()->activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON));
            Object updates=create(target,"AppUpdates",target);
            JSONObject state=(JSONObject)call(updates,"check",new Class<?>[]{String.class},arguments.getString("channel","preview"));
            if(!mode.equals("check")&&state.optString("status").equals("available"))state=(JSONObject)call(updates,"download",new Class<?>[]{});
            if(mode.equals("install")&&state.optString("status").equals("ready")) {
                state=(JSONObject)call(updates,"install",new Class<?>[]{Activity.class},activity);
            }
            out.put("updateState",state);
            Object worker=field(updates,"worker");((java.util.concurrent.ExecutorService)worker).shutdownNow();
        } else if(!mode.equals("snapshot"))throw new IOException("Unsupported acceptance mode");
        return out;
    }
    private static Object create(Context target,String name,Context context)throws Exception {
        Class<?> type=target.getClassLoader().loadClass("com.zenix.musicplayer."+name);Constructor<?> constructor=type.getDeclaredConstructor(Context.class);constructor.setAccessible(true);return constructor.newInstance(context);
    }
    private static Object call(Object receiver,String name,Class<?>[] types,Object... args)throws Exception {Method method=receiver.getClass().getDeclaredMethod(name,types);method.setAccessible(true);return method.invoke(receiver,args);}
    private static Object field(Object receiver,String name)throws Exception {Field field=receiver.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(receiver);}
    private static JSONObject fileDigest(File file)throws Exception {
        JSONObject info=new JSONObject().put("exists",file.isFile());if(!file.isFile())return info;
        MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] bytes=new byte[65536];int n;while((n=input.read(bytes))!=-1)digest.update(bytes,0,n);}
        return info.put("size",file.length()).put("sha256",hex(digest.digest()));
    }
    private static String hex(byte[] bytes){StringBuilder text=new StringBuilder();for(byte value:bytes)text.append(String.format(Locale.ROOT,"%02x",value&255));return text.toString();}
}
