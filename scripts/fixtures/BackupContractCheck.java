package com.zenix.musicplayer;
import java.nio.file.*;
import java.util.*;
import org.json.*;
public final class BackupContractCheck {
    static void check(boolean result,String message){if(!result)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        String text=Files.readString(Path.of(args[0]));JSONObject payload=BackupFormat.decode(text);
        JSONObject current=Json.obj("liked",new JSONArray(),"favorites",new JSONArray(),"history",new JSONArray(),"playlists",new JSONArray());
        Set<String> selected=Set.of("liked","favorites","playlists");JSONObject first=BackupFormat.mergePersonal(current,payload.getJSONObject("personal"),selected,new JSONArray()),twice=BackupFormat.mergePersonal(first.getJSONObject("personal"),payload.getJSONObject("personal"),selected,new JSONArray());
        check(twice.optInt("added")==0,"repeat restore reports no additions");
        check(BackupFormat.canonical(first.getJSONObject("personal")).equals(BackupFormat.canonical(twice.getJSONObject("personal"))),"repeated import must be idempotent");
        JSONObject song=Json.copy(payload.getJSONObject("personal").getJSONArray("liked").getJSONObject(0));Json.put(song,"source","local");Json.put(song,"id","old-local");
        JSONObject portable=BackupFormat.track(song);check(!portable.optString("id").equals("old-local")&&portable.optString("path").isEmpty(),"local paths must not travel");check(BackupFormat.restoreTrack(portable,new JSONArray()).optString("availability").equals("unavailable"),"missing local recording retained");
        JSONObject available=Json.copy(song);Json.put(available,"id","recipient-local");Json.put(available,"audioUrl","content://fixture");Json.put(available,"duration",122);check(BackupFormat.restoreTrack(portable,Json.array(available)).optString("id").equals("recipient-local"),"local metadata matching");check(BackupFormat.restoreTrack(portable,Json.array(available,Json.copy(available))).optString("availability").equals("unavailable"),"ambiguous local matches retained");
        JSONObject stats=BackupFormat.mergeStats(payload.getJSONObject("stats"),payload.getJSONObject("stats"));check(stats.getJSONObject("days").getJSONObject("2026-10-11").getDouble("seconds")==60,"stats must not double on restore");
        JSONObject envelope=new JSONObject(text);Json.put(envelope,"schemaVersion",2);try{BackupFormat.decode(envelope.toString());throw new AssertionError("future schema accepted");}catch(Exception expected){check(expected.getMessage().contains("更新"),"future schema guidance");}
        Json.put(envelope,"schemaVersion",1);Json.put(envelope,"sha256","0");try{BackupFormat.decode(envelope.toString());throw new AssertionError("corrupt backup accepted");}catch(Exception expected){check(expected.getMessage().contains("完整性"),"checksum enforced");}
        Files.writeString(Path.of(args[1]),BackupFormat.encode(payload));System.out.println("BACKUP_CONTRACT_PASS");
    }
}
