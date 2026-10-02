package com.zenix.musicplayer;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

final class PrivateStore {
    private final AtomicFile file;
    private JSONObject data;
    PrivateStore(Context context) {
        file=new AtomicFile(new File(context.getFilesDir(),"zenix.json"));
        try { data=new JSONObject(new String(file.readFully(),StandardCharsets.UTF_8)); }
        catch(Exception ignored) { data=Json.obj("personal",Json.obj("liked",new JSONArray(),"favorites",new JSONArray(),"history",new JSONArray(),"playlists",new JSONArray()),"sources",new JSONArray(),"queue",new JSONArray(),"profile",Json.obj("name","Zenix","bio","你的音乐，自成宇宙。"),"cacheLimitMiB",512,"cacheEnabled",true); }
    }
    synchronized JSONObject read() { return Json.copy(data); }
    synchronized JSONObject object(String key) { JSONObject value=data.optJSONObject(key); return value==null?null:Json.copy(value); }
    synchronized void set(String key,Object value) throws IOException {
        Object detached=value;
        try{if(value instanceof JSONObject)detached=Json.copy((JSONObject)value);else if(value instanceof JSONArray)detached=new JSONArray(value.toString());}catch(JSONException e){throw new IOException("无法保存数据",e);}
        JSONObject next=Json.copy(data); Json.put(next,key,detached); FileOutputStream output=null;
        try { output=file.startWrite(); output.write(next.toString().getBytes(StandardCharsets.UTF_8)); file.finishWrite(output); data=next; }
        catch(IOException e) { if(output!=null) file.failWrite(output); throw e; }
    }
    synchronized int integer(String key,int fallback){return data.optInt(key,fallback);}
    synchronized JSONObject personal(String action,JSONObject args) throws Exception {
        JSONObject personal=data.getJSONObject("personal"); personal=Json.copy(personal);
        String kind=args.optString("kind"), id=args.optString("id"); JSONObject track=args.optJSONObject("track");
        if(action.equals("toggle")) {
            if(!kind.equals("liked")&&!kind.equals("favorites")) throw new Exception("无效收藏类型");
            JSONArray values=personal.getJSONArray(kind); JSONArray next=new JSONArray(); boolean found=false;
            for(int i=0;i<values.length();i++) { JSONObject v=values.getJSONObject(i); if(v.optString("id").equals(track.getString("id"))) found=true; else next.put(v); }
            if(!found) next.put(cleanTrack(track)); Json.put(personal,kind,next);
        } else if(action.equals("record")) {
            JSONArray values=personal.getJSONArray("history"),next=new JSONArray(); next.put(Json.obj("id",track.getString("id"),"track",cleanTrack(track),"playedAt",System.currentTimeMillis()));
            for(int i=0;i<values.length()&&next.length()<300;i++) { JSONObject v=values.getJSONObject(i); if(!v.getJSONObject("track").optString("id").equals(track.optString("id"))) next.put(v); }
            Json.put(personal,"history",next);
        } else if(action.equals("createPlaylist")) {
            String name=args.optString("name").trim(); if(name.isEmpty()||name.length()>80) throw new Exception("请填写 1–80 字的歌单名称");
            personal.getJSONArray("playlists").put(Json.obj("id","list-"+java.util.UUID.randomUUID(),"name",name,"tracks",track==null ? new JSONArray() : Json.array(cleanTrack(track))));
        } else if(action.equals("removeSaved")) {
            if(!kind.equals("liked")&&!kind.equals("favorites")&&!kind.equals("history")) throw new Exception("无效列表");
            JSONArray values=personal.getJSONArray(kind),next=new JSONArray();
            for(int i=0;i<values.length();i++) if(!values.getJSONObject(i).optString("id").equals(id)) next.put(values.get(i)); Json.put(personal,kind,next);
        } else {
            JSONArray lists=personal.getJSONArray("playlists"),next=new JSONArray(); boolean found=false;
            for(int i=0;i<lists.length();i++) {
                JSONObject list=lists.getJSONObject(i);
                if(list.optString("id").equals(id)) {
                    found=true;
                    if(action.equals("deletePlaylist")) continue;
                    if(action.equals("renamePlaylist")) { String name=args.optString("name").trim(); if(name.isEmpty()||name.length()>80) throw new Exception("请填写歌单名称"); Json.put(list,"name",name); }
                    else {
                        JSONArray tracks=list.getJSONArray("tracks"),clean=new JSONArray();
                        String trackId=track==null ? args.optString("trackId") : track.optString("id");
                        for(int j=0;j<tracks.length();j++) if(!tracks.getJSONObject(j).optString("id").equals(trackId)) clean.put(tracks.get(j));
                        if(action.equals("addToPlaylist")) clean.put(cleanTrack(track));
                        else if(!action.equals("removeFromPlaylist")) throw new Exception("未知歌单操作");
                        Json.put(list,"tracks",clean);
                    }
                }
                next.put(list);
            }
            if(!found) throw new Exception("歌单不存在"); Json.put(personal,"playlists",next);
        }
        set("personal",personal); return Json.copy(personal);
    }
    static JSONObject cleanTrack(JSONObject track) {
        JSONObject value=Json.copy(track);
        if(!value.optString("source").equals("local")) { Json.put(value,"audioUrl",""); value.remove("headers"); value.remove("resolvedUrl"); }
        return value;
    }
    synchronized void artwork(String id,String url)throws IOException {JSONObject personal=Json.copy(data.optJSONObject("personal"));coverTree(personal,id,url);set("personal",personal);}
    private static void coverTree(Object value,String id,String url){if(value instanceof JSONObject){JSONObject object=(JSONObject)value;if(object.has("title")&&object.optString("id").equals(id))Json.put(object,"coverUrl",url);for(java.util.Iterator<String> keys=object.keys();keys.hasNext();)coverTree(object.opt(keys.next()),id,url);}else if(value instanceof JSONArray){JSONArray array=(JSONArray)value;for(int i=0;i<array.length();i++)coverTree(array.opt(i),id,url);}}
}
