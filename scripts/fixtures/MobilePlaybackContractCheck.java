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
    static JSONObject track(String origin){return Json.obj("id","fixture-track","providerId",origin,"remoteId","fixture-remote","title","Fixture","artist","Artist","source","custom","duration",90);}
    static void sources(File folder)throws Exception {
        File packs=new File(folder,"sources");packs.mkdirs();PrivateStore store=new PrivateStore();
        for(String id:List.of("slowA","B","C")){store.sources.put(source(id));Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
        MusicSources sources=new MusicSources(new android.content.Context(folder),store);
        try {
            ScriptEngine.calls.clear();android.os.SystemClock.now=0;
            JSONObject result=sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS);
            check(result.optString("providerId").equals("B")&&result.optString("quality").equals("standard"),"quality downgrade and next source");
            check(ScriptEngine.calls.stream().filter(value->value.startsWith("slowA:resolvePlayback")).count()==1,"transport failure must skip other quality tiers");
            check(android.os.SystemClock.now==45000,"source budget includes all request waits");
            check(sources.diagnostics.state().getJSONObject("sources").getJSONObject("B").optInt("played")==0,"URL resolution is not audible playback");
            sources.playbackReady(track("slowA"),result);check(sources.diagnostics.state().getJSONObject("sources").getJSONObject("B").optInt("played")==1,"actual playback recorded separately");ScriptEngine.calls.clear();
            sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS);
            check(ScriptEngine.calls.get(0).startsWith("B:"),"successful source reused before cold origin");
            check(ScriptEngine.calls.stream().noneMatch(value->value.startsWith("slowA:")),"failed source cooling down");
            sources.playbackFailed(result,false);ScriptEngine.calls.clear();sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS);check(ScriptEngine.calls.get(0).startsWith("B:"),"decoder errors still allow quality downgrade on the same source");
            sources.playbackFailed(result,true);check(sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS).optString("providerId").equals("C"),"failed media transport switches provider");
            store.set("smoothPlayback",false);ScriptEngine.calls.clear();sources.resolve(track("slowA"),new HashSet<>(),"high",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS);check(ScriptEngine.calls.get(0).startsWith("slowA:"),"manual order honored even after a successful fallback");
            JSONObject chosen=track("slowA");Json.put(chosen,"preferredPlaybackProviderId","C");ScriptEngine.calls.clear();sources.resolve(chosen,new HashSet<>(),"high",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS);check(ScriptEngine.calls.get(0).startsWith("C:"),"explicit selection starts with that provider without changing configured order");
            JSONArray moved=sources.move("C",-1);check(moved.optJSONObject(1).optString("id").equals("C"),"manual order persists");
        }finally{sources.close();}
        store.sources=new JSONArray();for(String id:List.of("slowA","slowB","slowC","slowD")){store.sources.put(source(id));Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
        MusicSources allSlow=new MusicSources(new android.content.Context(folder),store);ScriptEngine.calls.clear();android.os.SystemClock.now=0;
        try{allSlow.resolve(track("slowA"),new HashSet<>(),"lossless",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS);throw new AssertionError("slow sources succeeded");}catch(Exception expected){check(android.os.SystemClock.now==180000,"global resolution cap remains finite");check(ScriptEngine.calls.stream().anyMatch(value->value.startsWith("slowD:")),"global budget reaches fourth stalled source");}finally{allSlow.close();}
        store.sources=new JSONArray();for(String id:List.of("slow1","slow2","healthy","extra1","extra2","extra3","extra4")){store.sources.put(source(id));Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
        MusicSources fair=new MusicSources(new android.content.Context(folder),store);ScriptEngine.calls.clear();android.os.SystemClock.now=0;
        try{JSONObject result=fair.resolve(track("slow1"),new HashSet<>(),"high",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS);check(result.optString("providerId").equals("healthy"),"healthy source after two stalled providers");check(android.os.SystemClock.now==90000,"stalled providers receive full allowance before healthy fallback");}finally{fair.close();}
        store.sources=new JSONArray();for(String id:List.of("unsupported","broken","supported")){JSONObject source=source(id);source.put("kind","lx");if(!id.equals("broken"))source.getJSONObject("manifest").put("lxPlatforms",id.equals("unsupported")?Json.obj("tx",Json.obj("qualitys",Json.array("320k"))):Json.obj("wy",Json.obj("qualitys",Json.array("128k"))));store.sources.put(source);Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
        JSONObject lxTrack=track("unsupported");lxTrack.put("remoteId",android.util.Base64.encodeToString(Json.obj("source","wy").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8),android.util.Base64.URL_SAFE|android.util.Base64.NO_WRAP|android.util.Base64.NO_PADDING));
        MusicSources supported=new MusicSources(new android.content.Context(folder),store);List<String> phases=new ArrayList<>();ScriptEngine.calls.clear();android.os.SystemClock.now=0;
        try{JSONObject result=supported.resolve(lxTrack,new HashSet<>(),"high",(phase,message)->phases.add(message),()->false,PlaybackSourcePlan.TOTAL_MS);check(result.optString("providerId").equals("supported"),"compatible catalog reused");check(ScriptEngine.calls.stream().noneMatch(value->value.startsWith("unsupported:")||value.startsWith("broken:")),"unsupported or incomplete platform never triggers a search or script call");check(phases.stream().noneMatch(value->value.contains("高品质")||value.contains("无损")),"no progress claim for unsupported quality");check(phases.stream().anyMatch(value->value.contains("标准品质")&&value.contains("supported")),"progress names the source and real quality");}finally{supported.close();}
        check(PlaybackSourcePlan.sourceBudget(1,7)==1&&PlaybackSourcePlan.sourceBudget(0,7)==0,"tiny deadline cannot be extended by minimum budget");
        java.util.concurrent.atomic.AtomicLong clock=new java.util.concurrent.atomic.AtomicLong();PlaybackSourcePlan plan=new PlaybackSourcePlan(clock::get);JSONArray order=Json.array(source("A"),source("B"));plan.failure("A");check(plan.order(order,"family","A").get(0).optString("id").equals("B"),"cooldown avoids A");clock.set(60001);check(plan.order(order,"family","A").get(0).optString("id").equals("A"),"cooldown expires");
    }
    static void patientSongs(File folder)throws Exception {
        PrivateStore store=new PrivateStore();File packs=new File(folder,"sources");
        for(String id:List.of("patient","extra1","extra2","extra3","extra4","extra5","extra6")){store.sources.put(source(id));Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
        MusicSources sources=new MusicSources(new android.content.Context(folder),store);
        try{
            for(JSONObject song:List.of(Json.obj("title","你不知道的事","artist","王力宏","duration",280),Json.obj("title","像风一样","artist","薛之谦","duration",255))){
                JSONObject chosen=track("patient");for(Iterator<String> keys=song.keys();keys.hasNext();){String key=keys.next();Json.put(chosen,key,song.opt(key));}
                android.os.SystemClock.now=0;ScriptEngine.calls.clear();
                JSONObject result=sources.resolve(chosen,new HashSet<>(),"high",(phase,message)->{},()->false,PlaybackSourcePlan.TOTAL_MS);
                check(result.optString("providerId").equals("patient")&&android.os.SystemClock.now==30000,"cold initialization plus slow lookup survives a seven-source queue: "+song.optString("title"));
                check(ScriptEngine.calls.size()==1,"slow success is not prematurely cancelled or replaced");
                android.os.SystemClock.now=0;
                try{sources.resolve(chosen,new HashSet<>(),"high",(phase,message)->{},()->android.os.SystemClock.now>=30000,PlaybackSourcePlan.TOTAL_MS);throw new AssertionError("cancelled result was published");}catch(CancellationException expected){}
            }
        }finally{sources.close();}
        check(PlaybackSourcePlan.sourceBudget(180000,7)==45000,"adding sources cannot shrink cold allowance");
        check(PlaybackSourcePlan.sourceBudget(1200,7)==1200,"remaining global deadline wins");
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
    static void matchingAndBackgrounds(File folder)throws Exception{
        JSONObject original=track("A"),exact=track("B");check(MusicSources.sameRecordingMetadata(original,exact),"exact recording matches");
        for(JSONObject patch:List.of(Json.obj("artist","Artist & Guest"),Json.obj("title","Fix-ture"),Json.obj("title","Fixture (Live)"),Json.obj("duration",0),Json.obj("duration",95),Json.obj("artist",""))){JSONObject candidate=Json.copy(exact);for(Iterator<String> keys=patch.keys();keys.hasNext();){String key=keys.next();Json.put(candidate,key,patch.opt(key));}check(!MusicSources.sameRecordingMetadata(original,candidate),"ambiguous fallback rejected: "+patch);}
        Json.put(original,"album","Studio");Json.put(exact,"album","Live");check(!MusicSources.sameRecordingMetadata(original,exact),"different known album rejected");
        File backgrounds=new File(folder,"background");backgrounds.mkdirs();File before=new File(backgrounds,"backdrop-before.png"),after=new File(backgrounds,"backdrop-after.png"),current=new File(backgrounds,"backdrop-current.png"),unused=new File(backgrounds,"backdrop-unused.png"),other=new File(backgrounds,"unrelated.txt");for(File file:List.of(before,after,current,unused,other))Files.writeString(file.toPath(),"fixture");
        JSONObject journal=Json.obj("before",Json.obj("appearance",Json.obj("background",Json.obj("url",before.getAbsolutePath()))),"after",Json.obj("appearance",Json.obj("background",Json.obj("url",after.getAbsolutePath()))));
        BackgroundFiles.prune(backgrounds,current,journal);check(before.isFile()&&after.isFile()&&current.isFile()&&other.isFile()&&!unused.exists(),"journal/current files survive normal replacement cleanup");
        BackgroundFiles.prune(backgrounds,current,null);check(!before.exists()&&!after.exists()&&current.isFile(),"completed journal releases old backgrounds");
    }
    public static void main(String[] args)throws Exception{lanes();sources(new File(args[0]));patientSongs(new File(args[0]));cacheAndCollections();matchingAndBackgrounds(new File(args[0]));System.out.println("MOBILE_PLAYBACK_CONTRACT_PASS");}
}

final class PrivateStore {
    JSONArray sources=new JSONArray();JSONObject data=Json.obj("smoothPlayback",true);
    JSONObject object(String key){return data.optJSONObject(key);}
    JSONObject readKeys(String... keys){JSONObject result=new JSONObject();for(String key:keys)if(data.has(key))Json.put(result,key,data.opt(key));return result;}
    void enqueue(JSONObject values){for(Iterator<String> keys=values.keys();keys.hasNext();){String key=keys.next();Json.put(data,key,values.opt(key));}}
    JSONArray array(String key){return sources;}
    int integer(String key,int fallback){return fallback;}
    void set(String key,Object value){if(key.equals("sources"))sources=(JSONArray)value;else Json.put(data,key,value);}
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
    static void check(String url,JSONArray hosts,boolean allowHttp,long timeout)throws Exception{if(timeout<=0)throw new TimeoutException("DNS deadline exhausted");check(url,hosts,allowHttp);}
}
final class ScriptEngine implements AutoCloseable {
    static final List<String> calls=new java.util.concurrent.CopyOnWriteArrayList<>();
    final String script;boolean closed;
    ScriptEngine(android.content.Context context,String script,JSONObject info,JSONArray hosts,boolean catalog){this.script=script;}
    ScriptEngine(android.content.Context context,String script,JSONObject info,JSONArray hosts,boolean catalog,boolean allowHttp){this.script=script;}
    JSONObject ready(){return new JSONObject();}
    Object call(String method,Object payload,JSONObject settings)throws Exception{return call(method,payload,settings,20000);}
    Object call(String method,Object payload,JSONObject settings,long timeout)throws Exception {
        String quality=payload instanceof JSONObject?((JSONObject)payload).optString("quality"):"";calls.add(script+":"+method+":"+quality);if(timeout>PlaybackSourcePlan.SOURCE_MS&&method.equals("resolvePlayback"))throw new AssertionError("source request budget exceeded");
        if(method.equals("search"))return Json.obj("items",Json.array(Json.obj("remoteId","match-"+script,"title","Fixture","artist","Artist","duration",90)));
        if(script.equals("patient")){if(timeout<30000){android.os.SystemClock.now+=timeout;throw new TimeoutException("cold startup plus resource lookup");}android.os.SystemClock.now+=30000;}
        if(script.startsWith("slow")){android.os.SystemClock.now+=timeout;throw new TimeoutException("timeout");}
        if(script.equals("B")&&quality.equals("high"))throw new Exception("quality unavailable");
        return Json.obj("url","https://audio.example.test/fixture.mp3");
    }
    public void close(){closed=true;}
}
