package com.zenix.musicplayer;
import org.json.*;
import java.nio.file.*;
final class SettingsBackupCheck {
 public static void main(String[] args)throws Exception{JSONObject payload=BackupFormat.decode(Files.readString(Path.of(args[0]))),settings=payload.getJSONObject("extensions").getJSONObject("featureSettings");if(settings.getJSONObject("space").getJSONArray("bookmarks").length()!=1||!settings.getJSONObject("networkPolicy").getString("audio").equals("unmetered"))throw new AssertionError("extension was discarded");JSONObject before=FeatureSettingsFormat.clean(Json.obj("space",Json.obj("revision",5),"assistant",Json.obj("size",100))),merged=FeatureSettingsFormat.merge(before,settings,false),replaced=FeatureSettingsFormat.merge(before,settings,true);if(merged.getJSONObject("assistant").getInt("size")!=100||replaced.getJSONObject("assistant").getInt("size")!=150||replaced.getJSONObject("space").getInt("revision")!=6)throw new AssertionError("local merge and revision contract");Files.writeString(Path.of(args[1]),BackupFormat.encode(payload),java.nio.charset.StandardCharsets.UTF_8);}
}
final class PrivateStore {JSONObject object(String key){return null;}}
