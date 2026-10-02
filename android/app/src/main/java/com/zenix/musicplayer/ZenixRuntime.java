package com.zenix.musicplayer;

import android.content.*;
import android.os.*;
import org.json.*;
import java.util.concurrent.*;

final class ZenixRuntime {
    private static volatile ZenixRuntime instance;
    final PrivateStore store; final MusicSources sources;
    final ExecutorService work=Executors.newFixedThreadPool(2);
    final Handler main=new Handler(Looper.getMainLooper());
    private final Context context; volatile PlaybackService service; volatile LyricOverlayService overlay;
    private volatile ZenixNativePlugin observer;private volatile boolean visible;
    static ZenixRuntime get(Context context){if(instance==null)synchronized(ZenixRuntime.class){if(instance==null)instance=new ZenixRuntime(context);}return instance;}
    private ZenixRuntime(Context context){this.context=context.getApplicationContext();store=new PrivateStore(context);sources=new MusicSources(context,store);}
    void attach(PlaybackService service){this.service=service;}
    void detach(PlaybackService service){if(this.service==service)this.service=null;}
    void observe(ZenixNativePlugin plugin,boolean active){observer=plugin;visible=active;main.removeCallbacks(tick);if(active){emit();main.post(tick);}}
    void removeObserver(ZenixNativePlugin plugin){if(observer==plugin){observer=null;visible=false;main.removeCallbacks(tick);}}
    private final Runnable tick=new Runnable(){@Override public void run(){if(!visible||observer==null)return;if(service!=null)observer.publish(Json.obj("playback",service.progress(),"cache",service.cacheStats()));main.postDelayed(this,750);}};
    void ensureService(){context.startService(new Intent(context,PlaybackService.class));}
    JSONObject overlayStatus(){if(overlay!=null)return overlay.status();JSONObject settings=store.object("overlay");if(settings==null)settings=Json.obj("locked",false,"compact",false,"fontSize",20,"color","#c5e9ff");Json.put(settings,"enabled",false);Json.put(settings,"permitted",LyricOverlayService.allowed(context));return settings;}
    JSONObject snapshot(){JSONObject saved=store.read();JSONObject playback=service==null?Json.obj("playing",false,"position",0,"duration",0,"volume",.75,"muted",false,"shuffle",saved.optBoolean("shuffle"),"repeat",saved.optString("repeat","all"),"queue",saved.optJSONArray("queue"),"queueIndex",saved.optInt("queueIndex",-1)):service.state();return Json.obj("overlay",overlayStatus(),"playback",playback,"personal",saved.optJSONObject("personal"),"sources",sources.list(),"profile",saved.optJSONObject("profile"),"appearance",saved.optJSONObject("appearance"),"localTracks",saved.optJSONArray("localTracks")==null?new JSONArray():saved.optJSONArray("localTracks"),"cache",service==null?Json.obj("usedBytes",0,"enabled",saved.optBoolean("cacheEnabled",true),"limitMiB",saved.optInt("cacheLimitMiB",512)):service.cacheStats());}
    void emit(){main.post(() -> {if(observer!=null&&visible)observer.publish(snapshot());});}
}
