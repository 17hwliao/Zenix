package com.zenix.musicplayer;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Production source orchestration; only Android platform, network and JS are fixtures. */
public final class MobilePlaybackContractCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static final class Engine implements AutoCloseable {volatile boolean closed;public void close(){closed=true;}}
    static void lanes()throws Exception {
        SourceEngineLane<Engine> playback=new SourceEngineLane<>(),browse=new SourceEngineLane<>();
        CountDownLatch entered=new CountDownLatch(1),release=new CountDownLatch(1);Engine active=new Engine();
        ExecutorService workers=Executors.newFixedThreadPool(2);
        try {
            Future<Integer> playing=workers.submit(()->playback.call("A",()->active,engine->{entered.countDown();check(release.await(3,TimeUnit.SECONDS),"fixture gate");check(!engine.closed,"browse or background trim cancelled playback");return 7;}));
            check(entered.await(3,TimeUnit.SECONDS),"playback started");
            check(!playback.trimIdle(),"active playback must survive background trim");
            Engine searched=new Engine();check(browse.call("B",()->searched,engine->9)==9,"independent browse result");browse.cancel();
            check(searched.closed&&!active.closed,"cancellation confined to browse lane");release.countDown();check(playing.get(3,TimeUnit.SECONDS)==7,"background resolution completed");
            playback.cancel();check(active.closed,"explicit playback cancel closes owned engine");
            Engine replacement=new Engine();check(playback.call("B",()->replacement,engine->10)==10,"can resolve after cancellation");check(playback.trimIdle()&&replacement.closed,"idle engines can be retired");
            CountDownLatch opening=new CountDownLatch(1),openRelease=new CountDownLatch(1);Engine stale=new Engine();
            Future<?> cancelled=workers.submit(()->{try{playback.call("C",()->{opening.countDown();openRelease.await();return stale;},engine->{throw new AssertionError("stale engine invoked");});throw new AssertionError("cancelled task published");}catch(CancellationException expected){}catch(Exception error){throw new RuntimeException(error);}});
            check(opening.await(3,TimeUnit.SECONDS),"opening gate");playback.cancel();openRelease.countDown();cancelled.get(3,TimeUnit.SECONDS);check(stale.closed,"late-created engine closed");
        }finally{release.countDown();playback.cancel();browse.cancel();workers.shutdownNow();}
    }
    static JSONObject source(String id){return Json.obj("id",id,"kind","zenix","enabled",true,"settings",new JSONObject(),"manifest",Json.obj("name",id,"qualities",Json.array("high","standard","lossless")));}
    static JSONObject track(String origin){return Json.obj("id","fixture-track","providerId",origin,"remoteId","fixture-remote","title","Fixture","artist","Artist","source","custom");}
    static void sources(File folder)throws Exception {
        File packs=new File(folder,"sources");packs.mkdirs();PrivateStore store=new PrivateStore();
        for(String id:List.of("slowA","B","C")){store.sources.put(source(id));Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
        MusicSources sources=new MusicSources(new android.content.Context(folder),store);
        try {
            ScriptEngine.calls.clear();android.os.SystemClock.now=0;
            JSONObject result=sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,30000);
            check(result.optString("providerId").equals("B")&&result.optString("quality").equals("standard"),"quality downgrade and next source");
            check(ScriptEngine.calls.stream().filter(value->value.startsWith("slowA:resolvePlayback")).count()==1,"transport failure must skip other quality tiers");
            check(android.os.SystemClock.now==10000,"source budget includes all request waits");
            sources.playbackReady(track("slowA"),result);ScriptEngine.calls.clear();
            sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,30000);
            check(ScriptEngine.calls.get(0).startsWith("B:"),"successful source reused before cold origin");
            check(ScriptEngine.calls.stream().noneMatch(value->value.startsWith("slowA:")),"failed source cooling down");
            sources.playbackFailed(result,false);ScriptEngine.calls.clear();sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,30000);check(ScriptEngine.calls.get(0).startsWith("B:"),"decoder errors still allow quality downgrade on the same source");
            sources.playbackFailed(result,true);check(sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,30000).optString("providerId").equals("C"),"failed media transport switches provider");
            JSONArray moved=sources.move("C",-1);check(moved.optJSONObject(1).optString("id").equals("C"),"manual order persists");
        }finally{sources.close();}
        store.sources=new JSONArray();for(String id:List.of("slowA","slowB","slowC","slowD")){store.sources.put(source(id));Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
        MusicSources allSlow=new MusicSources(new android.content.Context(folder),store);ScriptEngine.calls.clear();android.os.SystemClock.now=0;
        try{allSlow.resolve(track("slowA"),new HashSet<>(),"lossless",(phase,message)->{},()->false,30000);throw new AssertionError("slow sources succeeded");}catch(Exception expected){check(android.os.SystemClock.now==30000,"global wait capped at 30 seconds");check(ScriptEngine.calls.stream().noneMatch(value->value.startsWith("slowD:")),"no new source after global deadline");}finally{allSlow.close();}
        java.util.concurrent.atomic.AtomicLong clock=new java.util.concurrent.atomic.AtomicLong();PlaybackSourcePlan plan=new PlaybackSourcePlan(clock::get);JSONArray order=Json.array(source("A"),source("B"));plan.failure("A");check(plan.order(order,"family","A").get(0).optString("id").equals("B"),"cooldown avoids A");clock.set(60001);check(plan.order(order,"family","A").get(0).optString("id").equals("A"),"cooldown expires");
    }
    static void cacheAndCollections()throws Exception {
        check(PlaybackSourcePlan.transportFailure(new Exception("HTTP 503"))&&!PlaybackSourcePlan.transportFailure(new Exception("HTTP 404 quality unavailable")),"connection failures skip quality loops; unavailable quality still downgrades");
        check(AudioCachePlan.status(true,false,false,100,100,true).equals("complete"),"complete cache is offline");
        check(AudioCachePlan.status(true,false,false,99,100,false).equals("partial"),"partial cannot be advertised as offline");
        check(AudioCachePlan.status(true,false,true,100,100,true).equals("stream"),"HLS not advertised as full song");
        check(AudioCachePlan.status(false,false,false,100,100,true).equals("disabled"),"cache preference honored");
        check(AudioCachePlan.reusePrefix(65536,1000,500000)&&!AudioCachePlan.reusePrefix(65536,1000,602000)&&!AudioCachePlan.reusePrefix(1024,1000,2000),"partial URL age and useful prefix boundary");
        JSONObject personal=Json.obj("liked",new JSONArray(),"favorites",new JSONArray());JSONObject song=track("B");
        PersonalCollections.add(personal,song,Json.array("liked","favorites"));PersonalCollections.add(personal,song,Json.array("liked","favorites"));
        check(personal.getJSONArray("liked").length()==1&&personal.getJSONArray("favorites").length()==1,"one-tap save idempotent, never toggles off");
        try{PersonalCollections.add(personal,song,Json.array("liked","unknown"));throw new AssertionError("invalid collection accepted");}catch(Exception expected){check(personal.getJSONArray("liked").length()==1,"invalid batch did not change collections");}
    }
    public static void main(String[] args)throws Exception{lanes();sources(new File(args[0]));cacheAndCollections();System.out.println("MOBILE_PLAYBACK_CONTRACT_PASS");}
}

final class PrivateStore {
    JSONArray sources=new JSONArray();
    JSONArray array(String key){return sources;}
    int integer(String key,int fallback){return fallback;}
    void set(String key,Object value){if(key.equals("sources"))sources=(JSONArray)value;}
}
final class SourcePolicy {
    static JSONArray hosts(JSONObject source,String kind){return null;}
    static boolean allowHttp(JSONObject source){return false;}
    static JSONObject validate(JSONObject policy){return policy;}
}
final class SourceHttp {
    static final int MAX_BYTES=4*1024*1024;
    static byte[] bounded(InputStream input,int limit)throws Exception{try(input){byte[] bytes=input.readAllBytes();if(bytes.length>limit)throw new IOException("oversize");return bytes;}}
    static JSONObject request(String url,JSONObject options,JSONArray hosts,Object observer,boolean allowHttp)throws Exception{throw new IOException("fixture performs no HTTP");}
    static void check(String url,JSONArray hosts,boolean allowHttp)throws Exception{if(!url.startsWith("https://"))throw new IOException("HTTPS required");}
}
final class ScriptEngine implements AutoCloseable {
    static final List<String> calls=new java.util.concurrent.CopyOnWriteArrayList<>();
    final String script;boolean closed;
    ScriptEngine(android.content.Context context,String script,JSONObject info,JSONArray hosts,boolean catalog){this.script=script;}
    ScriptEngine(android.content.Context context,String script,JSONObject info,JSONArray hosts,boolean catalog,boolean allowHttp){this.script=script;}
    JSONObject ready(){return new JSONObject();}
    Object call(String method,Object payload,JSONObject settings)throws Exception{return call(method,payload,settings,20000);}
    Object call(String method,Object payload,JSONObject settings,long timeout)throws Exception {
        String quality=payload instanceof JSONObject?((JSONObject)payload).optString("quality"):"";calls.add(script+":"+method+":"+quality);if(timeout>10000&&method.equals("resolvePlayback"))throw new AssertionError("source request budget exceeded");
        if(method.equals("search"))return Json.obj("items",Json.array(Json.obj("remoteId","match-"+script,"title","Fixture","artist","Artist")));
        if(script.startsWith("slow")){android.os.SystemClock.now+=timeout;throw new TimeoutException("timeout");}
        if(script.equals("B")&&quality.equals("high"))throw new Exception("quality unavailable");
        return Json.obj("url","https://audio.example.test/fixture.mp3");
    }
    public void close(){closed=true;}
}
