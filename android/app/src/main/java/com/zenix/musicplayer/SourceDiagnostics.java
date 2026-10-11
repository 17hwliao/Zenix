package com.zenix.musicplayer;

import org.json.*;
import java.util.*;

/** Bounded, local, actual-use observations. No URLs, headers or script settings. */
final class SourceDiagnostics implements AutoCloseable {
    private final PrivateStore store;
    private final android.util.AtomicFile file;private JSONObject data=new JSONObject();private long revision,persisted;private final java.util.concurrent.ExecutorService writer=java.util.concurrent.Executors.newSingleThreadExecutor();private final java.util.concurrent.atomic.AtomicBoolean queued=new java.util.concurrent.atomic.AtomicBoolean();
    SourceDiagnostics(android.content.Context context,PrivateStore store){this.store=store;file=new android.util.AtomicFile(new java.io.File(context.getFilesDir(),"playback-diagnostics.json"));try{JSONObject loaded=new JSONObject(new String(SourceHttp.bounded(file.openRead(),2*1024*1024),java.nio.charset.StandardCharsets.UTF_8));int sources=0;for(Iterator<String> keys=loaded.keys();keys.hasNext()&&sources++<80;){String id=keys.next();JSONArray rows=loaded.optJSONArray(id),clean=new JSONArray();if(rows!=null)for(int i=Math.max(0,rows.length()-80);i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row!=null&&!row.optString("id").isEmpty()&&row.optString("id").length()<=80&&row.optLong("at")>System.currentTimeMillis()-7*86400000L)clean.put(Json.obj("id",row.optString("id"),"at",row.optLong("at"),"ms",Math.max(0,Math.min(600000,row.optLong("ms"))),"resolved",row.optBoolean("resolved"),"played",row.optBoolean("played"),"reason",row.optString("reason").isEmpty()?"":reason(row.optString("reason"))));}Json.put(data,id,clean);}}catch(Exception ignored){}}
    private void save(){revision++;schedule();}
    private void schedule(){if(!queued.compareAndSet(false,true))return;try{writer.execute(()->{long selected;String text;synchronized(this){selected=revision;text=data.toString();}java.io.FileOutputStream output=null;try{output=file.startWrite();output.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));file.finishWrite(output);synchronized(this){persisted=selected;}}catch(Exception e){if(output!=null)file.failWrite(output);}finally{queued.set(false);boolean again;synchronized(this){again=revision>selected;}if(again)schedule();}});}catch(java.util.concurrent.RejectedExecutionException ignored){queued.set(false);}}
    @Override public void close(){writer.shutdown();}
    static String reason(Object error){String text=String.valueOf(error).toLowerCase(Locale.ROOT);if(text.matches("(?s).*(timeout|timed out|超时).*"))return "连接超时";if(text.matches("(?s).*(unsupported|format|codec|不支持|格式).*"))return "音频或品质不受支持";if(text.matches("(?s).*(401|403|权限).*"))return "资源拒绝访问";if(text.matches("(?s).*(network|connect|dns|网络|连接).*"))return "网络连接失败";return "资源暂不可用";}
    synchronized String record(String provider,long started,Exception error){
        if(error instanceof java.util.concurrent.CancellationException)return "";
        String id=UUID.randomUUID().toString();JSONObject data=this.data;
        if(!data.has(provider)&&data.length()>=80)data.remove(data.keys().next());
        JSONArray previous=data.optJSONArray(provider),rows=new JSONArray();long now=System.currentTimeMillis();
        if(previous!=null)for(int i=Math.max(0,previous.length()-79);i<previous.length();i++){JSONObject row=previous.optJSONObject(i);if(row!=null&&row.optLong("at")>now-7*86400000L)rows.put(row);}
        rows.put(Json.obj("id",id,"at",now,"ms",Math.max(0,android.os.SystemClock.elapsedRealtime()-started),"resolved",error==null,"played",false,"reason",error==null?"":reason(error)));Json.put(data,provider,rows);
        save();return id;
    }
    synchronized void outcome(JSONObject result,boolean played,Object error){if(result==null||result.has("cacheHit"))return;String id=result.optString("diagnosticAttemptId");JSONObject data=this.data;if(id.isEmpty())return;JSONArray rows=data.optJSONArray(result.optString("providerId"));if(rows==null)return;
        for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row!=null&&row.optString("id").equals(id)){if(played&&row.optBoolean("played"))return;if(played)Json.put(row,"played",true);if(error!=null)Json.put(row,"reason",reason(error));save();break;}}
    }
    synchronized JSONObject state(){JSONObject data=this.data,sources=new JSONObject();long now=System.currentTimeMillis();if(data!=null)for(Iterator<String> keys=data.keys();keys.hasNext();){String id=keys.next();JSONArray rows=data.optJSONArray(id);int attempts=0,resolved=0,played=0;long ms=0,lastPlayed=0;String last="";if(rows!=null)for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row==null||row.optLong("at")<=now-7*86400000L)continue;attempts++;ms+=row.optLong("ms");if(row.optBoolean("resolved"))resolved++;if(row.optBoolean("played")){played++;lastPlayed=Math.max(lastPlayed,row.optLong("at"));}if(!row.optString("reason").isEmpty())last=row.optString("reason");}Json.put(sources,id,Json.obj("attempts",attempts,"resolved",resolved,"played",played,"averageMs",attempts==0?0:ms/attempts,"lastPlayedAt",lastPlayed,"lastFailure",last));}return Json.obj("smooth",store.readKeys("smoothPlayback").optBoolean("smoothPlayback"),"sources",sources);}
    JSONObject configure(boolean enabled)throws Exception{store.set("smoothPlayback",enabled);return state();}
}
