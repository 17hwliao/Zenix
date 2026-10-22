package com.zenix.musicplayer;
import java.io.*;import java.nio.file.*;import java.util.*;import org.json.*;
public final class ReplacementContractCheck {
 static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
 static JSONObject song(String id){JSONObject song=MobilePlaybackContractCheck.track(id);Json.put(song,"id","song-"+id);Json.put(song,"album","Album");return song;}
 public static void main(String[] args)throws Exception{
  File folder=new File(args[0]);PrivateStore store=new PrivateStore();File packs=new File(folder,"sources");packs.mkdirs();
  for(String id:List.of("resetAlways","slowX","patient","healthy")){store.sources.put(MobilePlaybackContractCheck.source(id));Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
  JSONObject original=song("original"),list=Json.obj("id","list-one","autoReplacement",true,"tracks",Json.array(original));store.set("personal",Json.obj("playlists",Json.array(list)));
  try(MusicSources sources=new MusicSources(new android.content.Context(folder),store)){
   PlaylistReplacement manager=new PlaylistReplacement(store,sources);JSONObject reference=Json.copy(original);Json.put(reference,"playlistId","list-one");JSONObject[] ctx=manager.context(reference);
   JSONObject state=ReplacementRules.empty();Json.put(state,"candidates",Json.array(song("resetAlways"),song("slowX"),song("patient")));manager.save(ctx,null,state);ctx=manager.context(reference);ScriptEngine.calls.clear();android.os.SystemClock.now=0;
   JSONObject resolved=manager.run(ctx,null,(phase,message)->{},()->false);
   check(ctx[1].getJSONObject("replacement").optInt("attempts")==3,"3 total attempts including explicit transport failures");check(ctx[1].getJSONObject("replacement").optString("status").equals("pending"),"URL and prefix are not actual playback");
   check(ScriptEngine.calls.stream().filter(value->value.contains("resolvePlayback")).count()==3,"no hidden quality or transient retries in replacement");check(android.os.SystemClock.now>=300000,"late successful parsing accepted");
   try{manager.run(manager.context(reference),null,(phase,message)->{},()->false);throw new AssertionError("budget reset without explicit request");}catch(Exception expected){check(expected.getMessage().contains("3"),"exhaustion message");}
   ScriptEngine.calls.clear();JSONObject played=manager.resolve(reference,new HashSet<>(),"high",(phase,message)->{},()->false);
   check(played.has("replacementKey")&&manager.context(reference)[1].getJSONObject("replacement").optInt("attempts")==3,"third scanned success is playable without reserving a fourth candidate");
   check(ScriptEngine.calls.stream().filter(value->value.contains("resolvePlayback")).count()==1,"saved candidate URL refresh has no nested retry");
   try{manager.resolve(reference,new HashSet<>(List.of("replacement-active")),"high",(phase,message)->{},()->false);throw new AssertionError("fourth candidate after third decoder failure");}catch(Exception expected){check(expected.getMessage().contains("3"),"decoder exhaustion remains bounded");}
   // Restore the already-probed candidate to test the actual playing callback.
   manager.save(manager.context(reference),manager.context(reference)[1].getJSONObject("replacement"),ctx[1].getJSONObject("replacement"));
   manager.played(reference,resolved.getString("replacementKey"));check(manager.context(reference)[1].getJSONObject("replacement").optString("status").equals("verified"),"actual playing callback confirms binding");
   JSONObject stale=Json.copy(ctx[1].getJSONObject("replacement"));try{manager.save(ctx,stale,ReplacementRules.empty());throw new AssertionError("stale write overwrote verified association");}catch(Exception expected){}
   JSONObject fresh=manager.context(reference)[1].getJSONObject("replacement");manager.save(manager.context(reference),fresh,null);
   ctx=manager.context(reference);state=ReplacementRules.empty();Json.put(state,"candidates",Json.array(song("healthy")));manager.save(ctx,null,state);
   java.util.concurrent.atomic.AtomicBoolean cancelled=new java.util.concurrent.atomic.AtomicBoolean();ScriptEngine.afterResolve=()->cancelled.set(true);
   try{manager.run(manager.context(reference),null,(phase,message)->{},cancelled::get);throw new AssertionError("late result accepted after cancellation");}catch(java.util.concurrent.CancellationException expected){}finally{ScriptEngine.afterResolve=null;}
   check(manager.context(reference)[1].getJSONObject("replacement").optJSONObject("target")==null,"cancellation cannot publish target");check(manager.context(reference)[1].getJSONObject("replacement").optInt("attempts")==1,"cancel preserves consumed attempts");
   JSONObject candidate=song("healthy");Json.put(candidate,"artist","Other");check(ReplacementRules.rank(original,candidate)==0,"other artist rejected");Json.put(candidate,"artist","Artist");Json.put(candidate,"duration",120);check(ReplacementRules.rank(original,candidate)==1,"duration mismatch needs confirmation");
   JSONObject automaticOriginal=Json.copy(original);Json.put(automaticOriginal,"artist","Different imported artist");Json.put(automaticOriginal,"duration",0);
   store.set("personal",Json.obj("playlists",Json.array(Json.obj("id","list-one","autoReplacement",true,"tracks",Json.array(automaticOriginal)))));
   ScriptEngine.calls.clear();ScriptEngine.searchKeywords.clear();android.os.SystemClock.now=0;
   JSONObject automatic=manager.resolve(reference,new HashSet<>(),"high",(phase,message)->{},()->false);
   check(automatic.optString("providerId").equals("patient"),"first title candidate can use a working source just like ordinary search playback");
   check(manager.context(reference)[1].getJSONObject("replacement").optInt("attempts")==1,"source fallback stays within the same reserved candidate-song attempt");
   check(manager.context(reference)[1].getJSONObject("replacement").getJSONObject("target").optString("providerId").equals("resetAlways"),"association keeps searched candidate identity even when another source plays it");
   check(ScriptEngine.searchKeywords.subList(0,3).equals(List.of("Fixture","Fixture","Fixture")),"initial candidate lookup uses only the song title and stops after three unique results");
   check(ScriptEngine.calls.stream().filter(value->value.contains("resolvePlayback")).count()==5,"normal playback retries explicit transport failures once then reaches the healthy provider");
   check(android.os.SystemClock.now>=300000,"automatic parsing still waits for a late explicit success");
   ScriptEngine.failReplacement=true;
   try{manager.resolve(reference,new HashSet<>(List.of("replacement-active")),"high",(phase,message)->{},()->false);throw new AssertionError("all replacement candidates should fail");}catch(PlaylistReplacement.Unavailable expected){}finally{ScriptEngine.failReplacement=false;}
   check(manager.context(reference)[1].getJSONObject("replacement").optInt("attempts")==3,"three candidate SONGS remain the shared limit after media failure and source exhaustion");
   JSONObject interrupted=ReplacementRules.empty();Json.put(interrupted,"attempts",3);Json.put(interrupted,"message","正在解析替代版本");Json.put(interrupted,"tried",Json.array("a","b","c"));manager.save(manager.context(reference),manager.context(reference)[1].getJSONObject("replacement"),interrupted);ScriptEngine.calls.clear();
   try{manager.resolve(reference,new HashSet<>(),"high",(phase,message)->{},()->false);throw new AssertionError("third cancelled reservation reset on resume");}catch(PlaylistReplacement.Unavailable expected){}
   check(ScriptEngine.calls.isEmpty()&&manager.context(reference)[1].getJSONObject("replacement").optInt("attempts")==3,"resuming cancelled third attempt cannot start a fourth or original lookup");
  }
  PrivateStore shortStore=new PrivateStore();shortStore.sources.put(MobilePlaybackContractCheck.source("healthy"));shortStore.set("personal",Json.obj("playlists",Json.array(Json.obj("id","short-list","autoReplacement",true,"tracks",Json.array(song("original"))))));
  try(MusicSources sources=new MusicSources(new android.content.Context(folder),shortStore)){PlaylistReplacement manager=new PlaylistReplacement(shortStore,sources);JSONObject ref=song("original");Json.put(ref,"playlistId","short-list");ScriptEngine.failReplacement=true;
   try{manager.resolve(ref,new HashSet<>(),"high",(phase,message)->{},()->false);throw new AssertionError("offline source unexpectedly played");}catch(PlaylistReplacement.Unavailable expected){}
   check(manager.context(ref)[1].getJSONObject("replacement").optInt("attempts")==1&&manager.context(ref)[1].getJSONObject("replacement").optBoolean("roundComplete"),"one-candidate failure is a completed round");
   ScriptEngine.failReplacement=false;ScriptEngine.calls.clear();JSONObject result=manager.resolve(ref,new HashSet<>(),"high",(phase,message)->{},()->false);check(result.has("replacementKey")&&ScriptEngine.calls.stream().anyMatch(value->value.contains(":search:")),"recovered source gets a fresh title search without manual reset");
  }finally{ScriptEngine.failReplacement=false;}
  PrivateStore probeStore=new PrivateStore();for(String id:List.of("probeBad","healthy")){probeStore.sources.put(MobilePlaybackContractCheck.source(id));Files.writeString(new File(packs,id+".json").toPath(),Json.obj("script",id).toString());}
  probeStore.set("personal",Json.obj("playlists",Json.array(Json.obj("id","probe-list","autoReplacement",true,"tracks",Json.array(song("original"))))));
  try(MusicSources sources=new MusicSources(new android.content.Context(folder),probeStore)){
   PlaylistReplacement manager=new PlaylistReplacement(probeStore,sources);JSONObject ref=song("original");Json.put(ref,"playlistId","probe-list");
   JSONObject result=manager.resolve(ref,new HashSet<>(),"high",(phase,message)->{},()->false);
   check(result.optString("providerId").equals("healthy"),"HTTP-200 non-audio on first source must try other qualities/sources for the same candidate");
   check(manager.context(ref)[1].getJSONObject("replacement").optInt("attempts")==1,"audio probing does not spend another candidate-song reservation");
   manager.save(manager.context(ref),manager.context(ref)[1].getJSONObject("replacement"),null);String before=probeStore.object("personal").toString();ScriptEngine.calls.clear();ScriptEngine.failSearch=true;
   try{manager.resolve(ref,new HashSet<>(),"high",(phase,message)->{},()->false);throw new AssertionError("failed catalog treated as empty songs");}catch(PlaylistReplacement.Unavailable wrong){throw new AssertionError("catalog transport errors must stop instead of skipping the whole playlist",wrong);}catch(Exception expected){check(expected.getMessage().contains("搜索全部失败"),"search failure is visible");}finally{ScriptEngine.failSearch=false;}
   check(probeStore.object("personal").toString().equals(before),"failed search cannot write a binding or use the candidate budget");check(ScriptEngine.calls.stream().noneMatch(s->s.contains("resolvePlayback")),"failed search never pretends candidates were parsed");
  }
  // Imported QQ identity must be able to search a configured NetEase-only source.
  PrivateStore imported=new PrivateStore();JSONObject provider=MobilePlaybackContractCheck.source("wy-only");Json.put(provider,"kind","lx");Json.put(provider,"settings",Json.obj("lxCatalog","wy"));Json.put(provider.getJSONObject("manifest"),"lxPlatforms",Json.obj("wy",Json.obj("qualitys",Json.array("320k"))));imported.sources.put(provider);Files.writeString(new File(packs,"wy-only.json").toPath(),Json.obj("script","wy-only").toString());
  JSONObject qq=song("lx.playlist:catalog");Json.put(qq,"remoteId",android.util.Base64.encodeToString(Json.obj("source","tx","songmid","QQ-MID").toString().getBytes(java.nio.charset.StandardCharsets.UTF_8),11));JSONObject wy=song("wy-only");Json.put(wy,"remoteId",android.util.Base64.encodeToString(Json.obj("source","wy","songmid",123).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8),11));ScriptEngine.catalogRows=Json.array(wy);
  try(MusicSources sources=new MusicSources(new android.content.Context(folder),imported)){JSONObject result=sources.resolve(qq,new HashSet<>(),"high",(phase,message)->{},()->false);check(result.optString("providerId").equals("wy-only"),"QQ import no longer filters out exact-recording search on another platform");
   imported.set("personal",Json.obj("playlists",Json.array(Json.obj("id","cached-list","tracks",Json.array(qq)))));ScriptEngine.calls.clear();JSONObject checked=sources.inspectReplacement(Json.obj("id","cached-list","trackId",qq.getString("id")),()->false,song->true);check(checked.getJSONArray("playlists").getJSONObject(0).getJSONArray("tracks").getJSONObject(0).getJSONObject("replacement").optString("status").equals("original"),"complete cache avoids unnecessary replacement");check(ScriptEngine.calls.isEmpty(),"complete cache inspection never starts a network script");
  }finally{ScriptEngine.catalogRows=new JSONArray();}
  JSONObject a=song("original"),b=song("healthy");Json.put(a,"playlistId","cache-one");JSONObject state=ReplacementRules.empty();Json.put(state,"target",b);Json.put(state,"status","pending");Json.put(state,"attempts",3);Json.put(a,"replacement",state);
  PrivateStore cached=new PrivateStore();cached.set("personal",Json.obj("playlists",Json.array(Json.obj("id","cache-one","tracks",Json.array(a)),Json.obj("id","cache-two","tracks",Json.array(a)))));
  JSONObject mapping=Json.obj("url","https://audio.example.test/b.mp3","cacheKey","b","replacementKey",ReplacementRules.key(b),"cachePlaylistId","cache-one");cached.set("cacheMappings",Json.obj(a.getString("id"),mapping));CacheService service=new CacheService(cached);
  check(service.reusableCache(a)!=null&&service.completeCachedForInspection(a),"same playlist and binding can reuse complete cache");
  service.cacheEnabled=false;check(service.completePreviewCache(b)!=null,"complete replacement recording can be previewed locally even when new caching is disabled");check(service.completePreviewCache(song("wrong-recording"))==null,"preview cache never aliases an unrelated recording");service.cacheEnabled=true;
  JSONObject other=Json.copy(a);Json.put(other,"playlistId","cache-two");check(service.reusableCache(other)==null&&!service.completeCachedForInspection(other),"different playlist cannot reuse this replacement cache");
  a.remove("replacement");cached.set("personal",Json.obj("playlists",Json.array(Json.obj("id","cache-one","tracks",Json.array(a)))));check(service.reusableCache(a)==null&&!service.completeCachedForInspection(a),"restore original rejects old replacement cache");
  Json.put(a,"replacement",Json.obj("target",song("other")));cached.set("personal",Json.obj("playlists",Json.array(Json.obj("id","cache-one","tracks",Json.array(a)))));check(service.reusableCache(a)==null,"changed target rejects previous replacement cache");
  JSONObject queueSong=Json.copy(a);Json.put(queueSong,"replacementPlayback","temporary");JSONArray restored=QueueEdits.apply(Json.array(queueSong),"",Json.obj("operation","restore","tracks",Json.array(queueSong)));check(restored.getJSONObject(0).optString("playlistId").equals("cache-one"),"undo retains playlist context");
  for(String edit:List.of("next","enqueue"))check(QueueEdits.apply(new JSONArray(),"",Json.obj("operation",edit,"track",queueSong)).getJSONObject(0).optString("playlistId").equals("cache-one"),"queue insert retains context");
  check(!PrivateStore.cleanTrack(queueSong).has("playlistId")&&!restored.getJSONObject(0).has("replacementPlayback"),"collections strip context and queues strip stale playback marker");
  // Execute the actual synchronized personal entry and mutator, with only the
  // encrypted disk boundary replaced. Cancel while its store lock is held.
  CommitStore commit=new CommitStore();JSONObject originalPersonal=Json.obj("liked",Json.array(song("liked")),"favorites",Json.array(song("favorite")),"history",new JSONArray(),"playlists",Json.array(Json.obj("id","commit-list","tracks",Json.array(song("original")))));commit.data=Json.obj("personal",Json.copy(originalPersonal));
  JSONObject newState=ReplacementRules.empty();Json.put(newState,"status","pending");Json.put(newState,"attempts",1);Json.put(newState,"target",song("healthy"));JSONObject edit=Json.obj("id","commit-list","edit","replacement","trackId",song("original").getString("id"),"expected",Json.array(song("original").getString("id")),"expectedReplacement","null","state",newState);
  java.util.concurrent.atomic.AtomicBoolean stopped=new java.util.concurrent.atomic.AtomicBoolean();java.util.concurrent.atomic.AtomicReference<Throwable> failure=new java.util.concurrent.atomic.AtomicReference<>();java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1);
  Thread writer=new Thread(()->{entered.countDown();try{commit.personal("batchPlaylist",edit,stopped::get);}catch(Throwable error){failure.set(error);}});
  synchronized(commit){writer.start();entered.await();stopped.set(true);}writer.join(3000);check(!writer.isAlive()&&failure.get() instanceof java.util.concurrent.CancellationException,"cancel checked after waiting for real personal lock");check(ReplacementRules.equivalent(commit.data.getJSONObject("personal"),originalPersonal)&&commit.flushes==0,"cancelled commit preserves all personal data");
  stopped.set(false);commit.personal("batchPlaylist",edit,stopped::get);check(commit.data.getJSONObject("personal").getJSONArray("playlists").getJSONObject(0).getJSONArray("tracks").getJSONObject(0).getJSONObject("replacement").optInt("attempts")==1,"uncancelled atomic commit still works");check(ReplacementRules.equivalent(commit.data.getJSONObject("personal").getJSONArray("liked"),originalPersonal.getJSONArray("liked")),"successful association retains other collections");
  System.out.println("REPLACEMENT_CONTRACT_PASS");
 }
 static class Cache {Object getContentMetadata(String key){return null;}boolean isCached(String key,long start,long length){return true;}long getCachedLength(String key,long start,long length){return 0;}}
 static class ContentMetadata {static long getContentLength(Object ignored){return 1024;}}
 static class Runtime {PrivateStore store;MusicSources sources;Runtime(PrivateStore store){this.store=store;}}
 static class CacheService {boolean cacheEnabled=true,clearingCache;Runtime runtime;Cache cache=new Cache();CacheService(PrivateStore store){runtime=new Runtime(store);}
 /* PRODUCTION_CACHE_METHODS */
 }
 static class CommitStore {JSONObject data;int flushes;
  static JSONObject cleanTrack(JSONObject track){return PrivateStore.cleanTrack(track);}
  void flush(){flushes++;}
  void apply(JSONObject changes){Json.put(data,"personal",Json.copy(changes.optJSONObject("personal")));}
  /* PRODUCTION_PERSONAL_METHODS */
 }
}
