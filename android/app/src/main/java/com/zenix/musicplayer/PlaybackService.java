package com.zenix.musicplayer;

import android.app.PendingIntent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.ServiceInfo;
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
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import androidx.media3.session.*;
import org.json.*;
import java.io.File;
import java.util.*;
import java.util.concurrent.*;

/** The service owns queue/decoder/cache and survives Activity/WebView suspension. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
public final class PlaybackService extends MediaSessionService {
    private final String notificationNonce=java.util.UUID.randomUUID().toString();
    private final MusicEqualizer equalizer=new MusicEqualizer();private boolean equalizerApplied;private String equalizerError="";
    private ExoPlayer player; private MediaSession session; private SimpleCache cache;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService resolver=Executors.newSingleThreadExecutor();
    private ZenixRuntime runtime; private JSONArray queue=new JSONArray(); private int index=-1;
    private JSONObject track,activity,error; private String repeat="all",quality="high";private boolean shuffle,readyRecorded,cacheEnabled=true;private volatile long generation;private volatile boolean wanted;
    private Set<String> attempted=new HashSet<>();private JSONObject resolution;
    private final Set<String> skippedReplacements=new HashSet<>();
    private DataSource.Factory http;
    private Future<?> resolutionTask;
    private boolean loadingForeground;
    private PowerManager.WakeLock sourceWake;
    private boolean playbackEstablished;
    private long resumePosition;
    private double practiceStart=-1,practiceEnd=-1;
    private String practiceTrack="",previewError="";
    private ExoPlayer previewPlayer;private Future<?> previewTask;private long previewOwner=-1;private boolean previewResume;
    private final Runnable practiceTick=new Runnable(){@Override public void run(){if(player!=null&&practiceStart>=0&&track!=null&&practiceTrack.equals(track.optString("id"))&&player.isPlaying()&&player.getCurrentPosition()>=practiceEnd*1000)player.seekTo((long)(practiceStart*1000));if(previewPlayer!=null&&previewPlayer.isPlaying()&&previewPlayer.getCurrentPosition()>=previewEnd)stopPreview(true);schedulePracticeTick();}};
    private long previewEnd;
    private boolean practiceTickNeeded(){return player!=null&&practiceStart>=0&&player.isPlaying()||previewPlayer!=null&&previewPlayer.isPlaying();}
    private void schedulePracticeTick(){main.removeCallbacks(practiceTick);if(practiceTickNeeded())main.postDelayed(practiceTick,100);}
    private final Deque<String> shuffleDeck=new ArrayDeque<>();
    private final List<String> shuffleHistory=new ArrayList<>();private int shufflePosition=-1;
    private CacheDataSource.Factory cacheFactory;
    private CacheBudget budget;
    private RoamingController roaming;private volatile boolean clearingCache;private volatile long cacheEpoch;
    private long sleepEndsAt,listenClock;private boolean listening,countedPlay;private double listenSeconds,pendingSeconds;private JSONObject listenedTrack;
    private final Runnable listeningTick=new Runnable(){@Override public void run(){accountListening();checkSleepTimer();main.postDelayed(this,1000);}};
    @Override public void onCreate() {
        super.onCreate();runtime=ZenixRuntime.get(this);JSONObject saved=runtime.store.readKeys("queue","queueIndex","repeat","shuffle","quality","cacheEnabled","cacheLimitMiB");queue=saved.optJSONArray("queue");if(queue==null)queue=new JSONArray();index=Math.min(saved.optInt("queueIndex",-1),queue.length()-1);if(index>=0)track=queue.optJSONObject(index);repeat=saved.optString("repeat","all");shuffle=saved.optBoolean("shuffle");quality=saved.optString("quality","high");cacheEnabled=saved.optBoolean("cacheEnabled",true);
        sourceWake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"Zenix:SourceResolve");sourceWake.setReferenceCounted(false);
        if(Build.VERSION.SDK_INT>=26){NotificationChannel channel=new NotificationChannel("zenix-playback","音乐播放",NotificationManager.IMPORTANCE_LOW);channel.setSound(null,null);((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);}
        DefaultMediaNotificationProvider notifications=new DefaultMediaNotificationProvider.Builder(this).setNotificationId(2101).setChannelId("zenix-playback").build();notifications.setSmallIcon(R.drawable.zenix_icon);setMediaNotificationProvider(notifications);
        resetShuffle();if(track!=null)rememberShuffle(track.optString("id"));
        budget=new CacheBudget(saved.optLong("cacheLimitMiB",512)*1024*1024,key->NetworkPreferences.pinned(runtime.store,key));
        cache=new SimpleCache(new File(getCacheDir(),"audio"),budget,new StandaloneDatabaseProvider(this));
        resolver.execute(()->{try{pruneCacheMappings(null,null);}catch(Exception ignored){}});
        http=new OkHttpDataSource.Factory(SourceHttp.client(null,10000)).setUserAgent("Zenix Android");
        cacheFactory=new CacheDataSource.Factory().setCache(cache).setUpstreamDataSourceFactory(http).setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
        // Audio-only streaming: bound allocator growth; disk cache is independent.
        DefaultLoadControl loadControl=new DefaultLoadControl.Builder().setBufferDurationsMs(10000,30000,1000,2500).setTargetBufferBytes(4*1024*1024).setPrioritizeTimeOverSizeThresholds(false).setBackBuffer(0,false).build();
        player=new ExoPlayer.Builder(this).setLoadControl(loadControl).setMediaSourceFactory(new DefaultMediaSourceFactory(this).setDataSourceFactory(cacheFactory)).build();
        player.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),true);player.setHandleAudioBecomingNoisy(true);player.setWakeMode(C.WAKE_MODE_LOCAL);
        player.addListener(new Player.Listener() {
            @Override public void onAudioSessionIdChanged(int id){try{equalizerApplied=equalizer.apply(id,runtime.store.object("audioSettings"));equalizerError="";}catch(Exception failure){equalizerError="此设备无法应用均衡器："+Json.message(failure);equalizerApplied=false;}runtime.emit();}
            @Override public void onPlaybackStateChanged(int state) {
                if(state==Player.STATE_ENDED&&practiceStart>=0&&track!=null&&practiceTrack.equals(track.optString("id"))){player.seekTo((long)(practiceStart*1000));if(wanted)player.play();return;}
                if(state==Player.STATE_READY) {finishLoading();resumePosition=0;activity=null;error=null;if(roaming!=null&&wanted)roaming.ready(track);if(!readyRecorded&&wanted&&track!=null){readyRecorded=true;JSONObject value=Json.copy(track);resolver.execute(() -> {try{runtime.store.personal("record",Json.obj("track",value));runtime.emit();}catch(Exception ignored){}});} }
                else if(state==Player.STATE_BUFFERING){activity=Json.obj("phase","buffering","message",resolution!=null&&resolution.optString("cacheHit").equals("complete")?"正在读取本地音频缓存":"音频正在缓冲"+(resolution==null?"":" · "+resolution.optString("providerName")),"startedAt",activityStartedAt());if(wanted){beginRecovery();beginLoading();}}
                else if(state==Player.STATE_ENDED) {accountListening();flushListening(false);if(roaming!=null&&roaming.isActive())roaming.next(true);else if(repeat.equals("one")){listenSeconds=0;countedPlay=false;if(resolution!=null&&!resolution.optString("cacheHit").equals("complete")&&cacheStatus().equals("complete")){JSONObject local=Json.copy(resolution);Json.put(local,"cacheHit","complete");start(local,generation);}else{player.seekTo(0);player.play();}}else advance(1); }
                runtime.emit();
            }
            @Override public void onIsPlayingChanged(boolean playing) {schedulePracticeTick();if(playing){skippedReplacements.clear();playbackEstablished=true;finishLoading();runtime.sources.playbackReady(track,resolution);if(resolution!=null&&resolution.has("replacementKey")){JSONObject selected=Json.copy(track);String key=resolution.optString("replacementKey");resolver.execute(()->{try{new PlaylistReplacement(runtime.store,runtime.sources).played(selected,key);runtime.emit();}catch(Exception ignored){}});}}accountListening();listening=playing;listenClock=SystemClock.elapsedRealtime();if(!playing)flushListening(false);if(roaming!=null)roaming.playingChanged(playing);MusicWidget.updateAll(PlaybackService.this);runtime.emit();}
            @Override public void onPlayerError(PlaybackException failure) {
                if(!wanted)return;
                if(track!=null&&!track.optString("source").equals("local")&&wanted){runtime.sources.playbackFailed(resolution,failure.errorCode>=2000&&failure.errorCode<3000);if(player.getCurrentPosition()>0)resumePosition=player.getCurrentPosition();discardFailedCache();beginRecovery();resolveNext(generation);}
                else {finishLoading();activity=null;error=Json.obj("message","无法播放此音频，请重新导入文件");runtime.emit();}
            }
        });
        Intent intent=new Intent(this,MainActivity.class);intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent launch=PendingIntent.getActivity(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        session=new MediaSession.Builder(this,new QueuePlayer(player)).setSessionActivity(launch).build();roaming=new RoamingController(runtime,this);runtime.attach(this);runtime.emit();
        sleepEndsAt=runtime.store.readKeys("sleepEndsAt").optLong("sleepEndsAt");listenClock=SystemClock.elapsedRealtime();main.post(listeningTick);MusicWidget.updateAll(this);
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
        @Override public void pause(){if(roaming!=null)roaming.userPause();pausePlayback();runtime.emit();}
    }
    @Override public MediaSession onGetSession(MediaSession.ControllerInfo controller) {
        return controller.getUid()==getApplicationInfo().uid||controller.isTrusted()||controller.getPackageName().equals("android") ? session : null;
    }
    JSONObject state() {
        long duration=player==null?0:player.getDuration();double fallback=track==null?0:track.optDouble("duration");
        JSONObject result=Json.obj("audioSettings",audioSettings(),"playing",player!=null&&player.isPlaying(),"playWhenReady",wanted,"quality",quality,"cacheStatus",cacheStatus(),"position",player==null?0:player.getMediaItemCount()==0?resumePosition/1000.0:player.getCurrentPosition()/1000.0,"duration",duration>0?duration/1000.0:fallback,"volume",player==null?0.75:player.getVolume(),"muted",player!=null&&player.getVolume()==0,"shuffle",shuffle,"repeat",repeat,"queue",queue,"queueIndex",index,"selectionRevision",generation);
        if(track!=null)Json.put(result,"track",track);if(activity!=null)Json.put(result,"sourceActivity",activity);if(error!=null)Json.put(result,"error",error.optString("message"));return result;
    }
    JSONObject cacheStats(){return Json.obj("usedBytes",cache==null?0:cache.getCacheSpace(),"limitMiB",runtime.store.integer("cacheLimitMiB",512),"enabled",cacheEnabled,"metadataBytes",runtime.sources.metadataBytes(),"metadataLimitMiB",runtime.sources.metadataLimit()/1024/1024);}
    JSONObject progress(){long duration=player.getDuration();return Json.obj("playing",player.isPlaying(),"playWhenReady",wanted,"quality",quality,"cacheStatus",cacheStatus(),"position",player.getMediaItemCount()==0?resumePosition/1000.0:player.getCurrentPosition()/1000.0,"duration",duration>0?duration/1000.0:track==null?0:track.optDouble("duration"));}
    void artwork(String id,String url){boolean currentChanged=track!=null&&track.optString("id").equals(id)&&!track.optString("coverUrl").equals(url),changed=currentChanged;for(int i=0;i<queue.length();i++){JSONObject song=queue.optJSONObject(i);if(song!=null&&song.optString("id").equals(id)&&!song.optString("coverUrl").equals(url)){Json.put(song,"coverUrl",url);changed=true;}}if(currentChanged){Json.put(track,"coverUrl",url);MediaItem item=player.getCurrentMediaItem();Uri art=url.startsWith("/")?Uri.fromFile(new File(url)):Uri.parse(url);if(item!=null)player.replaceMediaItem(0,item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setArtworkUri(art).build()).build());}if(changed)runtime.emit();}
    void editQueue(JSONObject args)throws Exception {
        if(clearingCache)throw new Exception("缓存正在清理");
        if(roaming!=null&&roaming.isActive())throw new Exception("请先结束音乐漫游，再整理普通队列");
        JSONArray next=QueueEdits.apply(queue,track==null?"":track.optString("id"),args);
        if(next==queue)return;
        String current=track==null?"":track.optString("id");int oldIndex=index;queue=next;index=findIndex(current);
        resetShuffle();if(index>=0)rememberShuffle(current);persist();
        if(track!=null&&index<0){if(queue.length()>0)select(Math.max(0,Math.min(oldIndex,queue.length()-1)),wanted);else{generation++;cancelResolution();wanted=false;track=null;player.stop();player.clearMediaItems();activity=null;}}
        runtime.emit();MusicWidget.updateAll(this);
    }
    void setQueue(JSONArray tracks,int selected) throws Exception {setQueue(tracks,selected,true);}
    void prepareHandoff(JSONObject args)throws Exception{double seconds=args.optDouble("seconds");JSONArray tracks=args.getJSONArray("tracks");int at=args.optInt("index",-1);if(!Double.isFinite(seconds)||seconds<0||seconds>86400||at<0||at>=tracks.length())throw new Exception("接力位置或歌曲无效");setQueue(tracks,at,false);resumePosition=(long)(seconds*1000);persist();runtime.emit();}
    private void setQueue(JSONArray tracks,int selected,boolean autoPlay) throws Exception {
        stopPreview(false);
        skippedReplacements.clear();
        if(clearingCache)throw new Exception("缓存正在清理，请稍后播放");
        if(tracks.optJSONObject(selected)!=null&&tracks.optJSONObject(selected).optString("availability").equals("unavailable"))throw new Exception("这是对方的本地歌曲，请先导入同名、同歌手的音频，再重新导入歌单");
        if(roaming!=null)roaming.normalQueue();
        JSONArray clean=new JSONArray();Set<String> ids=new HashSet<>();String selectedId=tracks.optJSONObject(selected)==null?"":tracks.getJSONObject(selected).optString("id");
        for(int i=0;i<tracks.length()&&i<1000;i++) {JSONObject value=tracks.getJSONObject(i);if(ids.add(value.getString("id")))clean.put(PrivateStore.queueTrack(value));}
        queue=clean;index=-1;for(int i=0;i<queue.length();i++)if(queue.getJSONObject(i).optString("id").equals(selectedId))index=i;resetShuffle();
        persist();if(index>=0)select(index,autoPlay);else{generation++;cancelResolution();player.stop();track=null;wanted=false;activity=null;runtime.emit();}
    }
    void select(int at) {
        select(at,true);
    }
    void refreshReplacementPolicy(JSONObject args){
        if(track==null||generation!=args.optLong("selectionRevision",-1)||!track.optString("id").equals(args.optString("trackId"))||!track.optString("playlistId").equals(args.optString("id")))return;
        if(wanted&&activity!=null&&!activity.optString("phase").equals("failed")||args.optBoolean("enabled")&&error!=null)select(index);
    }
    private void select(int at,boolean autoPlay) {
        stopPreview(false);practiceStart=-1;practiceEnd=-1;practiceTrack="";player.setPlaybackSpeed(1);
        if(at>=0&&at<queue.length()&&queue.optJSONObject(at).optString("availability").equals("unavailable")){accountListening();flushListening(false);generation++;cancelResolution();wanted=false;player.stop();index=at;track=queue.optJSONObject(at);error=Json.obj("message","这是对方的本地歌曲，请先导入同名、同歌手的音频，再重新导入歌单");activity=null;runtime.emit();MusicWidget.updateAll(this);return;}
        if(at>=0&&at<queue.length()){accountListening();flushListening(false);listenSeconds=0;countedPlay=false;listenedTrack=Json.copy(queue.optJSONObject(at));listenClock=SystemClock.elapsedRealtime();}
        if(clearingCache||at<0||at>=queue.length())return;generation++;cancelResolution();if(roaming!=null)roaming.selected(queue.optJSONObject(at));index=at;track=queue.optJSONObject(index);resumePosition=0;attempted=new HashSet<>();resolution=null;error=null;activity=null;readyRecorded=false;wanted=autoPlay;player.stop();rememberShuffle(track.optString("id"));try{persist();}catch(Exception ignored){}
        // Loading notifications use track metadata; the decoder waits for a real URI.
        player.clearMediaItems();
        if(!autoPlay){runtime.emit();MusicWidget.updateAll(this);return;}
        playbackEstablished=false;
        if(track.optString("source").equals("local"))start(Json.obj("url",track.optString("audioUrl"),"quality","local"),generation);else resolveNext(generation);
    }
    private long activityStartedAt(){return activity==null||activity.optString("phase").equals("failed")?System.currentTimeMillis():activity.optLong("startedAt",System.currentTimeMillis());}
    private void beginRecovery(){if(playbackEstablished){attempted=new HashSet<>();attempted.add("cache");playbackEstablished=false;}}
    private void discardFailedCache(){
        if(resolution==null||resolution.optString("cacheKey").isEmpty()||!resolution.optString("cacheHit").equals("complete")&&!cacheStatus().equals("complete"))return;
        String key=resolution.optString("cacheKey");long token=generation;
        resolver.execute(()->{if(token==generation&&!clearingCache)try{cache.removeResource(key);}catch(Exception ignored){}});
    }
    private void resolveNext(long token) {
        if(token!=generation||track==null)return;JSONObject current=Json.copy(track);Set<String> failures=attempted;
        activity=Json.obj("phase","cache","message","正在查找本地缓存","startedAt",activityStartedAt());runtime.emit();
        beginLoading();
        final String requestedQuality=quality;
        resolutionTask=resolver.submit(() -> {
            try {
                if(token!=generation||!wanted)return;
                JSONObject cached=failures.contains("cache")?null:reusableCache(current);if(cached!=null)failures.add("cache");if(cached==null||!cached.optString("cacheHit").equals("complete"))NetworkPreferences.require(this,runtime.store,"audio");JSONObject result=cached!=null?cached:new PlaylistReplacement(runtime.store,runtime.sources).resolve(current,failures,requestedQuality,(phase,message)->main.post(() -> {if(token==generation&&wanted){activity=Json.obj("phase",phase,"message",message,"startedAt",activityStartedAt());runtime.emit();}}),()->token!=generation||!wanted||Thread.currentThread().isInterrupted());
                if(result.has("replacementKey"))failures.add("replacement-active");
                main.post(() -> {if(token==generation&&wanted)start(result,token);});
            } catch(Exception e){main.post(() -> {if(token==generation&&wanted){if(e instanceof PlaylistReplacement.Unavailable&&skipUnavailableReplacement())return;wanted=false;finishLoading();activity=Json.obj("phase","failed","message",e instanceof PlaylistReplacement.Unavailable?"当前队列没有可播放的歌曲，请更换音乐源后重试":"资源暂不可用，请更换音乐源或重试","detail",SourceDiagnostics.reason(e),"startedAt",activityStartedAt());error=Json.obj("message",SourceDiagnostics.reason(e)+"，请重试或更换音乐源");if(roaming!=null&&roaming.isActive())roaming.failed();runtime.emit();}});}
        });
    }
    private boolean skipUnavailableReplacement(){
        if(track==null)return false;skippedReplacements.add(track.optString("id"));
        for(int step=1;step<queue.length();step++){int next=index+step;if(next>=queue.length()&&repeat.equals("off"))break;int at=next%queue.length();if(skippedReplacements.contains(queue.optJSONObject(at).optString("id")))continue;select(at);return true;}
        return false;
    }
    boolean completeCachedForInspection(JSONObject song){try{if(clearingCache||!cacheEnabled||cache==null)return false;JSONObject mappings=runtime.store.object("cacheMappings"),saved=mappings==null?null:mappings.optJSONObject(song.optString("id"));if(!ReplacementRules.cacheMatches(song,saved,runtime.store.object("personal")))return false;String key=saved.optString("cacheKey");long length=ContentMetadata.getContentLength(cache.getContentMetadata(key));return length>0&&cache.isCached(key,0,length);}catch(Exception unavailable){return false;}}
    private JSONObject reusableCache(JSONObject track) {
        if(!cacheEnabled)return null;
        JSONObject mappings=runtime.store.object("cacheMappings");JSONObject saved=mappings==null?null:mappings.optJSONObject(track.optString("id"));if(!ReplacementRules.cacheMatches(track,saved,runtime.store.object("personal")))return null;String key=saved.optString("cacheKey");long length=ContentMetadata.getContentLength(cache.getContentMetadata(key));if(length>0&&cache.isCached(key,0,length)){Json.put(saved,"mediaHosts",new JSONArray());Json.put(saved,"allowHttp",false);Json.put(saved,"cacheHit","complete");return saved;}
        if(AudioCachePlan.reusePrefix(cache.getCachedLength(key,0,64*1024),saved.optLong("cachedAt"),System.currentTimeMillis()))try{JSONObject partial=runtime.sources.cachedNetwork(saved);Json.put(partial,"cacheHit","partial");return partial;}catch(Exception ignored){}return null;
    }
    private JSONObject completePreviewCache(JSONObject song){
        if(clearingCache||cache==null)return null;JSONObject mappings=runtime.store.object("cacheMappings");if(mappings==null)return null;
        String candidate=song.optString("providerId")+"\n"+song.optString("remoteId");
        for(Iterator<String> it=mappings.keys();it.hasNext();){String id=it.next();JSONObject saved=mappings.optJSONObject(id);if(saved==null)continue;boolean same=id.equals(song.optString("id"))&&ReplacementRules.cacheMatches(song,saved,runtime.store.object("personal"));boolean bound=!song.optString("remoteId").isEmpty()&&candidate.equals(saved.optString("replacementKey"));if(!same&&!bound)continue;String key=saved.optString("cacheKey");if(key.isEmpty())continue;long length=ContentMetadata.getContentLength(cache.getContentMetadata(key));if(length>0&&cache.isCached(key,0,length)){JSONObject local=Json.copy(saved);Json.put(local,"mediaHosts",new JSONArray());Json.put(local,"allowHttp",false);Json.put(local,"cacheHit","complete");return local;}}
        return null;
    }
    private String cacheStatus(){if(track==null)return "none";boolean local=track.optString("source").equals("local");String key=resolution==null?"":resolution.optString("cacheKey"),url=resolution==null?"":resolution.optString("url");if(url.toLowerCase(Locale.ROOT).contains(".m3u8"))return "stream";if(cache==null||key.isEmpty())return AudioCachePlan.status(cacheEnabled,local,url.toLowerCase(Locale.ROOT).contains(".m3u8"),0,-1,false);long length=ContentMetadata.getContentLength(cache.getContentMetadata(key));return AudioCachePlan.status(cacheEnabled,local,false,cache.getCachedBytes(key,0,Long.MAX_VALUE),length,length>0&&cache.isCached(key,0,length));}
    private void start(JSONObject result,long token) {
        if(token!=generation)return;if(practiceStart>=0&&(!track.optString("playbackProviderId").equals(result.optString("providerId"))||!track.optString("replacementPlayback").equals(result.optString("replacementKey")))){practiceStart=-1;practiceEnd=-1;practiceTrack="";player.setPlaybackSpeed(1);schedulePracticeTick();}resolution=result;http=new OkHttpDataSource.Factory(SourceHttp.playbackClient(result.optJSONArray("mediaHosts"),result.optBoolean("allowHttp"))).setUserAgent("Zenix Android").setDefaultRequestProperties(headers(result.optJSONObject("headers")));cacheFactory.setUpstreamDataSourceFactory(http);
        String cover=track.optString("source").equals("local")?track.optString("coverUrl"):runtime.sources.cachedArtwork(track);
        MediaMetadata metadata=new MediaMetadata.Builder().setTitle(track.optString("title")).setArtist(track.optString("artist")).setAlbumTitle(track.optString("album")).setArtworkUri(cover.isEmpty()?null:cover.startsWith("/")?Uri.fromFile(new File(cover)):Uri.parse(cover)).build();
        MediaItem.Builder item=new MediaItem.Builder().setMediaId(track.optString("id")).setUri(result.optString("url")).setMediaMetadata(metadata);
        boolean completeCache=result.optString("cacheHit").equals("complete");
        if((cacheEnabled||completeCache)&&result.has("cacheKey")&&!result.optString("url").toLowerCase(Locale.ROOT).contains(".m3u8"))item.setCustomCacheKey(result.optString("cacheKey"));
        if(result.optJSONObject("playbackRecording")!=null)Json.put(track,"playbackRecording",result.optJSONObject("playbackRecording"));else track.remove("playbackRecording");Json.put(track,"actualQuality",result.optString("quality"));Json.put(track,"playbackProviderId",result.optString("providerId"));Json.put(track,"replacementPlayback",result.optString("replacementKey"));activity=Json.obj("phase","buffering","message",result.optString("cacheHit").equals("complete")?"正在读取本地音频缓存":result.optString("cacheHit").equals("partial")?"优先读取已缓存片段":"音频正在缓冲"+(resolution==null?"":" · "+resolution.optString("providerName")),"startedAt",activityStartedAt());
        CacheDataSource.Factory selectedCache=audioCacheSource(cache,http,result.optString("cacheHit").equals("complete"));
        DataSource.Factory dataSource=track.optString("source").equals("local")?new DefaultDataSource.Factory(this,http):cacheEnabled||completeCache?selectedCache:http;
        // Explicit loader failures return to source fallback. Pending/receiving
        // audio is never discarded because of the elapsed loading duration.
        DefaultMediaSourceFactory mediaFactory=new DefaultMediaSourceFactory(this).setDataSourceFactory(dataSource).setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(0));
        player.setMediaSource(mediaFactory.createMediaSource(item.build()));if(resumePosition>0)player.seekTo(resumePosition);player.prepare();if(wanted)player.play();runtime.emit();
        if(cacheEnabled&&result.has("cacheKey")&&!track.optString("source").equals("local")&&!result.optString("url").toLowerCase(Locale.ROOT).contains(".m3u8")){
            JSONObject copy=Json.copy(result);String id=track.optString("id");long epoch=cacheEpoch;Json.put(copy,"cachedAt",System.currentTimeMillis());if(result.has("replacementKey"))Json.put(copy,"cachePlaylistId",track.optString("playlistId"));
            resolver.execute(() -> {try{synchronized(this){if(epoch==cacheEpoch&&!clearingCache)pruneCacheMappings(id,copy);}}catch(Exception ignored){}});
        }
    }
    static CacheDataSource.Factory audioCacheSource(SimpleCache cache,DataSource.Factory upstream,boolean complete){
        CacheDataSource.Factory factory=new CacheDataSource.Factory().setCache(cache).setFlags(CacheDataSource.FLAG_IGNORE_CACHE_ON_ERROR);
        if(!complete)factory.setUpstreamDataSourceFactory(upstream);
        return factory;
    }
    SimpleCache offlineCache(){return cache;}
    CacheBudget offlineBudget(){return budget;}
    Future<?> offlineRemember(JSONObject song,JSONObject result){final JSONObject value=Json.copy(result);final String id=song.optString("id");final long epoch=cacheEpoch;Json.put(value,"cachedAt",System.currentTimeMillis());if(value.has("replacementKey"))Json.put(value,"cachePlaylistId",song.optString("playlistId"));return resolver.submit(()->{try{synchronized(this){if(epoch!=cacheEpoch||clearingCache)throw new IllegalStateException("缓存状态已变化");pruneCacheMappings(id,value);}runtime.emit();}catch(Exception failure){throw new CompletionException(failure);}});}
    // The audio cache evicts files independently. Never retain an ever-growing
    // JSON index (including old signed URLs/headers) for already evicted audio.
    private synchronized void pruneCacheMappings(String id,JSONObject latest)throws Exception {
        if(clearingCache)return;
        JSONObject old=runtime.store.object("cacheMappings");if(old==null)old=new JSONObject();
        Set<String> keys=new HashSet<>(cache.getKeys());List<String> ids=new ArrayList<>();
        for(Iterator<String> it=old.keys();it.hasNext();){String candidate=it.next();JSONObject value=old.optJSONObject(candidate);if(value!=null&&keys.contains(value.optString("cacheKey"))&&!candidate.equals(id))ids.add(candidate);}
        JSONObject values=old;ids.sort((a,b)->Long.compare(values.optJSONObject(b).optLong("cachedAt"),values.optJSONObject(a).optLong("cachedAt")));
        JSONObject next=new JSONObject();if(id!=null&&latest!=null)Json.put(next,id,latest);
        for(String candidate:ids)if(NetworkPreferences.pinned(runtime.store,old.optJSONObject(candidate).optString("cacheKey"))&&next.length()<2300)Json.put(next,candidate,old.optJSONObject(candidate));
        int ordinary=id!=null&&latest!=null&&!NetworkPreferences.pinned(runtime.store,latest.optString("cacheKey"))?1:0;
        for(String candidate:ids){if(next.has(candidate))continue;if(ordinary>=300)break;Json.put(next,candidate,old.optJSONObject(candidate));ordinary++;}
        runtime.store.set("cacheMappings",next);
    }
    private static Map<String,String> headers(JSONObject json){Map<String,String> values=new HashMap<>();if(json!=null)for(Iterator<String> it=json.keys();it.hasNext();){String key=it.next();if(!key.equalsIgnoreCase("Host")&&!key.equalsIgnoreCase("Content-Length"))values.put(key,json.optString(key));}return values;}
    void resume(){stopPreview(false);if(clearingCache)return;if(track!=null&&track.optString("availability").equals("unavailable")){error=Json.obj("message","请先导入同名本地音频，再重新导入歌单进行匹配");runtime.emit();return;}if(listenedTrack==null&&track!=null){listenedTrack=Json.copy(track);listenClock=SystemClock.elapsedRealtime();}if(roaming!=null&&roaming.needsRetry()){roaming.retry();return;}if(roaming!=null)roaming.userResume();wanted=true;if(player.getPlaybackState()==Player.STATE_IDLE&&track!=null){playbackEstablished=false;generation++;cancelResolution();attempted=new HashSet<>();if(track.optString("source").equals("local"))start(Json.obj("url",track.optString("audioUrl"),"quality","local"),generation);else resolveNext(generation);}else player.play();runtime.emit();}
    private void pausePlayback(){stopPreview(false);skippedReplacements.clear();wanted=false;finishLoading();player.pause();if(player.getPlaybackState()==Player.STATE_IDLE||player.getPlaybackState()==Player.STATE_BUFFERING){resumePosition=Math.max(resumePosition,player.getCurrentPosition());generation++;cancelResolution();player.stop();activity=null;}}
    void toggle(){if(wanted||roaming!=null&&roaming.pending()){if(roaming!=null)roaming.userPause();pausePlayback();}else resume();runtime.emit();}
    void seek(double seconds){stopPreview(false);if(!Double.isFinite(seconds))return;double duration=state().optDouble("duration"),target=Math.max(0,duration>0?Math.min(seconds,duration):Math.min(seconds,86400));if(player.getMediaItemCount()==0)resumePosition=(long)(target*1000);else{resumePosition=0;player.seekTo((long)(target*1000));}runtime.emit();}
    static String recordingIdentity(JSONObject song){if(song==null)return "custom\0\0";JSONObject actual=song.optJSONObject("playbackRecording");if(actual!=null)song=actual;String remote=song.optString("remoteId");return song.optString("source","custom")+"\0"+song.optString("providerId")+"\0"+(remote.isEmpty()?song.optString("id"):remote);}
    void seek(double seconds,JSONObject expected)throws Exception{if(expected!=null&&(expected.optLong("selectionRevision",-1)!=generation||track==null||!expected.optString("id").equals(track.optString("id"))||!expected.optString("recordingIdentity").equals(recordingIdentity(track))))throw new Exception("当前歌曲已变化，未修改新歌曲的进度");seek(seconds);}
    void advance(int direction){if(roaming!=null&&roaming.isActive()){if(direction>0)roaming.next(false);else roaming.previous();return;}if(queue.length()==0)return;int at=index+direction;
        if(shuffle){String id=null;if(direction<0){if(shufflePosition>0)id=shuffleHistory.get(--shufflePosition);else return;}else if(shufflePosition+1<shuffleHistory.size())id=shuffleHistory.get(++shufflePosition);else{if(shuffleDeck.isEmpty()){if(repeat.equals("off")){wanted=false;player.pause();runtime.emit();return;}refillShuffle();}id=shuffleDeck.pollFirst();}at=findIndex(id);if(at<0){advance(direction);return;}}
        if(at<0)at=repeat.equals("off")?0:queue.length()-1;if(at>=queue.length()){if(repeat.equals("off")){wanted=false;player.pause();runtime.emit();return;}at=0;}select(at);}
    private int findIndex(String id){for(int i=0;i<queue.length();i++)if(queue.optJSONObject(i).optString("id").equals(id))return i;return -1;}
    private void refillShuffle(){List<String> ids=new ArrayList<>();for(int i=0;i<queue.length();i++){String id=queue.optJSONObject(i).optString("id");if(i!=index)ids.add(id);}if(ids.isEmpty()&&index>=0)ids.add(queue.optJSONObject(index).optString("id"));Collections.shuffle(ids);shuffleDeck.clear();shuffleDeck.addAll(ids);}
    private void resetShuffle(){shuffleHistory.clear();shufflePosition=-1;refillShuffle();}
    private void rememberShuffle(String id){shuffleDeck.remove(id);if(shufflePosition>=0&&shuffleHistory.get(shufflePosition).equals(id))return;while(shuffleHistory.size()>shufflePosition+1)shuffleHistory.remove(shuffleHistory.size()-1);shuffleHistory.add(id);if(shuffleHistory.size()>300)shuffleHistory.remove(0);shufflePosition=shuffleHistory.size()-1;}
    private void cancelResolution(){if(resolutionTask!=null&&!resolutionTask.isDone()){resolutionTask.cancel(true);runtime.sources.cancelPlayback();}resolutionTask=null;finishLoading();}
    private void beginLoading(){loadingForeground=true;try{if(!sourceWake.isHeld())sourceWake.acquire();showLoadingNotification();}catch(Exception failure){loadingForeground=false;if(sourceWake.isHeld())sourceWake.release();error=Json.obj("message","后台加载保护未开启："+Json.message(failure));}}
    private PendingIntent notificationAction(String action,int request){return PendingIntent.getService(this,request,new Intent(this,PlaybackService.class).setAction(action).putExtra("zenix.control",notificationNonce),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
    private void showLoadingNotification(){
        if(player!=null&&player.getPlaybackState()==Player.STATE_READY){finishLoading();return;}
        Intent intent=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent home=PendingIntent.getActivity(this,21,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        String title=track==null?"Zenix":track.optString("title","Zenix"),artist=track==null?"":track.optString("artist");
        String phase=activity==null?"正在准备播放":activity.optString("message","正在准备播放");
        android.app.Notification.Builder builder=Build.VERSION.SDK_INT>=26?new android.app.Notification.Builder(this,"zenix-playback"):new android.app.Notification.Builder(this);
        builder.setSmallIcon(R.drawable.zenix_icon).setContentTitle(title).setContentText(artist).setSubText(phase).setContentIntent(home).setOnlyAlertOnce(true).setOngoing(wanted)
            .addAction(android.R.drawable.ic_media_previous,"上一首",notificationAction("notification-previous",25))
            .addAction(wanted?android.R.drawable.ic_media_pause:android.R.drawable.ic_media_play,wanted?"暂停":"播放",notificationAction("notification-toggle",24))
            .addAction(android.R.drawable.ic_media_next,"下一首",notificationAction("notification-next",26));
        if(session!=null)builder.setStyle(new android.app.Notification.MediaStyle().setMediaSession(session.getPlatformToken()).setShowActionsInCompactView(0,1,2));
        if(Build.VERSION.SDK_INT>=29)startForeground(2101,builder.build(),ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);else startForeground(2101,builder.build());
    }
    private void finishLoading(){boolean active=loadingForeground;loadingForeground=false;if(sourceWake!=null&&sourceWake.isHeld())sourceWake.release();if(active){if(player!=null&&player.getPlaybackState()==Player.STATE_READY&&session!=null)super.onUpdateNotification(session,wanted);else if(!wanted)stopForeground(STOP_FOREGROUND_REMOVE);}}
    @Override public void onUpdateNotification(MediaSession mediaSession,boolean required){
        if(player!=null&&player.getPlaybackState()==Player.STATE_READY){loadingForeground=false;if(sourceWake!=null&&sourceWake.isHeld())sourceWake.release();super.onUpdateNotification(mediaSession,required);}
        else if(loadingForeground&&wanted)showLoadingNotification();else super.onUpdateNotification(mediaSession,required);
    }
    @Override public int onStartCommand(Intent intent,int flags,int id){
        String action=intent==null?"":intent.getAction();
        if(java.util.Set.of("notification-toggle","notification-next","notification-previous","pause-loading").contains(action==null?"":action)&&!notificationNonce.equals(intent.getStringExtra("zenix.control")))return START_NOT_STICKY;
        if("notification-toggle".equals(action)){toggle();return START_NOT_STICKY;}
        if("notification-next".equals(action)||"notification-previous".equals(action)){advance("notification-next".equals(action)?1:-1);return START_NOT_STICKY;}
        if("pause-loading".equals(action)){pausePlayback();activity=null;runtime.emit();return START_NOT_STICKY;}
        return super.onStartCommand(intent,flags,id);
    }
    JSONObject audioSettings(){JSONObject settings=runtime.store.object("audioSettings");if(settings==null)settings=Json.obj("enabled",false,"preset","flat","gains",Json.array(0,0,0,0,0,0,0,0,0,0));Json.put(settings,"applied",equalizerApplied);Json.put(settings,"error",equalizerError);return settings;}
    void configureAudio(JSONObject args)throws Exception{JSONObject settings=MusicEqualizer.validate(args);boolean applied;try{applied=equalizer.apply(player.getAudioSessionId(),settings);}catch(Exception error){throw new Exception("此设备无法应用均衡器："+Json.message(error));}try{runtime.store.enqueue(Json.obj("audioSettings",settings));}catch(Exception failure){try{equalizer.apply(player.getAudioSessionId(),runtime.store.object("audioSettings"));}catch(Exception ignored){}throw failure;}equalizerApplied=applied;equalizerError="";runtime.emit();}
    Object spaceFeature(JSONObject args)throws Exception{return roaming.feature(args);}
    JSONObject playbackFeature(JSONObject args)throws Exception{
        String operation=args.optString("operation");
        if(operation.equals("preferences"))return PlaybackPreferences.clean(runtime.store.object("playbackPreferences"));
        if(operation.equals("preferencesSave")){synchronized(runtime.store){JSONObject current=PlaybackPreferences.clean(runtime.store.object("playbackPreferences"));if(args.has("expected")&&!BackupFormat.canonical(current).equals(BackupFormat.canonical(PlaybackPreferences.clean(args.optJSONObject("expected")))))throw new Exception("本机版本偏好已有新修改，未覆盖");JSONObject next=PlaybackPreferences.clean(args.optJSONObject("value"));runtime.store.set("playbackPreferences",next);return next;}}
        if(operation.equals("replacementInfo")){JSONObject[] ctx=track==null?null:new PlaylistReplacement(runtime.store,runtime.sources).context(track);JSONObject info=ctx==null?(track==null?null:track.optJSONObject("replacement")):ctx[1].optJSONObject("replacement");return info==null?new JSONObject():info;}
        if(operation.equals("state"))return Json.obj("loop",practiceStart>=0?Json.obj("trackId",practiceTrack,"start",practiceStart,"end",practiceEnd):JSONObject.NULL,"rate",player.getPlaybackParameters().speed,"preview",previewPlayer!=null||previewTask!=null&&!previewTask.isDone(),"previewError",previewError);
        if(operation.equals("practice")){
            JSONObject recordingExpected=args.optJSONObject("expected");if(recordingExpected!=null&&recordingExpected.has("recordingIdentity")&&!recordingExpected.optString("recordingIdentity").equals(recordingIdentity(track)))throw new Exception("歌曲版本已变化，请重新选择练习片段");
            JSONObject expected=args.optJSONObject("expected");if(expected!=null&&expected.has("recordingId")&&!expected.optString("recordingId").equals(track==null||track.optJSONObject("playbackRecording")==null?"":track.optJSONObject("playbackRecording").optString("remoteId")))throw new Exception("歌曲版本已变化，请重新选择练习片段");if(expected!=null)for(String key:List.of("id","remoteId","replacementPlayback","playbackProviderId"))if(!expected.optString(key).equals(track==null?"":track.optString(key)))throw new Exception("歌曲版本已变化，请重新选择练习片段");
            double rate=args.optDouble("rate",player.getPlaybackParameters().speed);if(!Double.isFinite(rate)||rate<.5||rate>1.5)throw new Exception("练习速度范围为 0.5–1.5 倍");
            if(args.optBoolean("enabled")){double a=args.optDouble("start",-1),b=args.optDouble("end",-1),duration=state().optDouble("duration");if(track==null||!Double.isFinite(a)||!Double.isFinite(b)||a<0||b-a<.5||duration>0&&b>duration)throw new Exception("请选择有效的 A–B 区间（至少半秒）");practiceStart=a;practiceEnd=b;practiceTrack=track.optString("id");if(player.getCurrentPosition()<a*1000||player.getCurrentPosition()>=b*1000)player.seekTo((long)(a*1000));}
            else if(args.has("enabled")){practiceStart=-1;practiceEnd=-1;practiceTrack="";}
            player.setPlaybackSpeed((float)rate);schedulePracticeTick();runtime.emit();return playbackFeature(Json.obj("operation","state"));
        }
        if(operation.equals("recover")){if(track==null)throw new Exception("当前没有待恢复歌曲");if(args.has("trackId")&&!args.optString("trackId").equals(track.optString("id")))throw new Exception("当前歌曲已变化");resumePosition=Math.max(resumePosition,player.getCurrentPosition());wanted=true;generation++;cancelResolution();attempted=new HashSet<>();error=null;if(track.optString("source").equals("local"))start(Json.obj("url",track.optString("audioUrl"),"quality","local"),generation);else resolveNext(generation);return state();}
        if(operation.equals("previewStop")){stopPreview(true);return playbackFeature(Json.obj("operation","state"));}
        if(operation.equals("preview")){
            if(roaming!=null&&roaming.isActive())throw new Exception("请先结束漫游，再进行版本试听");
            JSONObject candidate=PrivateStore.cleanTrack(args.getJSONObject("track"));candidate.remove("playlistId");candidate.remove("replacement");candidate.remove("replacementPlayback");
            double start=args.optDouble("start",0),length=args.optDouble("length",20);if(!Double.isFinite(start)||start<0||!Double.isFinite(length)||length<1||length>30)throw new Exception("试听片段无效");
            boolean resume=previewPlayer!=null?previewResume:wanted;stopPreview(false);pausePlayback();previewResume=resume;previewOwner=generation;previewError="";long owner=previewOwner;previewEnd=(long)((start+length)*1000);
            ExoPlayer audition=new ExoPlayer.Builder(this).build();previewPlayer=audition;schedulePracticeTick();audition.setVolume(player.getVolume());audition.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),true);
            audition.addListener(new Player.Listener(){@Override public void onIsPlayingChanged(boolean playing){schedulePracticeTick();}@Override public void onPlaybackStateChanged(int state){if(state==Player.STATE_ENDED&&previewPlayer==audition)stopPreview(true);}@Override public void onPlayerError(PlaybackException failure){if(previewPlayer==audition){previewError="此版本试听失败，请尝试其他候选";stopPreview(true);runtime.emit();}}});
            previewTask=resolver.submit(()->{try{JSONObject resolved;if(candidate.optString("source").equals("local"))resolved=Json.obj("url",candidate.optString("audioUrl"));else{resolved=completePreviewCache(candidate);if(resolved==null){NetworkPreferences.require(this,runtime.store,"audio");resolved=runtime.sources.resolve(candidate,new HashSet<>(),quality,(phase,message)->{},()->owner!=generation||previewPlayer!=audition||Thread.currentThread().isInterrupted());}}JSONObject prepared=resolved;main.post(()->{if(owner!=generation||previewPlayer!=audition)return;JSONObject result=prepared;DataSource.Factory upstream=new OkHttpDataSource.Factory(SourceHttp.playbackClient(result.optJSONArray("mediaHosts"),result.optBoolean("allowHttp"))).setDefaultRequestProperties(headers(result.optJSONObject("headers")));DataSource.Factory factory=candidate.optString("source").equals("local")?new DefaultDataSource.Factory(this):audioCacheSource(cache,upstream,result.optString("cacheHit").equals("complete"));MediaItem.Builder item=new MediaItem.Builder().setUri(result.optString("url"));if(result.has("cacheKey"))item.setCustomCacheKey(result.optString("cacheKey"));audition.setMediaSource(new DefaultMediaSourceFactory(this).setDataSourceFactory(factory).createMediaSource(item.build()));audition.seekTo((long)(start*1000));audition.prepare();audition.play();});}catch(Exception failure){main.post(()->{if(previewPlayer==audition){previewError="试听失败："+SourceDiagnostics.reason(failure);stopPreview(true);runtime.emit();}});}});
            runtime.emit();return playbackFeature(Json.obj("operation","state"));
        }
        throw new Exception("未知播放工具操作");
    }
    private void stopPreview(boolean restore){ExoPlayer current=previewPlayer;boolean active=current!=null||previewTask!=null&&!previewTask.isDone(),resume=active&&restore&&previewOwner==generation&&previewResume;previewPlayer=null;previewResume=false;if(previewTask!=null)previewTask.cancel(true);previewTask=null;if(current!=null)current.release();schedulePracticeTick();if(resume)resume();}
    void configureLyrics(JSONObject args)throws Exception{String id=args.getString("id");double offset=args.getDouble("offset");if(id.length()>300||!Double.isFinite(offset)||Math.abs(offset)>30)throw new Exception("歌词校正无效");JSONObject values=runtime.store.object("lyricOffsets");if(values==null)values=new JSONObject();if(offset==0)values.remove(id);else{if(!values.has(id)&&values.length()>=10000)throw new Exception("歌词校正记录已达到上限，请先重置不再使用的校正");Json.put(values,id,offset);}runtime.store.enqueue(Json.obj("lyricOffsets",values));}
    double lyricOffset(){JSONObject values=runtime.store.object("lyricOffsets");return values==null||track==null?0:values.optDouble(track.optString("id"),0);}
    void mode(JSONObject args){repeat=args.optString("repeat",repeat);if(!Set.of("off","all","one").contains(repeat))repeat="all";boolean oldShuffle=shuffle;shuffle=args.optBoolean("shuffle",shuffle);if(oldShuffle!=shuffle){resetShuffle();if(track!=null)rememberShuffle(track.optString("id"));}quality=args.optString("quality",quality);try{persist();}catch(Exception ignored){}runtime.emit();}
    void remove(String id)throws Exception {if(roaming!=null&&roaming.isActive()){if(track!=null&&track.optString("id").equals(id))roaming.next(false);return;}JSONArray next=new JSONArray();int old=index;boolean autoPlay=wanted;for(int i=0;i<queue.length();i++)if(!queue.getJSONObject(i).optString("id").equals(id))next.put(queue.get(i));else if(i<index)index--;boolean wasCurrent=track!=null&&track.optString("id").equals(id);queue=next;shuffleDeck.remove(id);if(wasCurrent){if(queue.length()>0)select(Math.min(old,queue.length()-1),autoPlay);else{generation++;cancelResolution();player.stop();track=null;index=-1;wanted=false;activity=null;}}persist();runtime.emit();}
    void configureCache(JSONObject args)throws Exception {boolean changed=cacheEnabled!=args.optBoolean("enabled",cacheEnabled);cacheEnabled=args.optBoolean("enabled",cacheEnabled);int limit=Math.max(64,Math.min(4096,args.optInt("limitMiB",runtime.store.integer("cacheLimitMiB",512))));runtime.store.enqueue(Json.obj("cacheEnabled",cacheEnabled,"cacheLimitMiB",limit));runtime.work.execute(()->{budget.setLimit(cache,limit*1024L*1024L);runtime.sources.pruneMetadata();resolver.execute(()->{try{pruneCacheMappings(null,null);}catch(Exception ignored){}});runtime.emit();});if(changed&&resolution!=null&&player.getPlaybackState()!=Player.STATE_IDLE){long position=player.getCurrentPosition();start(Json.copy(resolution),generation);player.seekTo(position);}runtime.emit();}
    void clearCache(java.util.function.Consumer<Exception> completed)throws Exception {
        if(clearingCache||player.isPlaying()||wanted)throw new Exception("请先暂停播放再清理缓存");
        clearingCache=true;cacheEpoch++;generation++;cancelResolution();player.stop();activity=null;runtime.emit();
        runtime.work.execute(()->{Exception failure=null;try{for(String key:new HashSet<>(cache.getKeys()))if(!NetworkPreferences.pinned(runtime.store,key))cache.removeResource(key);runtime.sources.clearMetadata();synchronized(this){JSONObject old=runtime.store.object("cacheMappings"),keep=new JSONObject();if(old!=null)for(Iterator<String> it=old.keys();it.hasNext();){String id=it.next();JSONObject row=old.optJSONObject(id);if(row!=null&&NetworkPreferences.pinned(runtime.store,row.optString("cacheKey"))&&cache.getKeys().contains(row.optString("cacheKey")))Json.put(keep,id,row);}runtime.store.set("cacheMappings",keep);}}catch(Exception error){failure=error;}Exception result=failure;main.post(()->{clearingCache=false;completed.accept(result);runtime.emit();});});
    }
    JSONObject roamingState(){return roaming==null?Json.obj("active",false,"phase","idle","message","","discovered",0,"tracks",new JSONArray()):roaming.snapshot();}
    void roamingCommand(String command,JSONObject args)throws Exception{switch(command){case "roamingStart":roaming.start();break;case "roamingStop":roaming.stop();break;case "roamingRetry":roaming.retry();break;case "roamingPlay":roaming.play(args.getString("id"));break;}}
    boolean isActuallyPlaying(){return player!=null&&player.isPlaying();}
    double currentDuration(){long duration=player==null?0:player.getDuration();return duration>0?duration/1000.0:track==null?0:track.optDouble("duration");}
    void waitForRoaming(){generation++;cancelResolution();wanted=false;activity=null;error=null;player.stop();runtime.emit();}
    void playRoaming(JSONObject song){JSONArray before=roaming.previousSongs(song.optString("id")),after=roaming.followingSongs(song.optString("id"));queue=new JSONArray();for(int i=0;i<before.length();i++)queue.put(before.optJSONObject(i));int at=queue.length();queue.put(PrivateStore.cleanTrack(song));for(int i=0;i<after.length();i++)queue.put(after.optJSONObject(i));repeat="off";shuffle=false;select(at);}
    void syncRoamingHistory(JSONArray before,JSONArray after){if(track==null)return;queue=new JSONArray();for(int i=0;i<before.length();i++)queue.put(before.optJSONObject(i));index=queue.length();queue.put(PrivateStore.queueTrack(track));for(int i=0;i<after.length();i++)queue.put(after.optJSONObject(i));try{persist();}catch(Exception ignored){}runtime.emit();}
    void leaveRoaming(){generation++;attempted=new HashSet<>();queue=track==null?new JSONArray():Json.array(PrivateStore.cleanTrack(track));index=track==null?-1:0;repeat="off";try{persist();}catch(Exception ignored){}if(wanted&&track!=null&&player.getPlaybackState()==Player.STATE_IDLE)resolveNext(generation);}
    private void persist() throws Exception{runtime.store.enqueue(Json.obj("queue",queue,"queueIndex",index,"repeat",repeat,"shuffle",shuffle,"quality",quality));}
    JSONObject sleepTimerState(){return Json.obj("endsAt",sleepEndsAt);}
    JSONObject setSleepTimer(double minutes)throws Exception {if(!Double.isFinite(minutes)||minutes<0||minutes>720||minutes>0&&minutes<1)throw new Exception("定时范围为 1–720 分钟");long next=minutes==0?0:System.currentTimeMillis()+(long)(minutes*60000);runtime.store.enqueue(Json.obj("sleepEndsAt",next));sleepEndsAt=next;return sleepTimerState();}
    private void checkSleepTimer(){if(sleepEndsAt>0&&System.currentTimeMillis()>=sleepEndsAt){sleepEndsAt=0;try{runtime.store.enqueue(Json.obj("sleepEndsAt",0));}catch(Exception ignored){}if(roaming!=null)roaming.userPause();wanted=false;generation++;cancelResolution();player.pause();activity=null;runtime.emit();MusicWidget.updateAll(this);}}
    private void accountListening(){long now=SystemClock.elapsedRealtime();double seconds=Math.min(5,Math.max(0,(now-listenClock)/1000.0));listenClock=now;if(!listening||listenedTrack==null||seconds<=0)return;listenSeconds+=seconds;pendingSeconds+=seconds;double duration=currentDuration();double threshold=duration>0?Math.min(30,duration/2):30;boolean count=!countedPlay&&listenSeconds>=threshold;if(count)countedPlay=true;if(pendingSeconds>=10||count)flushListening(count);}
    private void flushListening(boolean count){if(listenedTrack==null||pendingSeconds<=0&&!count)return;JSONObject song=Json.copy(listenedTrack);double seconds=pendingSeconds;pendingSeconds=0;long at=System.currentTimeMillis();runtime.work.execute(()->{try{runtime.companion.stats.record(song,seconds,count?1:0,at);runtime.companion.statsError="";}catch(Exception error){runtime.companion.statsError="聆听记录保存失败："+Json.message(error);}});}
    @Override public void onTaskRemoved(Intent rootIntent){if(!wanted&&!isPlaybackOngoing())stopSelf();}
    @Override public void onDestroy(){accountListening();flushListening(false);main.removeCallbacks(listeningTick);main.removeCallbacks(practiceTick);stopPreview(false);if(roaming!=null)roaming.close();generation++;cancelResolution();resolver.shutdownNow();runtime.detach(this);if(session!=null)session.release();equalizer.close();if(player!=null)player.release();if(cache!=null)cache.release();MusicWidget.updateAll(this);super.onDestroy();}
}
