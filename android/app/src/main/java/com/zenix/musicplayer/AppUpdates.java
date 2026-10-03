package com.zenix.musicplayer;

import android.app.Activity;
import android.content.*;
import android.content.pm.*;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.*;
import java.util.concurrent.*;

/** Update work has its own serial worker and never blocks the music source queue. */
final class AppUpdates {
    final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Context context; private final JSONObject config;
    private JSONObject state, artifact; private File ready;
    private volatile boolean cancelled; private volatile HttpURLConnection connection;
    private final String currentVersion; private final long currentBuild;
    private static final JSONArray HOSTS=new JSONArray(Arrays.asList("raw.githubusercontent.com","github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"));
    AppUpdates(Context context) throws Exception {
        this.context=context.getApplicationContext();
        config=new JSONObject(new String(SourceHttp.bounded(context.getAssets().open("zenix/distribution.json"),16384),StandardCharsets.UTF_8));
        PackageInfo own=context.getPackageManager().getPackageInfo(context.getPackageName(),0);
        currentVersion=own.versionName;currentBuild=version(own);
        state=Json.obj("status","idle","currentVersion",currentVersion,"progress",0,"message","尚未检查更新");
    }
    private static long version(PackageInfo info){return Build.VERSION.SDK_INT>=28?info.getLongVersionCode():info.versionCode;}
    synchronized JSONObject state() throws Exception {return new JSONObject(state.toString());}
    private synchronized void set(String key,Object value){Json.put(state,key,value);}
    private synchronized String status(){return state.optString("status");}
    private synchronized void reset(){state=Json.obj("status","checking","currentVersion",currentVersion,"progress",0,"message","正在检查更新");}
    void cancel(){cancelled=true;HttpURLConnection c=connection;if(c!=null)c.disconnect();}
    private String text(String url,boolean restricted,int limit) throws Exception {
        if(!new URI(url).getScheme().equals("https"))throw new Exception("请使用 HTTPS 地址");
        JSONArray allowed=new JSONArray(HOSTS.toString());if(!restricted)allowed.put(new URI(url).getHost());
        JSONObject response=SourceHttp.request(url,new JSONObject(),allowed);
        int code=response.optInt("status");if(code==404&&restricted)throw new FileNotFoundException("此通道尚未发布更新清单");
        if(code!=200)throw new Exception("连接失败（HTTP "+code+"）");
        byte[] data=android.util.Base64.decode(response.getString("data"),android.util.Base64.DEFAULT);
        if(data.length>limit)throw new Exception("分享内容超过大小限制");return new String(data,StandardCharsets.UTF_8);
    }
    JSONObject check(String channel) throws Exception {
        if(!Arrays.asList("stable","preview").contains(channel))throw new Exception("更新通道无效");
        if(Arrays.asList("checking","downloading","installing").contains(status()))return state();
        reset();artifact=null;ready=null;
        try {
            JSONObject envelope=new JSONObject(text(config.getJSONObject("feeds").getString(channel),true,256*1024));
            byte[] bytes=android.util.Base64.decode(envelope.getString("payload"),android.util.Base64.DEFAULT);
            PublicKey key=KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(android.util.Base64.decode(config.getString("publicKeySpki"),android.util.Base64.DEFAULT)));
            java.security.Signature verifier=java.security.Signature.getInstance("SHA256withRSA");verifier.initVerify(key);verifier.update(bytes);
            if(!"zenix-signed-release".equals(envelope.optString("format"))||!verifier.verify(android.util.Base64.decode(envelope.getString("signature"),android.util.Base64.DEFAULT)))throw new Exception("发布签名校验失败，已停止更新");
            JSONObject manifest=new JSONObject(new String(bytes,StandardCharsets.UTF_8));
            if(manifest.optInt("schemaVersion")!=1||!channel.equals(manifest.optString("channel")))throw new Exception("更新清单格式错误");
            JSONObject item=manifest.getJSONObject("artifacts").optJSONObject("android");
            if(item==null){set("status","unpublished");set("message","当前通道尚未发布 Android 更新");return state();}
            if(item.optLong("build")<=currentBuild){set("status","current");set("message","已是此通道的最新版本");return state();}
            URI uri=new URI(item.getString("url"));long size=item.optLong("size");
            if(!"https".equals(uri.getScheme())||!"github.com".equals(uri.getHost())||uri.getUserInfo()!=null||!uri.getPath().startsWith("/17hwliao/Zenix/releases/download/")||!uri.getPath().endsWith(".apk")||!item.optString("sha256").matches("[a-f0-9]{64}")||size<1||size>512L*1024*1024)throw new Exception("安装包信息无效");
            artifact=item;set("version",item.getString("version"));set("notes",manifest.optString("notes"));set("status","available");set("message","发现新版本 "+item.getString("version"));
        }catch(Exception error){set("status",error instanceof FileNotFoundException?"unpublished":"error");set("message",Json.message(error));}
        return state();
    }
    JSONObject download() throws Exception {
        if(artifact==null||!Arrays.asList("available","error","ready").contains(status()))return state();
        JSONObject item=artifact;cancelled=false;set("status","downloading");set("progress",0);set("message","正在下载更新，音乐继续播放");
        File directory=new File(context.getFilesDir(),"updates"),partial=new File(directory,"update.part"),target=new File(directory,"update.apk");
        try {
            if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("无法创建更新目录");
            if(target.isFile()&&target.length()==item.getLong("size")&&hashFile(target).equals(item.getString("sha256"))){validateApk(target,item);ready=target;set("status","ready");set("progress",100);set("message","已读取校验通过的更新包，点击后由系统确认安装");return state();}
            URL url=SourceHttp.check(item.getString("url"),HOSTS);HttpURLConnection c=null;
            for(int hop=0;hop<5;hop++){
                c=(HttpURLConnection)url.openConnection();connection=c;c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(15000);c.setRequestProperty("Accept-Encoding","identity");
                if(cancelled)throw new IOException("下载已取消");int code=c.getResponseCode();
                if(code>=300&&code<400){URL next=SourceHttp.check(new URL(url,c.getHeaderField("Location")).toString(),HOSTS);c.disconnect();c=null;url=next;continue;}
                if(code!=200)throw new IOException("下载失败（HTTP "+code+"）");break;
            }
            if(c==null)throw new IOException("重定向次数过多");
            long expected=item.getLong("size"),total=0,deadline=android.os.SystemClock.elapsedRealtime()+600000;
            if(c.getContentLengthLong()>expected)throw new IOException("安装包大小与发布记录不一致");
            MessageDigest digest=MessageDigest.getInstance("SHA-256");
            try(InputStream input=c.getInputStream();OutputStream output=new FileOutputStream(partial)){
                byte[] buffer=new byte[65536];int n;
                while((n=input.read(buffer))!=-1){if(cancelled||android.os.SystemClock.elapsedRealtime()>deadline)throw new IOException("下载已取消或超时");total+=n;if(total>expected)throw new IOException("安装包超过声明大小");digest.update(buffer,0,n);output.write(buffer,0,n);set("progress",(int)(total*100/expected));}
            }
            if(total!=expected||!hex(digest.digest()).equals(item.getString("sha256")))throw new IOException("安装包校验失败，请重新下载");
            validateApk(partial,item);if(target.exists()&&!target.delete())throw new IOException("无法替换旧更新包");if(!partial.renameTo(target))throw new IOException("无法保存更新包");ready=target;
            set("status","ready");set("message","更新已就绪，点击后由系统确认安装");
        }catch(Exception error){set("status","error");set("message",cancelled?"下载已取消，可重新尝试":Json.message(error));}
        finally{if(connection!=null)connection.disconnect();connection=null;partial.delete();}
        return state();
    }
    @SuppressWarnings("deprecation") private void validateApk(File file,JSONObject item) throws Exception {
        PackageManager pm=context.getPackageManager();int flags=Build.VERSION.SDK_INT>=28?PackageManager.GET_SIGNING_CERTIFICATES:PackageManager.GET_SIGNATURES;
        PackageInfo installed=pm.getPackageInfo(context.getPackageName(),flags),incoming=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags);
        if(incoming==null||!context.getPackageName().equals(incoming.packageName)||version(incoming)!=item.getLong("build")||!item.getString("version").equals(incoming.versionName)||version(incoming)<=currentBuild)throw new Exception("安装包标识或版本不匹配");
        android.content.pm.Signature[] a=Build.VERSION.SDK_INT>=28?installed.signingInfo.getApkContentsSigners():installed.signatures;
        android.content.pm.Signature[] b=Build.VERSION.SDK_INT>=28?incoming.signingInfo.getApkContentsSigners():incoming.signatures;
        Set<String> own=new HashSet<>(),next=new HashSet<>();for(android.content.pm.Signature s:a)own.add(hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));for(android.content.pm.Signature s:b)next.add(hex(MessageDigest.getInstance("SHA-256").digest(s.toByteArray())));
        if(own.isEmpty()||!own.equals(next))throw new Exception("新版本与当前应用签名不同，不能覆盖安装。请使用同一发行密钥构建");
    }
    JSONObject install(Activity activity) throws Exception {
        if(ready==null||!"ready".equals(status()))throw new Exception("安装包尚未就绪");
        if(!hashFile(ready).equals(artifact.getString("sha256")))throw new Exception("安装包发生变化，请重新下载");validateApk(ready,artifact);
        if(Build.VERSION.SDK_INT>=26&&!context.getPackageManager().canRequestPackageInstalls()){
            set("message","请允许 Zenix 安装应用，返回后再次点击安装");activity.runOnUiThread(()->activity.startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+context.getPackageName()))));return state();
        }
        Uri uri=FileProvider.getUriForFile(context,context.getPackageName()+".fileprovider",ready);
        activity.runOnUiThread(()->activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)));
        set("message","请在系统窗口确认安装；取消后可再次安装");return state();
    }
    String sourceBundle(String url) throws Exception {String address=url.isEmpty()?config.optString("managedSourcesUrl"):url;if(address.isEmpty())throw new Exception("尚未配置专用源分享地址，可选择分享包文件或粘贴链接");return text(address,false,4*1024*1024);}
    private static String hashFile(File file) throws Exception {MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream input=new FileInputStream(file)){byte[] bytes=new byte[65536];int n;while((n=input.read(bytes))!=-1)digest.update(bytes,0,n);}return hex(digest.digest());}
    private static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
}
