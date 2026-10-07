package com.zenix.musicplayer;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

final class PrivateStore {
    private final AtomicFile file;
    private JSONObject data;
    private boolean readOnly;
    private final Object diskLock=new Object();
    private final ScheduledExecutorService writer=Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean writeScheduled=new AtomicBoolean();
    private long revision,persistedRevision,presentationRevision;private volatile String writeError="";
    PrivateStore(Context context) {
        file=new AtomicFile(new File(context.getFilesDir(),"zenix.json"));
        try {
            JSONObject envelope=new JSONObject(new String(SourceHttp.bounded(file.openRead(),32*1024*1024),StandardCharsets.UTF_8));
            boolean legacy=!envelope.has("protection");data=legacy?envelope:ProtectedJson.decode(envelope);
            if(data.optJSONObject("personal")==null||data.optJSONArray("sources")==null)throw new IOException("配置结构无效");
            boolean migrated=legacy;JSONArray sources=data.getJSONArray("sources");for(int i=0;i<sources.length();i++){JSONObject source=sources.getJSONObject(i);if(!source.has("networkPolicy")){Json.put(source,"networkPolicy",Json.obj("allowHttp",true,"hosts",JSONObject.NULL));migrated=true;}else Json.put(source,"networkPolicy",SourcePolicy.validate(source.getJSONObject("networkPolicy")));}
            if(migrated){revision=1;scheduleWrite();}
        } catch(FileNotFoundException missing) { data=defaults();if(file.getBaseFile().exists()||new File(file.getBaseFile()+".bak").exists()){readOnly=true;writeError="配置无法读取，已保留原文件并停止写入";} }
        catch(Exception error) { data=defaults();readOnly=true;writeError="配置无法读取或解密，已保留原文件并停止写入："+Json.message(error); }
    }
    private static JSONObject defaults(){return Json.obj("personal",Json.obj("liked",new JSONArray(),"favorites",new JSONArray(),"history",new JSONArray(),"playlists",new JSONArray()),"sources",new JSONArray(),"queue",new JSONArray(),"profile",Json.obj("name","Zenix","bio","你的音乐，自成宇宙。"),"cacheLimitMiB",512,"cacheEnabled",true);}
    synchronized JSONObject read() { return Json.copy(data); }
    synchronized JSONObject readKeys(String... keys){JSONObject selected=new JSONObject();for(String key:keys)if(data.has(key))Json.put(selected,key,data.opt(key));return Json.copy(selected);}
    synchronized long presentationRevision(){return presentationRevision;}
    synchronized JSONObject object(String key) { JSONObject value=data.optJSONObject(key); return value==null?null:Json.copy(value); }
    void set(String key,Object value) throws IOException {synchronized(this){apply(Json.obj(key,value));}flush();}
    private void apply(JSONObject changes)throws IOException {
        if(readOnly)throw new IOException(writeError);
        try{JSONObject detached=new JSONObject(changes.toString());boolean presentationChanged=false;for(java.util.Iterator<String> keys=detached.keys();keys.hasNext();){String key=keys.next();Json.put(data,key,detached.opt(key));if(java.util.Set.of("personal","sources","profile","appearance","localTracks").contains(key))presentationChanged=true;}revision++;if(presentationChanged)presentationRevision++;}catch(JSONException e){throw new IOException("无法保存数据",e);}
    }
    void enqueue(JSONObject changes)throws IOException {synchronized(this){apply(changes);}scheduleWrite();}
    private void scheduleWrite(){if(writeScheduled.compareAndSet(false,true))writer.schedule(()->{try{flush();}catch(IOException e){writeError="配置保存失败，正在重试："+Json.message(e);}finally{writeScheduled.set(false);boolean dirty;synchronized(this){dirty=revision>persistedRevision;}if(dirty)writer.schedule(this::scheduleWrite,1000,TimeUnit.MILLISECONDS);}},25,TimeUnit.MILLISECONDS);}
    private void flush()throws IOException {
        synchronized(diskLock){String snapshot;long selected;synchronized(this){if(persistedRevision==revision)return;snapshot=data.toString();selected=revision;}
            FileOutputStream output=null;try{byte[] encrypted=ProtectedJson.encode(snapshot).getBytes(StandardCharsets.UTF_8);output=file.startWrite();output.write(encrypted);file.finishWrite(output);synchronized(this){persistedRevision=selected;}writeError="";}
            catch(Exception e){if(output!=null)file.failWrite(output);writeError="配置保存失败："+Json.message(e);scheduleWrite();throw new IOException(writeError,e);}
        }
    }
    String error(){return writeError;}
    synchronized JSONArray array(String key) { JSONArray value=data.optJSONArray(key); if(value==null)return null; try{return new JSONArray(value.toString());}catch(JSONException error){throw new IllegalStateException(error);} }
    synchronized int integer(String key,int fallback){return data.optInt(key,fallback);}
    JSONObject personal(String action,JSONObject args)throws Exception {JSONObject result;synchronized(this){result=mutatePersonal(action,args);}flush();return result;}
    private JSONObject mutatePersonal(String action,JSONObject args) throws Exception {
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
        apply(Json.obj("personal",personal)); return Json.copy(personal);
    }
    static JSONObject cleanTrack(JSONObject track) {
        JSONObject value=Json.copy(track);
        if(!value.optString("source").equals("local")) { Json.put(value,"audioUrl",""); value.remove("headers"); value.remove("resolvedUrl"); }
        return value;
    }
    void artwork(String id,String url)throws IOException {synchronized(this){JSONObject personal=Json.copy(data.optJSONObject("personal"));if(!coverTree(personal,id,url))return;apply(Json.obj("personal",personal));}flush();}
    private static boolean coverTree(Object value,String id,String url){boolean changed=false;if(value instanceof JSONObject){JSONObject object=(JSONObject)value;if(object.has("title")&&object.optString("id").equals(id)&&!object.optString("coverUrl").equals(url)){Json.put(object,"coverUrl",url);changed=true;}for(java.util.Iterator<String> keys=object.keys();keys.hasNext();)changed|=coverTree(object.opt(keys.next()),id,url);}else if(value instanceof JSONArray){JSONArray array=(JSONArray)value;for(int i=0;i<array.length();i++)changed|=coverTree(array.opt(i),id,url);}return changed;}
}
