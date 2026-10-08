package com.zenix.musicplayer;

import android.content.*;
import android.os.*;
import org.json.*;
import java.util.concurrent.*;

final class ZenixRuntime {
    private static volatile ZenixRuntime instance;
    final PrivateStore store; final MusicSources sources; final CompanionTools companion;
    final ExecutorService work=Executors.newFixedThreadPool(2);
    // Cover/lyric HTTP must not queue ahead of likes, playlist writes or stats.
    final ExecutorService sourceWork=new ThreadPoolExecutor(2,2,0L,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(32));
    final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService snapshots=Executors.newSingleThreadExecutor();
    private long publishedRevision=-1;private boolean emitQueued,fullPending,emitAgain;
    private final java.util.List<java.util.function.Consumer<com.getcapacitor.JSObject>> snapshotReplies=new java.util.ArrayList<>();
    private final java.util.List<java.util.function.Consumer<Exception>> snapshotErrors=new java.util.ArrayList<>();
    private final Context context; volatile PlaybackService service; volatile LyricOverlayService overlay;
    private volatile ZenixNativePlugin observer;private volatile boolean visible;
    static ZenixRuntime get(Context context){if(instance==null)synchronized(ZenixRuntime.class){if(instance==null)instance=new ZenixRuntime(context);}return instance;}
    private ZenixRuntime(Context context){this.context=context.getApplicationContext();store=new PrivateStore(context);sources=new MusicSources(context,store);companion=new CompanionTools(this.context,this);work.execute(sources::pruneMetadata);}
    void attach(PlaybackService service){this.service=service;}
    void detach(PlaybackService service){if(this.service==service)this.service=null;}
    void observe(ZenixNativePlugin plugin,boolean active){if(observer!=plugin||active&&!visible)publishedRevision=-1;observer=plugin;visible=active;main.removeCallbacks(tick);main.removeCallbacks(trimSources);if(active){emit();main.post(tick);}else main.postDelayed(trimSources,30000);}
    void removeObserver(ZenixNativePlugin plugin){if(observer==plugin){observer=null;visible=false;main.removeCallbacks(tick);main.removeCallbacks(trimSources);main.postDelayed(trimSources,30000);}}
    // Decoders and foreground playback belong to PlaybackService. Retire only
    // idle script WebViews; the next source request recreates them on demand.
    private final Runnable trimSources=this::scheduleSourceTrim;
    private void scheduleSourceTrim(){work.execute(() -> {if(!visible)sources.trimIdle();});}
    private final Runnable tick=new Runnable(){@Override public void run(){if(!visible||observer==null)return;if(service!=null)observer.publish(Json.obj("storageError",store.error(),"playback",service.progress(),"cache",service.cacheStats()));main.postDelayed(this,750);}};
    void ensureService(){context.startService(new Intent(context,PlaybackService.class));}
    JSONObject overlayStatus(){if(overlay!=null)return overlay.status();JSONObject settings=store.object("overlay");if(settings==null)settings=Json.obj("locked",false,"compact",false,"fontSize",20,"color","#c5e9ff");Json.put(settings,"enabled",false);Json.put(settings,"permitted",LyricOverlayService.allowed(context));return settings;}
    JSONObject dynamicSnapshot(){JSONObject playback=service==null?Json.obj("playing",false,"position",0,"duration",0,"volume",.75,"muted",false,"shuffle",false,"repeat","all","queue",new JSONArray(),"queueIndex",-1):service.state();return Json.obj("storageError",store.error(),"roaming",service==null?Json.obj("active",false,"phase","idle","message","","discovered",0,"tracks",new JSONArray()):service.roamingState(),"overlay",overlayStatus(),"playback",playback,"cache",service==null?Json.obj("usedBytes",0,"enabled",true,"limitMiB",store.integer("cacheLimitMiB",512)):service.cacheStats());}
    void snapshot(java.util.function.Consumer<com.getcapacitor.JSObject> reply,java.util.function.Consumer<Exception> failure){main.post(()->{snapshotReplies.add(reply);snapshotErrors.add(failure);scheduleFullSnapshot();});}
    private void scheduleFullSnapshot(){
        if(fullPending){emitAgain=true;return;}fullPending=true;
        String dynamic=dynamicSnapshot().toString();
        snapshots.execute(()->{try{JSONObject saved;long revision;synchronized(store){revision=store.presentationRevision();saved=store.readKeys("personal","sources","profile","appearance","localTracks");}
            JSONObject value=new JSONObject(dynamic);for(String key:java.util.List.of("personal","sources","profile","appearance","localTracks"))Json.put(value,key,saved.opt(key));if(value.isNull("localTracks"))Json.put(value,"localTracks",new JSONArray());
            com.getcapacitor.JSObject ready=new com.getcapacitor.JSObject(value.toString());
            main.post(()->{fullPending=false;publishedRevision=revision;JSONObject live=dynamicSnapshot();for(java.util.Iterator<String> keys=live.keys();keys.hasNext();){String key=keys.next();ready.put(key,live.opt(key));}if(observer!=null&&visible)observer.publishPrepared(ready);var replies=new java.util.ArrayList<>(snapshotReplies);snapshotReplies.clear();snapshotErrors.clear();for(var reply:replies)reply.accept(ready);if(emitAgain){emitAgain=false;emit();}});
        }catch(Exception error){main.post(()->{fullPending=false;var failures=new java.util.ArrayList<>(snapshotErrors);snapshotReplies.clear();snapshotErrors.clear();for(var failure:failures)failure.accept(error);});}});
    }
    void emit(){main.post(()->{if(emitQueued)return;emitQueued=true;main.post(()->{emitQueued=false;if(observer==null||!visible)return;if(fullPending){emitAgain=true;return;}if(publishedRevision!=store.presentationRevision())scheduleFullSnapshot();else observer.publish(dynamicSnapshot());});});}
}
