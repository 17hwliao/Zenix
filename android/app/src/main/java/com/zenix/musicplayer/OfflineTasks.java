package com.zenix.musicplayer;

import android.content.Context;
import android.net.Uri;
import androidx.media3.common.C;
import androidx.media3.datasource.*;
import androidx.media3.datasource.cache.*;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
import okhttp3.*;

/** Independent offline queue, sharing PlaybackService's sole SimpleCache instance. */
@androidx.annotation.OptIn(markerClass=androidx.media3.common.util.UnstableApi.class)
final class OfflineTasks implements AutoCloseable {
    private final Context context;private final ZenixRuntime runtime;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private JSONObject data;private volatile String active="";private volatile boolean stopping,closed;private String storageError="";private boolean clearingCache;
    private volatile CacheWriter writer;private volatile OkHttpClient client;
    private volatile Thread executing;
    OfflineTasks(Context context,ZenixRuntime runtime){this.context=context.getApplicationContext();this.runtime=runtime;data=runtime.store.object("offlineTasks");if(data==null)data=Json.obj("schema",1,"tasks",new JSONArray(),"policy",NetworkPreferences.policy(runtime.store));if(data.optInt("schema")!=1||data.optJSONArray("tasks")==null){storageError="后台任务资料格式无效，已保留原资料并停止任务";data=Json.obj("schema",1,"tasks",new JSONArray());return;}JSONArray tasks=data.optJSONArray("tasks");for(int i=0;i<tasks.length();i++){JSONObject task=tasks.optJSONObject(i);if(task==null)continue;if(Set.of("queued","running","waiting").contains(task.optString("status")))Json.put(task,"status","paused");JSONArray items=task.optJSONArray("items");if(items!=null)for(int j=0;j<items.length();j++){JSONObject item=items.optJSONObject(j);if(item!=null&&item.optString("status").equals("running"))Json.put(item,"status","pending");}}}
    synchronized JSONObject state(){return Json.obj("tasks",data.optJSONArray("tasks"),"policy",NetworkPreferences.policy(runtime.store),"network",NetworkPreferences.network(context),"error",storageError,"clearing",clearingCache,"cache",runtime.service==null?Json.obj("usedBytes",0,"enabled",true,"limitMiB",runtime.store.integer("cacheLimitMiB",512)):runtime.service.cacheStats());}
    private void save()throws Exception{save(false);}
    private synchronized void save(boolean policyChange)throws Exception{if(!storageError.isEmpty())throw new Exception(storageError);if(data.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>8*1024*1024)throw new Exception("后台任务资料过大，请减少任务内容");try{runtime.store.backupLocked(()->{if(!policyChange)Json.put(data,"policy",NetworkPreferences.policy(runtime.store));runtime.store.replaceAtomic(Json.obj("offlineTasks",data));return null;});}catch(Exception failure){storageError="后台任务无法保存，已暂停任务并保留原资料";stopActive();throw new Exception(storageError,failure);}}
    synchronized JSONObject invoke(JSONObject args)throws Exception{
        String action=args.optString("action","state");if(action.equals("state")){pump();return state();}
        if(!storageError.isEmpty())throw new Exception(storageError);
        if(clearingCache&&Set.of("prepare","resume","retry","pin","unpin").contains(action))throw new Exception("缓存正在清理，请完成后再开始离线任务");
        if(action.equals("policy")){JSONObject policy=NetworkPreferences.policy(runtime.store),patch=args.optJSONObject("policy");if(patch!=null)for(String category:NetworkPreferences.CATEGORIES){String mode=patch.optString(category);if(Set.of("always","unmetered","never").contains(mode))Json.put(policy,category,mode);}Json.put(data,"policy",policy);save(true);if(!NetworkPreferences.allows(context,runtime.store,"preload")||!NetworkPreferences.allows(context,runtime.store,"audio")){JSONObject task=find(active);if(task!=null)Json.put(task,"status","waiting");stopActive();}pump();return state();}
        if(action.equals("pin")){pinTrack(args.optString("trackId"),args.optString("quality","high"),args.optString("group","手动保留"),args.optBoolean("keep",true));return state();}
        JSONArray tasks=data.getJSONArray("tasks");
        if(action.equals("prepare")){
            tasks=new JSONArray(tasks.toString());
            if(!runtime.store.readKeys("cacheEnabled").optBoolean("cacheEnabled",true))throw new Exception("请先开启音频缓存");
            JSONArray selected=args.optJSONArray("tracks");if(selected==null||selected.length()==0||selected.length()>2000)throw new Exception("每次请选择1至2000首歌曲");
            if(tasks.length()>=20){JSONArray next=new JSONArray();boolean removed=false;for(int i=0;i<tasks.length();i++){JSONObject value=tasks.getJSONObject(i);if(!removed&&Set.of("complete","cancelled").contains(value.optString("status"))){removed=true;continue;}next.put(value);}if(!removed)throw new Exception("任务过多，请先取消不需要的任务");tasks=next;}
            JSONArray items=new JSONArray();Set<String> seen=new HashSet<>();for(int i=0;i<selected.length();i++){JSONObject track=clean(selected.getJSONObject(i));if(seen.add(track.getString("id")))items.put(Json.obj("track",track,"status","pending","received",0,"total",0));}
            String quality=args.optString("quality","high");if(!Set.of("standard","high","lossless","lossless24").contains(quality))quality="high";
            tasks.put(Json.obj("id",UUID.randomUUID().toString(),"name",bounded(args.optString("name","离线收纳"),80),"quality",quality,"group",bounded(args.optString("group","离线收纳"),80),"pin",args.optBoolean("pin",true),"status","queued","createdAt",System.currentTimeMillis(),"items",items));
            if(tasks.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8).length>8*1024*1024-1024)throw new Exception("后台任务资料过大，请减少歌曲数量");Json.put(data,"tasks",tasks);
        }else{
            JSONObject task=find(args.optString("id"));if(task==null)throw new Exception("任务已不存在");
            if(action.equals("unpin")){JSONArray items=task.getJSONArray("items");for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);if(!item.optString("cacheKey").isEmpty())pinKey(item.optString("cacheKey"),task.optString("group"),false);else pinTrack(item.getJSONObject("track").optString("id"),task.optString("quality","high"),task.optString("group"),false);}Json.put(task,"pin",false);}
            else if(action.equals("pause")||action.equals("cancel")){Json.put(task,"status",action.equals("pause")?"paused":"cancelled");if(active.equals(task.optString("id")))stopActive();}
            else if(action.equals("resume")||action.equals("retry")){if(active.equals(task.optString("id")))throw new Exception("任务正在结束，请稍后继续");JSONArray items=task.getJSONArray("items");for(int i=0;i<items.length();i++){JSONObject item=items.getJSONObject(i);if(Set.of("failed","running").contains(item.optString("status"))){Json.put(item,"status","pending");item.remove("error");}}Json.put(task,"status","queued");task.remove("error");}
            else throw new Exception("未知任务操作");
        }
        save();pump();return state();
    }
    private synchronized JSONObject find(String id){JSONArray tasks=data.optJSONArray("tasks");for(int i=0;i<tasks.length();i++){JSONObject task=tasks.optJSONObject(i);if(task!=null&&task.optString("id").equals(id))return task;}return null;}
    private synchronized void pump(){if(!active.isEmpty()||closed||clearingCache||!storageError.isEmpty())return;JSONArray tasks=data.optJSONArray("tasks");for(int i=0;i<tasks.length();i++){JSONObject task=tasks.optJSONObject(i);if(task==null||!Set.of("queued","waiting").contains(task.optString("status")))continue;if(!NetworkPreferences.allows(context,runtime.store,"preload")||!NetworkPreferences.allows(context,runtime.store,"audio")){Json.put(task,"status","waiting");return;}active=task.optString("id");stopping=false;worker.execute(()->run(task));return;}}
    private void stopActive(){stopping=true;runtime.sources.cancelOffline();CacheWriter current=writer;if(current!=null)current.cancel();OkHttpClient transport=client;if(transport!=null)transport.dispatcher().cancelAll();Thread thread=executing;if(thread!=null&&thread!=Thread.currentThread())thread.interrupt();}
    private void check(){if(stopping||closed||Thread.currentThread().isInterrupted())throw new CancellationException();}
    private void run(JSONObject task){executing=Thread.currentThread();try{
        synchronized(this){check();Json.put(task,"status","running");save();}
        JSONArray items=task.getJSONArray("items");for(int i=0;i<items.length();i++){check();JSONObject item=items.getJSONObject(i),track=item.getJSONObject("track");String quality=task.optString("quality","high");
            if(track.optString("source").equals("local")){synchronized(this){Json.put(item,"status","local");save();}continue;}
            PlaybackService service=runtime.service;if(service==null)throw new Exception("播放器服务尚未就绪，请先打开播放器后继续任务");
            if(item.optString("status").equals("complete")&&service.completeCachedForInspection(track))continue;
            if(item.optString("status").equals("failed"))continue;
            synchronized(this){Json.put(item,"status","running");item.remove("error");}
            try{NetworkPreferences.require(context,runtime.store,"preload");NetworkPreferences.require(context,runtime.store,"audio");
                JSONObject mappings=runtime.store.object("cacheMappings"),saved=mappings==null?null:mappings.optJSONObject(track.optString("id"));SimpleCache cache=service.offlineCache();
                if(saved!=null&&ReplacementRules.cacheMatches(track,saved,runtime.store.object("personal"))){String key=saved.optString("cacheKey");long length=ContentMetadata.getContentLength(cache.getContentMetadata(key));if(length>0&&cache.isCached(key,0,length)){if(task.optBoolean("pin"))pinKey(key,task.optString("group"),true);synchronized(this){Json.put(item,"cacheKey",key);Json.put(item,"status","complete");Json.put(item,"received",length);Json.put(item,"total",length);save();}continue;}}
                JSONObject result=runtime.sources.resolveOffline(track,quality,()->stopping||closed);check();
                String key=result.getString("cacheKey"),url=result.getString("url");if(url.toLowerCase(Locale.ROOT).contains(".m3u8"))throw new Exception("流式播放列表不能标记为完整离线歌曲");
                synchronized(this){Json.put(item,"cacheKey",key);save();}
                if(task.optBoolean("pin"))pinKey(key,task.optString("group"),true);
                client=SourceHttp.playbackClient(result.optJSONArray("mediaHosts"),result.optBoolean("allowHttp")).newBuilder().dispatcher(new Dispatcher()).connectionPool(new ConnectionPool()).build();
                Map<String,String> headers=new HashMap<>();JSONObject raw=result.optJSONObject("headers");if(raw!=null)for(Iterator<String> keys=raw.keys();keys.hasNext();){String name=keys.next();if(!name.matches("(?i)host|content-length|range"))headers.put(name,raw.optString(name));}
                CacheDataSource source=new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(new OkHttpDataSource.Factory(client).setUserAgent("Zenix Android").setDefaultRequestProperties(headers)).setFlags(CacheDataSource.FLAG_BLOCK_ON_CACHE).createDataSource();
                writer=new CacheWriter(source,new DataSpec.Builder().setUri(Uri.parse(url)).setKey(key).build(),new byte[64*1024],(length,cached,newBytes)->{synchronized(this){Json.put(item,"received",cached);Json.put(item,"total",Math.max(0,length));}if(cached>200L*1024*1024||length>200L*1024*1024){CacheWriter current=writer;if(current!=null)current.cancel();}if(stopping){CacheWriter current=writer;if(current!=null)current.cancel();}});
                writer.cache();check();long length=ContentMetadata.getContentLength(cache.getContentMetadata(key));if(length<1024||!cache.isCached(key,0,length)||length>200L*1024*1024)throw new Exception("没有取得完整音频缓存");
                CacheDataSource local=new CacheDataSource.Factory().setCache(cache).createDataSource();byte[] prefix=new byte[64];int count=0;try{local.open(new DataSpec.Builder().setUri(Uri.parse(url)).setKey(key).setLength(64).build());while(count<16){int read=local.read(prefix,count,prefix.length-count);if(read==C.RESULT_END_OF_INPUT)break;count+=read;}}finally{local.close();}if(!MusicSources.audioPrefix(prefix,count)||new String(prefix,0,count,java.nio.charset.StandardCharsets.UTF_8).startsWith("#EXTM3U")){cache.removeResource(key);throw new Exception("缓存响应不是可识别的音频");}
                check();service.offlineRemember(track,result).get();check();synchronized(this){Json.put(item,"status","complete");Json.put(item,"received",length);Json.put(item,"total",length);}
            }catch(Exception failure){synchronized(this){Json.put(item,"status",stopping?"pending":"failed");if(!stopping)Json.put(item,"error",bounded(Json.message(failure),200));}}finally{writer=null;OkHttpClient finished=client;client=null;if(finished!=null){finished.dispatcher().cancelAll();finished.connectionPool().evictAll();}}
            synchronized(this){save();}
        }
        synchronized(this){if(!stopping){boolean failed=false;for(int i=0;i<items.length();i++)failed|=items.getJSONObject(i).optString("status").equals("failed");Json.put(task,"status",failed?"failed":"complete");}}
    }catch(CancellationException cancelled){}catch(Exception failure){synchronized(this){Json.put(task,"status","paused");Json.put(task,"error",bounded(Json.message(failure),200));}}finally{if(stopping||closed)Thread.interrupted();synchronized(this){executing=null;active="";try{save();}catch(Exception ignored){}pump();}}}
    private void pinTrack(String id,String quality,String group,boolean keep)throws Exception{JSONObject mappings=runtime.store.object("cacheMappings"),saved=mappings==null?null:mappings.optJSONObject(id);if(saved==null){if(keep)throw new Exception("该歌曲尚无音频缓存，请先准备离线");return;}pinKey(saved.getString("cacheKey"),group,keep);}
    private void pinKey(String key,String group,boolean keep)throws Exception{final String selectedGroup=bounded(group.isEmpty()?"离线收纳":group,80);runtime.store.backupLocked(()->{JSONObject pins=runtime.store.object("offlinePins");if(pins==null)pins=new JSONObject();Set<String> values=new LinkedHashSet<>();JSONArray current=pins.optJSONArray(key);if(current!=null)for(int i=0;i<current.length();i++)values.add(current.optString(i));if(keep){if(!pins.has(key)&&pins.length()>=2000)throw new Exception("固定缓存最多2000项，请先解除不需要的固定");values.add(selectedGroup);}else values.remove(selectedGroup);if(values.isEmpty())pins.remove(key);else{JSONArray next=new JSONArray();for(String value:values)next.put(value);Json.put(pins,key,next);}runtime.store.replaceAtomic(Json.obj("offlinePins",pins));return null;});}
    private static JSONObject clean(JSONObject track)throws Exception{String id=track.optString("id");if(id.isEmpty()||id.length()>2000)throw new Exception("歌曲标识无效");return Json.obj("id",id,"title",bounded(track.optString("title"),150),"artist",bounded(track.optString("artist"),150),"album",bounded(track.optString("album"),150),"duration",Math.max(0,track.optDouble("duration",0)),"source",track.optString("source").equals("local")?"local":"custom","providerId",bounded(track.optString("providerId"),100),"remoteId",bounded(track.optString("remoteId"),8000));}
    private static String bounded(String value,int limit){return value.substring(0,Math.min(limit,value.length()));}
    synchronized Future<?> pauseForCacheClear()throws Exception{clearingCache=true;JSONArray tasks=data.optJSONArray("tasks");for(int i=0;i<tasks.length();i++){JSONObject task=tasks.optJSONObject(i);if(task!=null&&Set.of("queued","running","waiting").contains(task.optString("status")))Json.put(task,"status","paused");}stopActive();save();return worker.submit(()->{});}
    synchronized void endCacheClear(){clearingCache=false;}
    @Override public synchronized void close(){closed=true;stopActive();worker.shutdown();}
}
