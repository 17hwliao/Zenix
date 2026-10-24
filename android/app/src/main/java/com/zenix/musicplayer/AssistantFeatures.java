package com.zenix.musicplayer;

import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.AtomicFile;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

final class AssistantFeatures {
    private final Context context;private final AtomicFile file;private JSONObject skin;private String error="";
    AssistantFeatures(Context context){this.context=context.getApplicationContext();file=new AtomicFile(new File(context.getFilesDir(),"assistant-skin.json"));try{JSONObject envelope=new JSONObject(new String(SourceHttp.bounded(file.openRead(),26*1024*1024),StandardCharsets.UTF_8));JSONObject saved=ProtectedJson.decode(envelope);skin=saved.optBoolean("default")?null:validate(saved);}catch(FileNotFoundException ignored){}catch(Exception failure){error="已保留无法读取的皮肤文件，当前使用默认形象。";}}
    static JSONObject validate(JSONObject value)throws Exception {
        String archive=value.optString("archive");if(archive.length()>12*1024*1024)throw new IOException("皮肤包过大");JSONObject config=value.getJSONObject("config"),images=value.getJSONObject("images");if(config.optInt("schema")!=1)throw new IOException("皮肤规范版本不受支持");int width=config.optInt("width"),height=config.optInt("height");if(width<16||height<16||width>2048||height>2048)throw new IOException("皮肤画布无效");JSONArray frames=config.getJSONArray("frames");if(frames.length()<1||frames.length()>96||images.length()>96||(long)width*height*frames.length()>16777216L)throw new IOException("皮肤图片数量无效");int total=0;for(int i=0;i<frames.length();i++){String name=frames.getString(i);if(!name.matches("frames/[a-zA-Z0-9_-]+\\.png"))throw new IOException("皮肤图片路径无效");String data=images.getString(name);if(data.length()>3*1024*1024)throw new IOException("图片过大");byte[] bytes=Base64.decode(data,Base64.NO_WRAP);if(bytes.length<33||bytes.length>2*1024*1024)throw new IOException("皮肤图片大小无效");int[] signature={137,80,78,71,13,10,26,10};for(int j=0;j<8;j++)if((bytes[j]&255)!=signature[j])throw new IOException("只支持PNG皮肤");java.nio.ByteBuffer png=java.nio.ByteBuffer.wrap(bytes);if(png.getInt(16)!=width||png.getInt(20)!=height)throw new IOException("图片画布尺寸不一致");total+=bytes.length;if(total>16*1024*1024)throw new IOException("皮肤展开过大");}
        JSONObject animations=config.getJSONObject("animations"),idle=animations.getJSONObject("idle");for(String state:java.util.List.of("idle","listening","thinking","executing","success","failure","shy","talking","greeting","cheer")){JSONObject animation=animations.optJSONObject(state);if(animation==null)animation=idle;JSONArray ids=animation.getJSONArray("frames");int fps=animation.optInt("fps",12);if(ids.length()<1||ids.length()>192||fps<1||fps>30)throw new IOException("动画参数无效");for(int i=0;i<ids.length();i++)if(ids.getInt(i)<0||ids.getInt(i)>=frames.length())throw new IOException("动画帧索引无效");}
        return Json.obj("archive",archive,"config",config,"images",images);
    }
    private void save(JSONObject value)throws Exception {JSONObject saved=value==null?Json.obj("default",true):value;if(saved.toString().getBytes(StandardCharsets.UTF_8).length>18*1024*1024)throw new IOException("皮肤保存内容超过18 MiB");byte[] bytes=ProtectedJson.encode(saved.toString()).getBytes(StandardCharsets.UTF_8);FileOutputStream output=null;try{output=file.startWrite();output.write(bytes);file.finishWrite(output);}catch(Exception failure){if(output!=null)file.failWrite(output);throw failure;}}
    synchronized JSONObject skin(){return skin==null?null:Json.copy(skin);}
    synchronized Object invoke(JSONObject args)throws Exception {
        switch(args.optString("action")){
            case "state":return Json.obj("enabled",AssistantOverlayService.running(),"skin",skin==null?JSONObject.NULL:Json.obj("archive",skin.optString("archive")),"error",error);
            case "skinSave":if(!error.isEmpty())throw new IOException(error);JSONObject next=validate(Json.obj("archive",args.optString("base64"),"config",args.getJSONObject("config"),"images",args.getJSONObject("images")));save(next);skin=next;AssistantOverlayService.refreshSkin();return true;
            case "skinReset":save(null);skin=null;error="";AssistantOverlayService.refreshSkin();return true;
            case "overlay":if(!args.optBoolean("enabled",true)){context.stopService(new Intent(context,AssistantOverlayService.class));return Json.obj("enabled",false,"permitted",Settings.canDrawOverlays(context));}if(!Settings.canDrawOverlays(context)){Intent permission=new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,Uri.parse("package:"+context.getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);context.startActivity(permission);return Json.obj("enabled",false,"permitted",false);}Intent intent=new Intent(context,AssistantOverlayService.class).putExtra("size",Math.max(64,Math.min(220,args.optInt("size",120))));if(Build.VERSION.SDK_INT>=26)context.startForegroundService(intent);else context.startService(intent);return Json.obj("enabled",AssistantOverlayService.running(),"permitted",true,"requested",true);
            default:throw new IOException("未知助手操作");
        }
    }
}
