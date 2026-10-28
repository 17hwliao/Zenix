package com.zenix.musicplayer;

import org.json.*;
import java.io.*;
import java.nio.file.Files;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;

/** Actual PrivateStore locks and files; only Android/crypto services are stubbed. */
public final class StoreConcurrencyCheck {
    interface Work { void run() throws Exception; }
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static void waitBlocked(Thread thread)throws Exception{
        long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);
        while(thread.getState()!=Thread.State.BLOCKED&&System.nanoTime()<until)Thread.sleep(1);
        check(thread.getState()==Thread.State.BLOCKED,"save did not reach competing store lock");
    }
    static void concurrent(PrivateStore store,Work save)throws Exception{
        var field=PrivateStore.class.getDeclaredField("diskLock");field.setAccessible(true);Object disk=field.get(store);
        CountDownLatch holding=new CountDownLatch(1),inspect=new CountDownLatch(1),inspected=new CountDownLatch(1);
        AtomicReference<Throwable> error=new AtomicReference<>();
        Thread flush=new Thread(()->{try{synchronized(disk){holding.countDown();inspect.await();store.read();inspected.countDown();}}catch(Throwable failure){error.set(failure);}},"fixture-flush");flush.setDaemon(true);flush.start();
        check(holding.await(3,TimeUnit.SECONDS),"disk writer did not start");
        Thread command=new Thread(()->{try{save.run();}catch(Throwable failure){error.set(failure);}},"fixture-settings");command.setDaemon(true);command.start();
        waitBlocked(command);inspect.countDown();
        check(inspected.await(3,TimeUnit.SECONDS),"deadlock: settings holds state while waiting for disk, flush waits for state");
        command.join(3000);flush.join(3000);check(!command.isAlive()&&!flush.isAlive(),"store command did not finish");
        if(error.get()!=null)throw new AssertionError("store command failed",error.get());
    }
    static void expectFailure(Work work,String message)throws Exception{try{work.run();throw new AssertionError(message);}catch(IOException expected){} }
    public static void main(String[] args){try{run(new File(args[0]));System.out.println("STORE_CONCURRENCY_PASS");System.exit(0);}catch(Throwable failure){failure.printStackTrace();System.exit(1);}}
    static void run(File folder)throws Exception{
        folder.mkdirs();PrivateStore store=new PrivateStore(new android.content.Context(folder));ZenixRuntime runtime=new ZenixRuntime(store);PlaybackSettings settings=new PlaybackSettings(runtime);
        JSONObject baseline=store.read();Json.put(baseline.getJSONObject("personal"),"liked",Json.array(Json.obj("id","kept","title","保留歌曲")));
        Json.put(baseline,"sources",Json.array(Json.obj("id","kept-source","networkPolicy",Json.obj("allowHttp",true))));
        store.replaceAtomic(baseline);
        JSONObject space=SpaceFeatureCommands.clean(Json.obj("motion","light"));
        concurrent(store,()->SpaceFeatureCommands.invoke(runtime,Json.obj("action","save","value",space)));
        check(store.object("spaceFeatures").optLong("revision")==1,"space revision not committed");
        boolean conflict=false;try{SpaceFeatureCommands.invoke(runtime,Json.obj("action","save","value",space));}catch(Exception expected){conflict=true;}check(conflict,"stale space snapshot overwrote new settings");
        JSONObject initial=PlaybackPreferences.clean(null),next=PlaybackPreferences.clean(Json.obj("mode","live"));
        concurrent(store,()->settings.save(Json.obj("operation","preferencesSave","expected",initial,"value",next)));
        conflict=false;try{settings.save(Json.obj("operation","preferencesSave","expected",initial,"value",initial));}catch(Exception expected){conflict=true;}check(conflict,"stale playback preferences overwrote new settings");
        String file=Files.readString(new File(folder,"zenix.json").toPath());
        android.util.AtomicFile.failNext=true;
        try{SpaceFeatureCommands.invoke(runtime,Json.obj("action","save","value",Json.obj("revision",1,"motion","reduced")));throw new AssertionError("disk failure was hidden");}catch(IOException expected){}
        check(store.object("spaceFeatures").optString("motion").equals("light"),"failed space save changed live state");
        android.util.AtomicFile.failNext=true;
        expectFailure(()->settings.save(Json.obj("operation","preferencesSave","expected",next,"value",initial)),"disk failure was hidden");
        check(store.object("playbackPreferences").optString("mode").equals("live"),"failed preference save changed live state");
        check(file.equals(Files.readString(new File(folder,"zenix.json").toPath())),"failed commit changed persisted bytes");
        PrivateStore reopened=new PrivateStore(new android.content.Context(folder));
        check(reopened.object("personal").getJSONArray("liked").getJSONObject(0).optString("id").equals("kept"),"user collection changed");
        check(reopened.array("sources").getJSONObject(0).optString("id").equals("kept-source"),"sources changed");
        check(reopened.object("spaceFeatures").optLong("revision")==1&&reopened.object("playbackPreferences").optString("mode").equals("live"),"settings did not survive reopening");
    }
}
final class PlaybackSettings {
    final ZenixRuntime runtime;PlaybackSettings(ZenixRuntime runtime){this.runtime=runtime;}
    Object save(JSONObject args)throws Exception{String operation=args.optString("operation");
        /* PRODUCTION_PREFERENCES_SAVE */
        throw new Exception("unexpected operation");
    }
}
final class ZenixRuntime {final PrivateStore store;PlaybackService service;ZenixRuntime(PrivateStore store){this.store=store;}}
final class PlaybackService {Object spaceFeature(JSONObject args){return null;}}
final class SourceHttp {static byte[] bounded(InputStream input,int limit)throws IOException{try(input){byte[] bytes=input.readNBytes(limit+1);if(bytes.length>limit)throw new IOException("too large");return bytes;}}}
final class SourcePolicy {static JSONObject validate(JSONObject policy){return policy;}}
final class ProtectedJson {static String encode(String text){return text;}static JSONObject decode(JSONObject envelope){return envelope;}}
final class PlaylistReplacement {static void check(java.util.function.BooleanSupplier cancel){if(cancel.getAsBoolean())throw new CancellationException();}}
final class PersonalFeatureFormat {static JSONObject record(JSONObject raw,JSONObject before,JSONObject after,String label){return raw;}}
final class BackupFormat {static String canonical(Object value){return String.valueOf(value);}}
final class PlaylistBatch {static void apply(JSONObject personal,JSONObject args){throw new AssertionError("unused playlist operation");}}
final class PersonalCollections {static void addMany(JSONObject personal,JSONArray tracks,JSONArray kinds){throw new AssertionError("unused collection operation");}static void add(JSONObject personal,JSONObject track,JSONArray kinds){throw new AssertionError("unused collection operation");}}
