package com.zenix.musicplayer;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.*;
import androidx.media3.common.*;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.*;
import androidx.media3.datasource.cache.*;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.*;
import org.json.*;
import java.io.File;
import java.util.*;
import java.util.concurrent.*;

/** The service owns queue/decoder/cache and survives Activity/WebView suspension. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class PlaybackService extends MediaSessionService {
    private ExoPlayer player; private MediaSession session; private SimpleCache cache;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService resolver=Executors.newSingleThreadExecutor();
    private ZenixRuntime runtime; private JSONArray queue=new JSONArray(); private int index=-1;
    private JSONObject track,activity,error; private String repeat="all",quality="high";private boolean shuffle,readyRecorded,cacheEnabled=true;private volatile long generation;private volatile boolean wanted;
    private Set<String> attempted=new HashSet<>();private JSONObject resolution;
    private DefaultHttpDataSource.Factory http;
    private CacheDataSource.Factory cacheFactory;
    private CacheBudget budget;
    @Override public void onCreate() {
        super.onCreate();runtime=ZenixRuntime.get(this);JSONObject saved=runtime.store.read();queue=saved.optJSONArray("queue");if(queue==null)queue=new JSONArray();index=Math.min(saved.optInt("queueIndex",-1),queue.length()-1);if(index>=0)track=queue.optJSONObject(index);repeat=saved.optString("repeat","all");shuffle=saved.optBoolean("shuffle");quality=saved.optString("quality","high");cacheEnabled=saved.optBoolean("cacheEnabled",true);
        budget=new CacheBudget(saved.optLong("cacheLimitMiB",512)*1024*1024);
        cache=new SimpleCache(new File(getCacheDir(),"audio"),budget,new StandaloneDatabaseProvider(this));
        http=new DefaultHttpDataSource.Factory().setUserAgent("Zenix/0.1 Android").setConnectTimeoutMs(7000).setReadTimeoutMs(10000).setAllowCrossProtocolRedirects(false);
        cacheFactory=new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(new DefaultDataSource.Factory(this,http)).setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
        // Audio-only streaming: bound allocator growth; disk cache is independent.
        DefaultLoadControl loadControl=new DefaultLoadControl.Builder().setBufferDurationsMs(10000,30000,1000,2500).setTargetBufferBytes(4*1024*1024).setPrioritizeTimeOverSizeThresholds(false).setBackBuffer(0,false).build();
        player=new ExoPlayer.Builder(this).setLoadControl(loadControl).setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(cacheFactory)).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),true);player.setHandleAudioBecomingNoisy(true);player.setWakeMode(C.WAKE_MODE_LOCAL);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if(state==Player.STATE_READY) { activity=null;error=null;if(!readyRecorded&&wanted&&track!=null){readyRecorded=true;JSONObject value=Json.copy(track);resolver.execute(() -> {try{runtime.store.personal("record",Json.obj("track",value));runtime.emit();}catch(Exception ignored){}});} }
                else if(state==Player.STATE_BUFFERING)activity=Json.obj("phase","buffering","message","音频正在缓冲","startedAt",System.currentTimeMillis());
                else if(state==Player.STATE_ENDED) { if(repeat.equals("one")){player.seekTo(0);player.play();}else advance(1); }
                runtime.emit();
            }
            @Override public void onIsPlayingChanged(boolean playing) {runtime.emit();}
            @Override public void onPlayerError(PlaybackException failure) {
                if(track!=null&&!track.optString("source").equals("local")&&wanted)resolveNext(generation);
                else {activity=null;error=Json.obj("message","无法播放此音频，请重新导入文件");runtime.emit();}
            }
        });
        Intent intent=new Intent(this,MainActivity.class);intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent launch=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        session=new MediaSession.Builder(this,new QueuePlayer(player)).setSessionActivity(launch).build();runtime.attach(this);runtime.emit();
    }
    private final class QueuePlayer extends ForwardingPlayer {
        QueuePlayer(Player player){super(player);}
        @Override public Player.Commands getAvailableCommands(){return super.getAvailableCommands().buildUpon().add(Player.COMMAND_SEEK_TO_NEXT).add(Player.COMMAND_SEEK_TO_PREVIOUS).add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM).add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM).build();}
        @Override public boolean isCommandAvailable(int command){return getAvailableCommands().contains(command);}
        @Override public void seekToNext(){advance(1);}
        @Override public void seekToNextMediaItem(){advance(1);}
        @Override public void seekToPrevious(){advance(-1);}
        @Override public void seekToPreviousMediaItem(){advance(-1);}
        @Override public void play(){resume();}
        @Override public void pause(){wanted=false;player.pause();}
    }
    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
        return controller.getUid()==getApplicationInfo().uid||controller.isTrusted()||controller.getPackageName().equals("android") ? session : null;
    }
    JSONObject state() {
        long duration=player==null?0:player.getDuration();double fallback=track==null?0:track.optDouble("duration");
        JSONObject result=Json.obj("playing",player!=null&&player.isPlaying(),"position",player==null?0:player.getCurrentPosition()/1000.0,"duration",duration>0?duration/1000.0:fallback,"volume",player==null?0.75:player.getVolume(),"muted",player!=null&&player.getVolume()==0,"shuffle",shuffle,"repeat",repeat,"queue",queue,"queueIndex",index);
        if(track!=null)Json.put(result,"track",track);if(activity!=null)Json.put(result,"sourceActivity",activity);if(error!=null)Json.put(result,"error",error.optString("message"));return result;
    }
    JSONObject cacheStats(){return Json.obj("usedBytes",cache==null?0:cache.getCacheSpace(),"limitMiB",runtime.store.integer("cacheLimitMiB",512),"enabled",cacheEnabled);}
    JSONObject progress(){long duration=player.getDuration();return Json.obj("playing",player.isPlaying(),"position",player.getCurrentPosition()/1000.0,"duration",duration>0?duration/1000.0:track==null?0:track.optDouble("duration"));}
    void artwork(String id,String url){for(int i=0;i<queue.length();i++){JSONObject song=queue.optJSONObject(i);if(song!=null&&song.optString("id").equals(id))Json.put(song,"coverUrl",url);}if(track!=null&&track.optString("id").equals(id)){Json.put(track,"coverUrl",url);MediaItem item=player.getCurrentMediaItem();if(item!=null)player.replaceMediaItem(0,item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setArtworkUri(Uri.parse(url)).build()).build());}runtime.emit();}
    void setQueue(JSONArray tracks,int selected) throws Exception {
        JSONArray clean=new JSONArray();Set<String> ids=new HashSet<>();String selectedId=tracks.optJSONObject(selected)==null?"":tracks.getJSONObject(selected).optString("id");
        for(int i=0;i<tracks.length()&&i<1000;i++) {JSONObject value=tracks.getJSONObject(i);if(ids.add(value.getString("id")))clean.put(PrivateStore.cleanTrack(value));}
        queue=clean;index=-1;for(int i=0;i<queue.length();i++)if(queue.getJSONObject(i).optString("id").equals(selectedId))index=i;
        persist();if(index>=0)select(index);else{generation++;player.stop();track=null;wanted=false;activity=null;runtime.emit();}
    }
    void select(int at) {
        if(at<0||at>=queue.length())return;index=at;track=queue.optJSONObject(index);generation++;attempted=new HashSet<>();resolution=null;error=null;readyRecorded=false;wanted=true;player.stop();try{persist();}catch(Exception ignored){}
        if(track.optString("source").equals("local"))start(Json.obj("url",track.optString("audioUrl"),"quality","local"),generation);else resolveNext(generation);
    }
    private void resolveNext(long token) {
        if(token!=generation||track==null)return;JSONObject current=Json.copy(track);Set<String> failures=attempted;
        activity=Json.obj("phase","connecting","message","正在准备音频","startedAt",System.currentTimeMillis());runtime.emit();
        resolver.execute(() -> {
            try {
                if(token!=generation||!wanted)return;
                JSONObject cached=failures.contains("cache")?null:completeCache(current);if(cached!=null)failures.add("cache");JSONObject result=cached!=null?cached:runtime.sources.resolve(current,failures,quality,(phase,message)->main.post(() -> {if(token==generation){activity=Json.obj("phase",phase,"message",message,"startedAt",System.currentTimeMillis());runtime.emit();}}),()->token!=generation||!wanted);
                main.post(() -> {if(token==generation&&wanted)start(result,token);});
            } catch(Exception e){main.post(() -> {if(token==generation){activity=Json.obj("phase","failed","message","资源暂不可用，请更换音乐源或重试","detail",Json.message(e),"startedAt",System.currentTimeMillis());error=Json.obj("message",Json.message(e));wanted=false;runtime.emit();}});}
        });
    }
    private JSONObject completeCache(JSONObject track) {
        if(!cacheEnabled)return null;
        JSONObject mappings=runtime.store.object("cacheMappings");JSONObject saved=mappings==null?null:mappings.optJSONObject(track.optString("id"));if(saved==null)return null;String key=saved.optString("cacheKey");long length=ContentMetadata.getContentLength(cache.getContentMetadata(key));return length>0&&cache.isCached(key,0,length)?saved:null;
    }
    private void start(JSONObject result,long token) {
        if(token!=generation)return;resolution=result;http.setDefaultRequestProperties(headers(result.optJSONObject("headers")));
        MediaMetadata metadata=new MediaMetadata.Builder().setTitle(track.optString("title")).setArtist(track.optString("artist")).setAlbumTitle(track.optString("album")).setArtworkUri(track.optString("coverUrl").isEmpty()?null:Uri.parse(track.optString("coverUrl"))).build();
        MediaItem.Builder item=new MediaItem.Builder().setMediaId(track.optString("id")).setUri(result.optString("url")).setMediaMetadata(metadata);
        if(cacheEnabled&&result.has("cacheKey")&&!result.optString("url").toLowerCase(Locale.ROOT).contains(".m3u8"))item.setCustomCacheKey(result.optString("cacheKey"));
        Json.put(track,"actualQuality",result.optString("quality"));activity=Json.obj("phase","buffering","message","音频正在缓冲","startedAt",System.currentTimeMillis());
        DefaultMediaSourceFactory mediaFactory=new DefaultMediaSourceFactory(this).setDataSourceFactory(cacheEnabled?cacheFactory:new DefaultDataSource.Factory(this,http));
        player.setMediaSource(mediaFactory.createMediaSource(item.build()));player.prepare();if(wanted)player.play();runtime.emit();
        JSONObject copy=Json.copy(result);String id=track.optString("id");resolver.execute(() -> {try{JSONObject mappings=runtime.store.object("cacheMappings");if(mappings==null)mappings=new JSONObject();Json.put(mappings,id,copy);runtime.store.set("cacheMappings",mappings);}catch(Exception ignored){}});
    }
    private static Map<String,String> headers(JSONObject json){Map<String,String> values=new HashMap<>();if(json!=null)for(Iterator<String> it=json.keys();it.hasNext();){String key=it.next();if(!key.equalsIgnoreCase("Host")&&!key.equalsIgnoreCase("Content-Length"))values.put(key,json.optString(key));}return values;}
    void resume(){wanted=true;if(player.getPlaybackState()==Player.STATE_IDLE&&track!=null){generation++;attempted=new HashSet<>();if(track.optString("source").equals("local"))start(Json.obj("url",track.optString("audioUrl"),"quality","local"),generation);else resolveNext(generation);}else player.play();runtime.emit();}
    void toggle(){if(wanted){wanted=false;player.pause();if(player.getPlaybackState()==Player.STATE_IDLE){generation++;activity=null;}}else resume();runtime.emit();}
    void seek(double seconds){if(!Double.isFinite(seconds))return;player.seekTo((long)(Math.max(0,Math.min(seconds,state().optDouble("duration")))*1000));runtime.emit();}
    void advance(int direction){if(queue.length()==0)return;int at=shuffle&&queue.length()>1?new java.security.SecureRandom().nextInt(queue.length()-1):index+direction;if(shuffle&&queue.length()>1&&at>=index)at++;if(at<0)at=repeat.equals("off")?0:queue.length()-1;if(at>=queue.length()){if(repeat.equals("off")){wanted=false;player.pause();runtime.emit();return;}at=0;}select(at);}
    void mode(JSONObject args){repeat=args.optString("repeat",repeat);if(!Set.of("off","all","one").contains(repeat))repeat="all";shuffle=args.optBoolean("shuffle",shuffle);quality=args.optString("quality",quality);try{runtime.store.set("quality",quality);persist();}catch(Exception ignored){}runtime.emit();}
    void remove(String id)throws Exception {JSONArray next=new JSONArray();int old=index;for(int i=0;i<queue.length();i++)if(!queue.getJSONObject(i).optString("id").equals(id))next.put(queue.get(i));else if(i<index)index--;boolean wasCurrent=track!=null&&track.optString("id").equals(id);queue=next;if(wasCurrent){if(queue.length()>0)select(Math.min(old,queue.length()-1));else{generation++;player.stop();track=null;index=-1;wanted=false;activity=null;}}persist();runtime.emit();}
    void configureCache(JSONObject args)throws Exception {boolean changed=cacheEnabled!=args.optBoolean("enabled",cacheEnabled);cacheEnabled=args.optBoolean("enabled",cacheEnabled);runtime.store.set("cacheEnabled",cacheEnabled);int limit=Math.max(64,Math.min(4096,args.optInt("limitMiB",runtime.store.integer("cacheLimitMiB",512))));runtime.store.set("cacheLimitMiB",limit);budget.setLimit(cache,limit*1024L*1024L);if(changed&&resolution!=null&&player.getPlaybackState()!=Player.STATE_IDLE){long position=player.getCurrentPosition();start(Json.copy(resolution),generation);player.seekTo(position);}runtime.emit();}
    void clearCache() throws Exception { if(player.isPlaying()||wanted)throw new Exception("请先暂停播放再清理缓存");player.stop();for(String key:new HashSet<>(cache.getKeys()))cache.removeResource(key);runtime.store.set("cacheMappings",new JSONObject());runtime.emit();}
    private void persist() throws Exception{runtime.store.set("queue",queue);runtime.store.set("queueIndex",index);runtime.store.set("repeat",repeat);runtime.store.set("shuffle",shuffle);}
    @Override public void onTaskRemoved(Intent rootIntent){if(!wanted&&!isPlaybackOngoing())stopSelf();}
    @Override public void onDestroy(){generation++;resolver.shutdownNow();runtime.detach(this);if(session!=null)session.release();if(player!=null)player.release();if(cache!=null)cache.release();super.onDestroy();}
}
