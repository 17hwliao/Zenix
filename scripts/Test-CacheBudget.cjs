const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
test('production Android CacheBudget preserves old pins and rejects new excess spans without throwing into playback',async t=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'zenix-production-budget-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));
  const files={
    'androidx/annotation/OptIn.java':'package androidx.annotation;public @interface OptIn{Class<?>[] markerClass();}',
    'androidx/media3/common/util/UnstableApi.java':'package androidx.media3.common.util;public @interface UnstableApi{}',
    'androidx/media3/common/C.java':'package androidx.media3.common;public final class C{public static final long LENGTH_UNSET=-1;}',
    'androidx/media3/datasource/cache/Cache.java':'package androidx.media3.datasource.cache;public interface Cache{void removeSpan(CacheSpan span);}',
    'androidx/media3/datasource/cache/CacheSpan.java':'package androidx.media3.datasource.cache;public final class CacheSpan implements Comparable<CacheSpan>{public final String key;public final long position,length,lastTouchTimestamp;public CacheSpan(String key,long position,long length,long time){this.key=key;this.position=position;this.length=length;this.lastTouchTimestamp=time;}public int compareTo(CacheSpan other){int keyOrder=key.compareTo(other.key);return keyOrder!=0?keyOrder:Long.compare(position,other.position);}}',
    'androidx/media3/datasource/cache/CacheEvictor.java':'package androidx.media3.datasource.cache;public interface CacheEvictor{boolean requiresCacheSpanTouches();void onCacheInitialized();void onStartFile(Cache cache,String key,long position,long length);void onSpanAdded(Cache cache,CacheSpan span);void onSpanRemoved(Cache cache,CacheSpan span);void onSpanTouched(Cache cache,CacheSpan oldSpan,CacheSpan newSpan);}',
    'com/zenix/musicplayer/OfflineLaneCheck.java':`package com.zenix.musicplayer;
import java.util.concurrent.*;
public final class OfflineLaneCheck{
 static final class Engine implements AutoCloseable{volatile boolean closed;final CountDownLatch released=new CountDownLatch(1);public void close(){closed=true;released.countDown();}}
 public static void main(String[] args)throws Exception{SourceEngineLane<Engine> offline=new SourceEngineLane<>(),foreground=new SourceEngineLane<>();Engine backgroundEngine=new Engine(),musicEngine=new Engine();CountDownLatch started=new CountDownLatch(1);Throwable[] observed=new Throwable[1];Thread task=new Thread(()->{try{offline.call("same-source",()->backgroundEngine,engine->{started.countDown();engine.released.await();return "late";});}catch(Throwable failure){observed[0]=failure;}});task.start();if(!started.await(2,TimeUnit.SECONDS))throw new AssertionError("offline did not start");String playable=foreground.call("same-source",()->musicEngine,engine->"play");if(!playable.equals("play"))throw new AssertionError("offline blocked foreground source");offline.cancel();task.join(2000);if(task.isAlive()||!(observed[0] instanceof CancellationException)||musicEngine.closed)throw new AssertionError("offline cancel leaked into foreground lane");if(!foreground.call("same-source",()->{throw new AssertionError("foreground unnecessarily recreated");},engine->"still playing").equals("still playing"))throw new AssertionError();foreground.cancel();System.out.println("PRODUCTION_OFFLINE_LANE_PASS");}
}`,
    'com/zenix/musicplayer/CacheBudgetCheck.java':`package com.zenix.musicplayer;
import androidx.media3.datasource.cache.*;import java.util.*;
public final class CacheBudgetCheck{
 static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
 static final class Disk implements Cache{final CacheBudget budget;final Set<CacheSpan> live=new HashSet<>();Disk(long limit){budget=new CacheBudget(limit,key->key.startsWith("pin"));}CacheSpan add(String key,long bytes,long time){CacheSpan span=new CacheSpan(key,0,bytes,time);live.add(span);budget.onSpanAdded(this,span);return span;}public void removeSpan(CacheSpan span){if(live.remove(span))budget.onSpanRemoved(this,span);}long bytes(){long total=0;for(CacheSpan span:live)total+=span.length;return total;}void touch(CacheSpan old,long time){CacheSpan next=new CacheSpan(old.key,old.position,old.length,time);live.remove(old);live.add(next);budget.onSpanTouched(this,old,next);}}
 public static void main(String[] args)throws Exception{
  Disk disk=new Disk(100);CacheSpan pinned=disk.add("pin-original",80,1);disk.budget.onCacheInitialized();disk.budget.onStartFile(disk,"pin-new",0,-1);disk.add("pin-new",30,2);check(disk.bytes()==80&&disk.live.contains(pinned),"unknown-length new pin must not exceed budget or remove old pin");
  disk.budget.onStartFile(disk,"pin-known",0,200);disk.add("pin-known",30,3);check(disk.bytes()==80,"known-length reservation must not throw into source playback or keep excess bytes");
  disk.budget.setLimit(disk,60);disk.touch(pinned,4);check(disk.bytes()==80,"touch after lower limit must preserve old fixed data");disk.add("pin-later",10,5);check(disk.bytes()==80,"lowered budget cannot grow pinned bytes");
  Disk startup=new Disk(60);CacheSpan restored=startup.add("pin-restored",100,1);check(startup.bytes()==100,"startup must retain existing pins above newly lowered limit");startup.budget.onCacheInitialized();startup.touch(restored,2);check(startup.bytes()==100,"startup fixed span touch must not evict restored bytes");startup.add("pin-refused",1,3);check(startup.bytes()==100,"startup over-budget pin must never permit further growth");
  Disk lru=new Disk(100);CacheSpan fixed=lru.add("pin-keep",50,1),old=lru.add("old",30,2);lru.budget.onCacheInitialized();CacheSpan fresh=lru.add("fresh",30,3);check(lru.live.contains(fixed)&&lru.live.contains(fresh)&&!lru.live.contains(old)&&lru.bytes()==80,"ordinary LRU must evict oldest unfixed content");
  System.out.println("PRODUCTION_CACHE_BUDGET_PASS");
 }
}`};
  for(const [name,source]of Object.entries(files)){const target=path.join(folder,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,source);}
  const production=path.join(folder,'com/zenix/musicplayer/CacheBudget.java');await fs.copyFile(path.resolve(__dirname,'../android/app/src/main/java/com/zenix/musicplayer/CacheBudget.java'),production);
  const lane=path.join(folder,'com/zenix/musicplayer/SourceEngineLane.java');await fs.copyFile(path.resolve(__dirname,'../android/app/src/main/java/com/zenix/musicplayer/SourceEngineLane.java'),lane);
  const javaHome=process.env.JAVA_HOME||'C:/Program Files/Android/Android Studio/jbr',executable=name=>path.join(javaHome,'bin',name+(process.platform==='win32'?'.exe':''));
  await promisify(execFile)(executable('javac'),['-d',folder,...Object.keys(files).map(name=>path.join(folder,name)),production,lane],{windowsHide:true,timeout:30000});
  const {stdout}=await promisify(execFile)(executable('java'),['-cp',folder,'com.zenix.musicplayer.CacheBudgetCheck'],{windowsHide:true,timeout:10000});assert.match(stdout,/PRODUCTION_CACHE_BUDGET_PASS/);
  const isolated=await promisify(execFile)(executable('java'),['-cp',folder,'com.zenix.musicplayer.OfflineLaneCheck'],{windowsHide:true,timeout:10000});assert.match(isolated.stdout,/PRODUCTION_OFFLINE_LANE_PASS/);
});
