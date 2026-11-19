package com.zenix.musicplayer;

import android.content.Context;
import android.net.Uri;
import android.os.SystemClock;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy;
import java.io.IOException;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Future;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.json.JSONArray;
import org.json.JSONObject;

/** Local song playback for a LAN round, with a decoder and callbacks of its own. */
final class KaraokeAudio {
    private final Context context;
    private final ZenixRuntime runtime;
    private final Consumer<JSONObject> notify;
    private final MusicSources.KaraokeResolution resolver;
    private final ThreadPoolExecutor work=new ThreadPoolExecutor(1,1,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(1));
    private volatile long generation;
    private Future<?> resolving;
    private ExoPlayer player;
    private Consumer<Exception> pending;
    private String round="", trackId="";
    private boolean foreground=true, destroyed;

    KaraokeAudio(Context context,ZenixRuntime runtime,Consumer<JSONObject> notify){
        this.context=context.getApplicationContext();
        this.runtime=runtime;
        this.notify=notify;
        this.resolver=runtime.sources.new KaraokeResolution();
    }

    // Capacitor commands and lifecycle transitions enter through the main handler.
    void invoke(JSONObject args,Consumer<Exception> complete){
        try{
            String operation=args.optString("operation"),expected=readRound(args);
            switch(operation){
                case "play": play(expected,args,complete); return;
                case "pause":
                    if(expected.equals(round)){
                        if(pending!=null) stop();
                        else if(player!=null){player.pause();publish("paused","");}
                    }
                    break;
                case "stop":
                    if(expected.equals(round)) stop();
                    break;
                default: throw new IOException("无效的 K 歌音频操作");
            }
            complete.accept(null);
        }catch(Exception error){complete.accept(error);}
    }

    JSONObject status(JSONObject args)throws IOException{
        if(!readRound(args).equals(round))return Json.obj("positionMs",0,"playing",false,"buffering",false);
        ExoPlayer active=player;
        return Json.obj("positionMs",active==null?0:Math.max(0,active.getCurrentPosition()),
            "playing",active!=null&&active.isPlaying(),
            "buffering",resolving!=null||active!=null&&active.getPlaybackState()==Player.STATE_BUFFERING);
    }

    private static String readRound(JSONObject args)throws IOException{
        Object value=args.opt("round");
        if(!(value instanceof String))throw new IOException("K 歌轮次无效");
        String round=(String)value;
        if(round.isBlank()||round.length()>256||round.chars().anyMatch(Character::isISOControl))
            throw new IOException("K 歌轮次无效");
        return round;
    }

    private void play(String expected,JSONObject args,Consumer<Exception> complete)throws Exception{
        if(!foreground||destroyed)throw new IOException("请在前台打开 K 歌房间");
        JSONObject track=args.getJSONObject("track");
        String id=track.optString("id");
        if(id.isBlank()||id.length()>32768)throw new IOException("K 歌曲目无效");
        double rawPosition=args.optDouble("positionMs",0);
        if((args.has("positionMs")&&!(args.get("positionMs") instanceof Number))
            ||!Double.isFinite(rawPosition)||rawPosition<0||rawPosition>86_400_000)
            throw new IOException("K 歌播放时间无效");
        long position=(long)rawPosition;
        if(expected.equals(round)&&id.equals(trackId)&&player!=null&&pending==null
            &&player.getPlaybackState()!=Player.STATE_ENDED){
            if(args.has("positionMs")&&Math.abs(player.getCurrentPosition()-position)>400)player.seekTo(position);
            if(player.isPlaying()){complete.accept(null);return;}
            pending=complete;
            player.play();
            return;
        }
        stop();
        round=expected;
        trackId=id;
        pending=complete;
        long ticket=generation;
        long requestedAt=SystemClock.elapsedRealtime();
        try{
            resolving=work.submit(()->{
                try{
                    Prepared prepared=prepareTrack(track,ticket);
                    runtime.main.post(()->install(ticket,position,requestedAt,prepared));
                }catch(Exception error){
                    runtime.main.post(()->{
                        if(ticket==generation)failed(error instanceof DisplayError?error.getMessage():"无法准备这首歌的 K 歌音频 · "+SourceDiagnostics.reason(error));
                    });
                }
            });
        }catch(Exception error){failed("K 歌音频正在处理另一首歌，请重试");}
    }

    private Prepared prepareTrack(JSONObject track,long ticket)throws Exception{
        if("local".equals(track.optString("source"))){
            JSONArray library=runtime.store.array("localTracks");
            if(library!=null)for(int i=0;i<library.length();i++){
                JSONObject song=library.optJSONObject(i);
                if(song==null||!song.optString("id").equals(track.getString("id")))continue;
                Uri uri=Uri.parse(song.optString("audioUrl"));
                if(!"content".equals(uri.getScheme())||uri.getAuthority()==null)break;
                return new Prepared(uri.toString(), "", new DefaultDataSource.Factory(context));
            }
            throw new DisplayError("本机音乐库中没有这首本地歌曲，请先导入");
        }
        JSONObject candidate=Json.copy(track);
        if("online".equals(candidate.optString("source")))Json.put(candidate,"source","custom");
        candidate=ReplacementRules.target(candidate);
        PlaybackService ordinary=runtime.service;
        JSONObject cached=ordinary==null?null:ordinary.completeKaraokeCache(candidate);
        if(cached!=null&&!cached.optString("url").toLowerCase(Locale.ROOT).contains(".m3u8")){
            return new Prepared(cached.getString("url"),cached.getString("cacheKey"),
                PlaybackService.audioCacheSource(ordinary.offlineCache(),null,true).setCacheWriteDataSinkFactory(null));
        }
        ensureNetwork();
        JSONObject resolved=resolver.resolveTrack(candidate,()->ticket!=generation||Thread.currentThread().isInterrupted());
        ensureNetwork();
        okhttp3.OkHttpClient http=SourceHttp.playbackClient(resolved.optJSONArray("mediaHosts"),resolved.optBoolean("allowHttp"))
            .newBuilder().addInterceptor(chain->{
                ensureNetwork();
                return chain.proceed(chain.request());
            }).build();
        return new Prepared(resolved.getString("url"),"",new OkHttpDataSource.Factory(http)
            .setUserAgent("Zenix Android").setDefaultRequestProperties(headers(resolved.optJSONObject("headers"))));
    }

    private void ensureNetwork()throws DisplayError{
        try{NetworkPreferences.require(context,runtime.store,"audio");}
        catch(Exception restricted){throw new DisplayError(restricted.getMessage());}
    }

    private static Map<String,String> headers(JSONObject raw){
        Map<String,String> headers=new LinkedHashMap<>();
        if(raw!=null)raw.keys().forEachRemaining(name->{
            if(!name.equalsIgnoreCase("Host")&&!name.equalsIgnoreCase("Content-Length"))headers.put(name,raw.optString(name));
        });
        return headers;
    }

    private void install(long ticket,long position,long requestedAt,Prepared audio){
        if(ticket!=generation)return;
        resolving=null;
        try{
            ExoPlayer audition=new ExoPlayer.Builder(context).build();
            player=audition;
            // K 歌不抢普通播放器的音频焦点，也不注册媒体会话。
            audition.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),false);
            audition.setHandleAudioBecomingNoisy(true);
            audition.setVolume(.65f);
            audition.addListener(new Player.Listener(){
                @Override public void onIsPlayingChanged(boolean playing){
                    if(player==audition&&playing){
                        acknowledge(null);
                        publish("playing","");
                    }
                }
                @Override public void onPlaybackStateChanged(int state){
                    if(player==audition&&state==Player.STATE_ENDED){
                        if(pending!=null)failed("K 歌音频已到结尾");
                        else{publish("ended","");stop();}
                    }
                }
                @Override public void onPlayerError(PlaybackException error){
                    if(player==audition)failed("K 歌音频播放失败 · "+SourceDiagnostics.reason(error));
                }
            });
            MediaItem.Builder item=new MediaItem.Builder().setUri(audio.url);
            if(!audio.cacheKey.isEmpty())item.setCustomCacheKey(audio.cacheKey);
            DefaultMediaSourceFactory factory=new DefaultMediaSourceFactory(context)
                .setDataSourceFactory(audio.factory).setLoadErrorHandlingPolicy(new DefaultLoadErrorHandlingPolicy(0));
            audition.setMediaSource(factory.createMediaSource(item.build()),
                position+Math.max(0,SystemClock.elapsedRealtime()-requestedAt));
            audition.prepare();
            audition.play();
        }catch(Exception error){failed("无法启动 K 歌音频 · "+SourceDiagnostics.reason(error));}
    }

    private void publish(String state,String message){
        notify.accept(Json.obj("round",round,"state",state,"message",message,
            "positionMs",player==null?0:Math.max(0,player.getCurrentPosition())));
    }

    private void acknowledge(Exception error){
        Consumer<Exception> callback=pending;
        pending=null;
        if(callback!=null)callback.accept(error);
    }

    private void failed(String message){
        publish("error",message);
        acknowledge(new DisplayError(message));
        stop();
    }

    private void stop(){
        generation++;
        if(resolving!=null){
            resolving.cancel(true);
            resolving=null;
            resolver.cancel();
            work.purge();
        }
        ExoPlayer previous=player;
        player=null;
        round="";
        trackId="";
        if(previous!=null)previous.release();
        acknowledge(new DisplayError("本轮 K 歌音频已停止"));
    }

    void foreground(boolean active){
        foreground=active;
        if(!active){if(!round.isEmpty())publish("stopped","");stop();}
    }
    void destroy(){destroyed=true;foreground(false);work.shutdownNow();}

    private static final class DisplayError extends IOException{
        DisplayError(String message){super(message);}
    }

    private static final class Prepared{
        final String url,cacheKey;
        final DataSource.Factory factory;
        Prepared(String url,String cacheKey,DataSource.Factory factory){this.url=url;this.cacheKey=cacheKey;this.factory=factory;}
    }
}
