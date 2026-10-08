package com.zenix.musicplayer;

import org.json.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Versioned, metadata-only exchange. Never serialize device paths or credentials. */
final class PlaylistExchange {
    static final int MAX_BYTES=2*1024*1024;
    static String string(JSONObject value,String key,int limit)throws Exception {Object raw=value.opt(key);if(raw==null||raw==JSONObject.NULL)return "";if(!(raw instanceof String))throw new Exception("歌曲字段类型无效");String text=((String)raw).trim();return text.substring(0,Math.min(limit,text.length()));}
    static JSONObject track(JSONObject value)throws Exception {
        String title=string(value,"title",300);if(title.isEmpty())throw new Exception("歌曲名称不能为空");
        String source=value.optString("source").equals("custom")?"custom":"local";
        double duration=value.optDouble("duration",0);if(!Double.isFinite(duration)||duration<0)duration=0;
        JSONObject clean=Json.obj("title",title,"artist",string(value,"artist",300),"album",string(value,"album",300),"duration",Math.min(duration,86400),"source",source);
        if(source.equals("custom")){String id=string(value,"id",32768),remoteId=string(value,"remoteId",32768);if(id.isEmpty()||remoteId.isEmpty())throw new Exception("在线歌曲缺少音源标识");Json.put(clean,"id",id);Json.put(clean,"remoteId",remoteId);Json.put(clean,"providerId",string(value,"providerId",240));}return clean;
    }
    static JSONObject validate(JSONObject value)throws Exception {
        JSONArray lists=value.optJSONArray("playlists");if(!value.optString("format").equals("zenix-playlist")||value.optInt("schemaVersion")!=1||lists==null||lists.length()<1||lists.length()>100)throw new Exception("请选择有效的 .zenixlist 歌单文件（格式版本 1）");
        JSONArray clean=new JSONArray();int count=0;
        for(int i=0;i<lists.length();i++){JSONObject list=lists.getJSONObject(i);Object nameValue=list.opt("name");if(!(nameValue instanceof String))throw new Exception("歌单名称无效");String name=((String)nameValue).trim();JSONArray tracks=list.optJSONArray("tracks");if(name.isEmpty()||((String)nameValue).length()>100||tracks==null)throw new Exception("歌单名称或列表无效");count+=tracks.length();if(count>5000)throw new Exception("一次最多分享 5000 首歌曲");JSONArray songs=new JSONArray();for(int j=0;j<tracks.length();j++)songs.put(track(tracks.getJSONObject(j)));clean.put(Json.obj("name",name,"tracks",songs));}
        JSONObject result=Json.obj("format","zenix-playlist","schemaVersion",1,"playlists",clean);if(result.toString().getBytes(StandardCharsets.UTF_8).length>MAX_BYTES)throw new Exception("歌单文件不能超过 2 MiB");return result;
    }
    static JSONObject decode(String text)throws Exception {if(text.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES)throw new Exception("歌单文件不能超过 2 MiB");return validate(new JSONObject(text.startsWith("\uFEFF")?text.substring(1):text));}
    static JSONObject bundle(PrivateStore store,JSONArray ids)throws Exception {
        if(ids==null||ids.length()<1||ids.length()>100)throw new Exception("请先选择歌单");Set<String> selected=new HashSet<>();for(int i=0;i<ids.length();i++)selected.add(ids.getString(i));
        JSONArray all=store.object("personal").getJSONArray("playlists"),lists=new JSONArray();for(int i=0;i<all.length();i++){JSONObject list=all.getJSONObject(i);if(selected.remove(list.optString("id")))lists.put(list);}if(!selected.isEmpty())throw new Exception("歌单已变化，请重新选择");return validate(Json.obj("format","zenix-playlist","schemaVersion",1,"playlists",lists));
    }
    private static String key(JSONObject value){return java.text.Normalizer.normalize(value.optString("title")+"\u0000"+value.optString("artist")+"\u0000"+value.optString("album"),java.text.Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);}
    static JSONArray restore(JSONObject bundle,JSONArray local)throws Exception {
        Map<String,JSONObject> library=new HashMap<>();if(local!=null)for(int i=0;i<local.length();i++){JSONObject song=local.getJSONObject(i);library.put(key(song),song);}
        JSONArray result=new JSONArray(),lists=bundle.getJSONArray("playlists");
        for(int i=0;i<lists.length();i++){JSONObject list=lists.getJSONObject(i);JSONArray tracks=list.getJSONArray("tracks"),songs=new JSONArray();for(int j=0;j<tracks.length();j++){JSONObject song=Json.copy(tracks.getJSONObject(j));if(song.optString("source").equals("custom")){Json.put(song,"audioUrl","");Json.put(song,"path","");}else{JSONObject match=library.get(key(song));if(match!=null&&(song.optDouble("duration")==0||match.optDouble("duration")==0||Math.abs(song.optDouble("duration")-match.optDouble("duration"))<=3))song=Json.copy(match);else{Json.put(song,"id","shared-local:"+MusicSources.sha(key(song)).substring(0,24));Json.put(song,"path","");Json.put(song,"audioUrl","");Json.put(song,"availability","unavailable");}}songs.put(song);}result.put(Json.obj("name",list.getString("name"),"tracks",songs));}return result;
    }
}
