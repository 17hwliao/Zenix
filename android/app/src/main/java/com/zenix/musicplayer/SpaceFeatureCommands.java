package com.zenix.musicplayer;

import org.json.*;
import java.util.*;

/** Declared space preferences; no playback URLs, network calls or scripts. */
final class SpaceFeatureCommands {
    static Object invoke(ZenixRuntime runtime,JSONObject args)throws Exception{
        switch(args.optString("action")){
            case "read":return clean(runtime.store.object("spaceFeatures"));
            case "save":{synchronized(runtime.store){JSONObject next=clean(args.getJSONObject("value")),current=clean(runtime.store.object("spaceFeatures"));if(next.optLong("revision")!=current.optLong("revision"))throw new Exception("空间设置已有新修改，请重新打开工作台后再试");Json.put(next,"revision",current.optLong("revision")+1);runtime.store.set("spaceFeatures",next);return next;}}
            case "roaming":if(runtime.service==null)throw new Exception("播放器正在启动");return runtime.service.spaceFeature(args);
            default:throw new Exception("未知音乐空间操作");
        }
    }
    static JSONObject preferences(PrivateStore store){try{return clean(store.object("spaceFeatures")).getJSONObject("roaming");}catch(Exception error){return Json.obj("scope","all","playlistId","","discovery",.5,"artistGap",0,"excluded",new JSONArray());}}
    static JSONObject clean(JSONObject raw)throws Exception{return SpaceFeatureFormat.clean(raw);}
    static String normal(String value){return value.toLowerCase(Locale.ROOT).replaceAll("[\\s\\p{P}]","");}
    static String songKey(JSONObject track){return normal(track.optString("title"))+"|"+normal(track.optString("artist"));}
    static String versionKey(JSONObject track){return track.optString("providerId")+":"+track.optString("remoteId",track.optString("id"));}
    static JSONArray scoped(JSONObject p,JSONObject personal){JSONArray result=new JSONArray();if(personal==null)return result;if(p.optString("scope").equals("saved"))for(String kind:List.of("liked","favorites")){JSONArray rows=personal.optJSONArray(kind);if(rows!=null)for(int i=0;i<rows.length();i++)result.put(rows.opt(i));}JSONArray lists=personal.optJSONArray("playlists");if(lists!=null)for(int i=0;i<lists.length();i++){JSONObject list=lists.optJSONObject(i);if(list==null||p.optString("scope").equals("playlist")&&!list.optString("id").equals(p.optString("playlistId")))continue;JSONArray rows=list.optJSONArray("tracks");if(rows!=null)for(int j=0;j<rows.length();j++)result.put(rows.opt(j));}return result;}
    static boolean allows(JSONObject track,JSONObject p,JSONObject personal){JSONArray rows=p.optJSONArray("excluded");if(rows!=null)for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row==null||row.optString("effect").equals("reduce"))continue;String kind=row.optString("kind"),key=row.optString("key");if(kind.equals("song")&&key.equals(songKey(track))||kind.equals("version")&&key.equals(versionKey(track)))return false;if(kind.equals("artist"))for(String artist:track.optString("artist").split("\\s*[/、&＋+]\\s*"))if(normal(artist).equals(key))return false;}if(p.optString("scope","all").equals("all"))return true;rows=scoped(p,personal);for(int i=0;i<rows.length();i++){JSONObject song=rows.optJSONObject(i);if(song!=null&&songKey(song).equals(songKey(track)))return true;}return false;}
    static double reducePenalty(JSONObject track,JSONObject p){double value=0;JSONArray rows=p.optJSONArray("excluded");if(rows==null)return 0;for(int i=0;i<rows.length();i++){JSONObject row=rows.optJSONObject(i);if(row==null||!row.optString("effect").equals("reduce"))continue;String kind=row.optString("kind"),key=row.optString("key");boolean match=kind.equals("song")&&key.equals(songKey(track))||kind.equals("version")&&key.equals(versionKey(track));if(kind.equals("artist"))for(String artist:track.optString("artist").split("\\s*[/、&＋+]\\s*"))if(normal(artist).equals(key))match=true;if(match)value+=50;}return value;}

}
