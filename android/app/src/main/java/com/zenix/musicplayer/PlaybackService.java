package com.zenix.musicplayer;

import android.app.PendingIntent;
import android.content.Intent;
import android.net.Uri;
import android.os.*;
import androidx.media3.common.*;
import androidx.media3.database.StandaloneDatabaseProvider;
import androidx.media3.datasource.*;
import androidx.media3.datasource.cache.*;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
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
    private DataSource.Factory http;
    private Future<?> resolutionTask;
    private long resumePosition;
    private final Deque<String> shuffleDeck=new ArrayDeque<>();
    private final List<String> shuffleHistory=new ArrayList<>();private int shufflePosition=-1;
    private CacheDataSource.Factory cacheFactory;
    private CacheBudget budget;
    private RoamingController roaming;private volatile boolean clearingCache;private volatile long cacheEpoch;
    @Override public void onCreate() {
        super.onCreate();runtime=ZenixRuntime.get(this);JSONObject saved=runtime.store.readKeys("queue","queueIndex","repeat","shuffle","quality","cacheEnabled","cacheLimitMiB");queue=saved.optJSONArray("queue");if(queue==null)queue=new JSONArray();index=Math.min(saved.optInt("queueIndex",-1),queue.length()-1);if(index>=0)track=queue.optJSONObject(index);repeat=saved.optString("repeat","all");shuffle=saved.optBoolean("shuffle");quality=saved.optString("quality","high");cacheEnabled=saved.optBoolean("cacheEnabled",true);
        resetShuffle();if(track!=null)rememberShuffle(track.optString("id"));
        budget=new CacheBudget(saved.optLong("cacheLimitMiB",512)*1024*1024);
        cache=new SimpleCache(new File(getCacheDir(),"audio"),budget,new StandaloneDatabaseProvider(this));
        resolver.execute(()->{try{pruneCacheMappings(null,null);}catch(Exception ignored){}});
        http=new OkHttpDataSource.Factory(SourceHttp.client(null,10000)).setUserAgent("Zenix Android");
        cacheFactory=new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(http).setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
        // Audio-only streaming: bound allocator growth; disk cache is independent.
        DefaultLoadControl loadControl=new DefaultLoadControl.Builder().setBufferDurationsMs(10000,30000,1000,2500).setTargetBufferBytes(4*1024*1024).setPrioritizeTimeOverSizeThresholds(false).setBackBuffer(0,false).build();
        player=new ExoPlayer.Builder(this).setLoadControl(loadControl).setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(cacheFactory)).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),true);player.setHandleAudioBecomingNoisy(true);player.setWakeMode(C.WAKE_MODE_LOCAL);
        player.addListener(new Player.Listener() {
            @Override public void onPlaybackStateChanged(int state) {
                if(state==Player.STATE_READY) { resumePosition=0;activity=null;error=null;if(roaming!=null&&wanted)roaming.ready(track);if(!readyRecorded&&wanted&&track!=null){readyRecorded=true;JSONObject value=Json.copy(track);resolver.execute(() -> {try{runtime.store.personal("record",Json.obj("track",value));runtime.emit();}catch(Exception ignored){}});} }
                else if(state==Player.STATE_BUFFERING)activity=Json.obj("phase","buffering","message","音频正在缓冲","startedAt",System.currentTimeMillis());
                else if(state==Player.STATE_ENDED) { if(roaming!=null&&roaming.isActive())roaming.next(true);else if(repeat.equals("one")){player.seekTo(0);player.play();}else advance(1); }
                runtime.emit();
            }
            @Override public void onIsPlayingChanged(boolean playing) {if(roaming!=null)roaming.playingChanged(playing);runtime.emit();}
            @Override public void onPlayerError(PlaybackException failure) {
                if(track!=null&&!track.optString("source").equals("local")&&wanted){if(player.getCurrentPosition()>0)resumePosition=player.getCurrentPosition();resolveNext(generation);}
                else {activity=null;error=Json.obj("message","无法播放此音频，请重新导入文件");runtime.emit();}
            }
        });
        Intent intent=new Intent(this,MainActivity.class);intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent launch=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        session=new MediaSession.Builder(this,new QueuePlayer(player)).setSessionActivity(launch).build();roaming=new RoamingController(runtime,this);runtime.attach(this);runtime.emit();
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
        @Override public void pause(){if(roaming!=null)roaming.userPause();wanted=false;player.pause();if(player.getPlaybackState()==Player.STATE_IDLE){generation++;cancelResolution();activity=null;}runtime.emit();}
    }
    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
        return controller.getUid()==getApplicationInfo().uid||controller.isTrusted()||controller.getPackageName().equals("android") ? session : null;
    }
    JSONObject state() {
        long duration=player==null?0:player.getDuration();double fallback=track==null?0:track.optDouble("duration");
        JSONObject result=Json.obj("playing",player!=null&&player.isPlaying(),"position",player==null?0:player.getCurrentPosition()/1000.0,"duration",duration>0?duration/1000.0:fallback,"volume",player==null?0.75:player.getVolume(),"muted",player!=null&&player.getVolume()==0,"shuffle",shuffle,"repeat",repeat,"queue",queue,"queueIndex",index);
        if(track!=null)Json.put(result,"track",track);if(activity!=null)Json.put(result,"sourceActivity",activity);if(error!=null)Json.put(result,"error",error.optString("message"));return result;
    }
    JSONObject cacheStats(){return Json.obj("usedBytes",cache==null?0:cache.getCacheSpace(),"limitMiB",runtime.store.integer("cacheLimitMiB",512),"enabled",cacheEnabled,"metadataBytes",runtime.sources.metadataBytes(),"metadataLimitMiB",runtime.sources.metadataLimit()/1024/1024);}
    JSONObject progress(){long duration=player.getDuration();return Json.obj("playing",player.isPlaying(),"position",player.getCurrentPosition()/1000.0,"duration",duration>0?duration/1000.0:track==null?0:track.optDouble("duration"));}
    void artwork(String id,String url){for(int i=0;i<queue.length();i++){JSONObject song=queue.optJSONObject(i);if(song!=null&&song.optString("id").equals(id))Json.put(song,"coverUrl",url);}if(track!=null&&track.optString("id").equals(id)){Json.put(track,"coverUrl",url);MediaItem item=player.getCurrentMediaItem();Uri art=url.startsWith("/")?Uri.fromFile(new File(url)):Uri.parse(url);if(item!=null)player.replaceMediaItem(0,item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setArtworkUri(art).build()).build());}runtime.emit();}
    void setQueue(JSONArray tracks,int selected) throws Exception {
        if(clearingCache)throw new Exception("缓存正在清理，请稍后播放");
        if(roaming!=null)roaming.normalQueue();
        JSONArray clean=new JSONArray();Set<String> ids=new HashSet<>();String selectedId=tracks.optJSONObject(selected)==null?"":tracks.getJSONObject(selected).optString("id");
        for(int i=0;i<tracks.length()&&i<1000;i++) {JSONObject value=tracks.getJSONObject(i);if(ids.add(value.getString("id")))clean.put(PrivateStore.cleanTrack(value));}
        queue=clean;index=-1;for(int i=0;i<queue.length();i++)if(queue.getJSONObject(i).optString("id").equals(selectedId))index=i;resetShuffle();
        persist();if(index>=0)select(index);else{generation++;cancelResolution();player.stop();track=null;wanted=false;activity=null;runtime.emit();}
    }
    void select(int at) {
        if(clearingCache||at<0||at>=queue.length())return;generation++;cancelResolution();if(roaming!=null)roaming.selected(queue.optJSONObject(at));index=at;track=queue.optJSONObject(index);resumePosition=0;attempted=new HashSet<>();resolution=null;error=null;readyRecorded=false;wanted=true;player.stop();rememberShuffle(track.optString("id"));try{persist();}catch(Exception ignored){}
        if(track.optString("source").equals("local"))start(Json.obj("url",track.optString("audioUrl"),"quality","local"),generation);else resolveNext(generation);
    }
    private void resolveNext(long token) {
        if(token!=generation||track==null)return;JSONObject current=Json.copy(track);Set<String> failures=attempted;
        activity=Json.obj("phase","connecting","message","正在准备音频","startedAt",System.currentTimeMillis());runtime.emit();
        final String requestedQuality=quality;
        resolutionTask=resolver.submit(() -> {
            try {
                if(token!=generation||!wanted)return;
                JSONObject cached=failures.contains("cache")?null:completeCache(current);if(cached!=null)failures.add("cache");JSONObject result=cached!=null?cached:runtime.sources.resolve(current,failures,requestedQuality,(phase,message)->main.post(() -> {if(token==generation){activity=Json.obj("phase",phase,"message",message,"startedAt",System.currentTimeMillis());runtime.emit();}}),()->token!=generation||!wanted||Thread.currentThread().isInterrupted());
                main.post(() -> {if(token==generation&&wanted)start(result,token);});
            } catch(Exception e){main.post(() -> {if(token==generation&&wanted){activity=Json.obj("phase","failed","message","资源暂不可用，请更换音乐源或重试","detail",Json.message(e),"startedAt",System.currentTimeMillis());error=Json.obj("message",Json.message(e));wanted=false;if(roaming!=null&&roaming.isActive())roaming.failed();runtime.emit();}});}
        });
    }
    private JSONObject completeCache(JSONObject track) {
        if(!cacheEnabled)return null;
        JSONObject mappings=runtime.store.object("cacheMappings");JSONObject saved=mappings==null?null:mappings.optJSONObject(track.optString("id"));if(saved==null)return null;String key=saved.optString("cacheKey");long length=ContentMetadata.getContentLength(cache.getContentMetadata(key));if(length<=0||!cache.isCached(key,0,length))return null;Json.put(saved,"mediaHosts",new JSONArray());Json.put(saved,"allowHttp",false);return saved;
    }
    private void start(JSONObject result,long token) {
        if(token!=generation)return;resolution=result;http=new OkHttpDataSource.Factory(SourceHttp.client(result.optJSONArray("mediaHosts"),10000,result.optBoolean("allowHttp"))).setUserAgent("Zenix Android").setDefaultRequestProperties(headers(result.optJSONObject("headers")));cacheFactory.setUpstreamDataSourceFactory(http);
        String cover=track.optString("source").equals("local")?track.optString("coverUrl"):runtime.sources.cachedArtwork(track);
        MediaMetadata metadata=new MediaMetadata.Builder().setTitle(track.optString("title")).setArtist(track.optString("artist")).setAlbumTitle(track.optString("album")).setArtworkUri(cover.isEmpty()?null:cover.startsWith("/")?Uri.fromFile(new File(cover)):Uri.parse(cover)).build();
        MediaItem.Builder item=new MediaItem.Builder().setMediaId(track.optString("id")).setUri(result.optString("url")).setMediaMetadata(metadata);
        if(cacheEnabled&&result.has("cacheKey")&&!result.optString("url").toLowerCase(Locale.ROOT).contains(".m3u8"))item.setCustomCacheKey(result.optString("cacheKey"));
        Json.put(track,"actualQuality",result.optString("quality"));activity=Json.obj("phase","buffering","message","音频正在缓冲","startedAt",System.currentTimeMillis());
        DataSource.Factory dataSource=track.optString("source").equals("local")?new DefaultDataSource.Factory(this,http):cacheEnabled?cacheFactory:http;
        DefaultMediaSourceFactory mediaFactory=new DefaultMediaSourceFactory(this).setDataSourceFactory(dataSource);
        player.setMediaSource(mediaFactory.createMediaSource(item.build()));if(resumePosition>0)player.seekTo(resumePosition);player.prepare();if(wanted)player.play();runtime.emit();
        if(cacheEnabled&&result.has("cacheKey")&&!track.optString("source").equals("local")&&!result.optString("url").toLowerCase(Locale.ROOT).contains(".m3u8")){
            JSONObject copy=Json.copy(result);String id=track.optString("id");long epoch=cacheEpoch;Json.put(copy,"cachedAt",System.currentTimeMillis());
            resolver.execute(() -> {try{synchronized(this){if(epoch==cacheEpoch&&!clearingCache)pruneCacheMappings(id,copy);}}catch(Exception ignored){}});
        }
    }
    // The audio cache evicts files independently. Never retain an ever-growing
    // JSON index (including old signed URLs/headers) for already evicted audio.
    private synchronized void pruneCacheMappings(String id,JSONObject latest)throws Exception {
        if(clearingCache)return;
        JSONObject old=runtime.store.object("cacheMappings");if(old==null)old=new JSONObject();
        Set<String> keys=new HashSet<>(cache.getKeys());List<String> ids=new ArrayList<>();
        for(Iterator<String> it=old.keys();it.hasNext();){String candidate=it.next();JSONObject value=old.optJSONObject(candidate);if(value!=null&&keys.contains(value.optString("cacheKey"))&&!candidate.equals(id))ids.add(candidate);}
        JSONObject values=old;ids.sort((a,b)->Long.compare(values.optJSONObject(b).optLong("cachedAt"),values.optJSONObject(a).optLong("cachedAt")));
        JSONObject next=new JSONObject();if(id!=null&&latest!=null)Json.put(next,id,latest);
        for(String candidate:ids){if(next.length()>=300)break;Json.put(next,candidate,old.optJSONObject(candidate));}
        runtime.store.set("cacheMappings",next);
    }
    private static Map<String,String> headers(JSONObject json){Map<String,String> values=new HashMap<>();if(json!=null)for(Iterator<String> it=json.keys();it.hasNext();){String key=it.next();if(!key.equalsIgnoreCase("Host")&&!key.equalsIgnoreCase("Content-Length"))values.put(key,json.optString(key));}return values;}
    void resume(){if(clearingCache)return;if(roaming!=null&&roaming.needsRetry()){roaming.retry();return;}if(roaming!=null)roaming.userResume();wanted=true;if(player.getPlaybackState()==Player.STATE_IDLE&&track!=null){generation++;cancelResolution();attempted=new HashSet<>();if(track.optString("source").equals("local"))start(Json.obj("url",track.optString("audioUrl"),"quality","local"),generation);else resolveNext(generation);}else player.play();runtime.emit();}
    void toggle(){if(wanted||roaming!=null&&roaming.pending()){if(roaming!=null)roaming.userPause();wanted=false;player.pause();if(player.getPlaybackState()==Player.STATE_IDLE){generation++;cancelResolution();activity=null;}}else resume();runtime.emit();}
    void seek(double seconds){if(!Double.isFinite(seconds))return;resumePosition=0;player.seekTo((long)(Math.max(0,Math.min(seconds,state().optDouble("duration")))*1000));runtime.emit();}
    void advance(int direction){if(roaming!=null&&roaming.isActive()){if(direction>0)roaming.next(false);return;}if(queue.length()==0)return;int at=index+direction;
        if(shuffle){String id=null;if(direction<0){if(shufflePosition>0)id=shuffleHistory.get(--shufflePosition);else return;}else if(shufflePosition+1<shuffleHistory.size())id=shuffleHistory.get(++shufflePosition);else{if(shuffleDeck.isEmpty()){if(repeat.equals("off")){wanted=false;player.pause();runtime.emit();return;}refillShuffle();}id=shuffleDeck.pollFirst();}at=findIndex(id);if(at<0){advance(direction);return;}}
        if(at<0)at=repeat.equals("off")?0:queue.length()-1;if(at>=queue.length()){if(repeat.equals("off")){wanted=false;player.pause();runtime.emit();return;}at=0;}select(at);}
    private int findIndex(String id){for(int i=0;i<queue.length();i++)if(queue.optJSONObject(i).optString("id").equals(id))return i;return -1;}
    private void refillShuffle(){List<String> ids=new ArrayList<>();for(int i=0;i<queue.length();i++){String id=queue.optJSONObject(i).optString("id");if(i!=index)ids.add(id);}if(ids.isEmpty()&&index>=0)ids.add(queue.optJSONObject(index).optString("id"));Collections.shuffle(ids);shuffleDeck.clear();shuffleDeck.addAll(ids);}
    private void resetShuffle(){shuffleHistory.clear();shufflePosition=-1;refillShuffle();}
    private void rememberShuffle(String id){shuffleDeck.remove(id);if(shufflePosition>=0&&shuffleHistory.get(shufflePosition).equals(id))return;while(shuffleHistory.size()>shufflePosition+1)shuffleHistory.remove(shuffleHistory.size()-1);shuffleHistory.add(id);if(shuffleHistory.size()>300)shuffleHistory.remove(0);shufflePosition=shuffleHistory.size()-1;}
    private void cancelResolution(){if(resolutionTask!=null&&!resolutionTask.isDone()){resolutionTask.cancel(true);runtime.sources.cancelPlayback();}resolutionTask=null;}
    void mode(JSONObject args){repeat=args.optString("repeat",repeat);if(!Set.of("off","all","one").contains(repeat))repeat="all";boolean oldShuffle=shuffle;shuffle=args.optBoolean("shuffle",shuffle);if(oldShuffle!=shuffle){resetShuffle();if(track!=null)rememberShuffle(track.optString("id"));}quality=args.optString("quality",quality);try{persist();}catch(Exception ignored){}runtime.emit();}
    void remove(String id)throws Exception {if(roaming!=null&&roaming.isActive()){if(track!=null&&track.optString("id").equals(id))roaming.next(false);return;}JSONArray next=new JSONArray();int old=index;for(int i=0;i<queue.length();i++)if(!queue.getJSONObject(i).optString("id").equals(id))next.put(queue.get(i));else if(i<index)index--;boolean wasCurrent=track!=null&&track.optString("id").equals(id);queue=next;shuffleDeck.remove(id);if(wasCurrent){if(queue.length()>0)select(Math.min(old,queue.length()-1));else{generation++;cancelResolution();player.stop();track=null;index=-1;wanted=false;activity=null;}}persist();runtime.emit();}
    void configureCache(JSONObject args)throws Exception {boolean changed=cacheEnabled!=args.optBoolean("enabled",cacheEnabled);cacheEnabled=args.optBoolean("enabled",cacheEnabled);int limit=Math.max(64,Math.min(4096,args.optInt("limitMiB",runtime.store.integer("cacheLimitMiB",512))));runtime.store.enqueue(Json.obj("cacheEnabled",cacheEnabled,"cacheLimitMiB",limit));runtime.work.execute(()->{budget.setLimit(cache,limit*1024L*1024L);runtime.sources.pruneMetadata();resolver.execute(()->{try{pruneCacheMappings(null,null);}catch(Exception ignored){}});runtime.emit();});if(changed&&resolution!=null&&player.getPlaybackState()!=Player.STATE_IDLE){long position=player.getCurrentPosition();start(Json.copy(resolution),generation);player.seekTo(position);}runtime.emit();}
    void clearCache(java.util.function.Consumer<Exception> completed)throws Exception {
        if(clearingCache||player.isPlaying()||wanted)throw new Exception("请先暂停播放再清理缓存");
        clearingCache=true;cacheEpoch++;generation++;cancelResolution();player.stop();activity=null;runtime.emit();
        runtime.work.execute(()->{Exception failure=null;try{for(String key:new HashSet<>(cache.getKeys()))cache.removeResource(key);runtime.sources.clearMetadata();synchronized(this){runtime.store.set("cacheMappings",new JSONObject());}}catch(Exception error){failure=error;}Exception result=failure;main.post(()->{clearingCache=false;completed.accept(result);runtime.emit();});});
    }
    JSONObject roamingState(){return roaming==null?Json.obj("active",false,"phase","idle","message","","discovered",0,"tracks",new JSONArray()):roaming.snapshot();}
    void roamingCommand(String command,JSONObject args)throws Exception{switch(command){case "roamingStart":roaming.start();break;case "roamingStop":roaming.stop();break;case "roamingRetry":roaming.retry();break;case "roamingPlay":roaming.play(args.getString("id"));break;}}
    boolean isActuallyPlaying(){return player!=null&&player.isPlaying();}
    double currentDuration(){long duration=player==null?0:player.getDuration();return duration>0?duration/1000.0:track==null?0:track.optDouble("duration");}
    void waitForRoaming(){generation++;cancelResolution();wanted=false;activity=null;error=null;player.stop();runtime.emit();}
    void playRoaming(JSONObject song){queue=Json.array(PrivateStore.cleanTrack(song));repeat="off";shuffle=false;select(0);}
    void leaveRoaming(){generation++;attempted=new HashSet<>();queue=track==null?new JSONArray():Json.array(PrivateStore.cleanTrack(track));index=track==null?-1:0;repeat="off";try{persist();}catch(Exception ignored){}if(wanted&&track!=null&&player.getPlaybackState()==Player.STATE_IDLE)resolveNext(generation);}
    private void persist() throws Exception{runtime.store.enqueue(Json.obj("queue",queue,"queueIndex",index,"repeat",repeat,"shuffle",shuffle,"quality",quality));}
    @Override public void onTaskRemoved(Intent rootIntent){if(!wanted&&!isPlaybackOngoing())stopSelf();}
    @Override public void onDestroy(){if(roaming!=null)roaming.close();generation++;cancelResolution();resolver.shutdownNow();runtime.detach(this);if(session!=null)session.release();if(player!=null)player.release();if(cache!=null)cache.release();super.onDestroy();}
}
