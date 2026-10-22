package com.zenix.musicplayer;

import org.json.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.*;

final class PersonalFeatures {
    static final int MAX_BYTES=12*1024*1024;
    private final PrivateStore store;
    private JSONObject pending;private String token;private long previewRevision;
    PersonalFeatures(PrivateStore store){this.store=store;}
    static JSONObject empty(){return PersonalFeatureFormat.empty();}
    static JSONObject reference(JSONObject value)throws Exception{return PersonalFeatureFormat.reference(value);}
    private static String key(JSONObject value){return PersonalFeatureFormat.key(value);}
    static JSONObject clean(JSONObject value)throws Exception{return PersonalFeatureFormat.clean(value);}
    private static String text(Object value,int max)throws Exception{if(!(value instanceof String)||((String)value).length()>max)throw new Exception("私人资料文本无效或过长");return (String)value;}
    private static Map<String,JSONObject> lists(JSONObject personal)throws Exception{Map<String,JSONObject> result=new LinkedHashMap<>();JSONArray values=personal.optJSONArray("playlists");if(values!=null)for(int i=0;i<values.length();i++){JSONObject row=values.getJSONObject(i);result.put(row.getString("id"),row);}return result;}
    static JSONObject record(JSONObject raw,JSONObject before,JSONObject after,String label)throws Exception{
        Map<String,JSONObject> old=lists(before),next=lists(after);Set<String> ids=new LinkedHashSet<>(old.keySet());ids.addAll(next.keySet());JSONArray changes=new JSONArray();
        for(String id:ids)if(!BackupFormat.canonical(old.get(id)).equals(BackupFormat.canonical(next.get(id))))changes.put(Json.obj("id",id,"before",old.get(id)==null?JSONObject.NULL:old.get(id),"after",next.get(id)==null?JSONObject.NULL:next.get(id)));
        if(changes.length()==0)return raw;JSONObject state=clean(raw),entry=Json.obj("id",UUID.randomUUID().toString(),"label",label,"createdAt",System.currentTimeMillis(),"undone",false,"changes",changes);JSONArray journal=new JSONArray().put(entry),previous=state.getJSONArray("journal");for(int i=0;i<previous.length()&&journal.length()<50;i++)journal.put(previous.get(i));Json.put(state,"journal",journal);Json.put(state,"revision",state.optLong("revision")+1);return clean(state);
    }
    private JSONObject read()throws Exception{JSONObject result=clean(store.object("personalFeatures"));String notice=store.readKeys("personalFeaturesNotice").optString("personalFeaturesNotice");if(!notice.isEmpty())Json.put(result,"notice",notice);return result;}
    private JSONObject save(JSONObject value)throws Exception{JSONObject next=clean(value);store.replaceAtomic(Json.obj("personalFeatures",next));return next;}
    private static JSONArray without(JSONArray input,String id)throws Exception{JSONArray result=new JSONArray();for(int i=0;i<input.length();i++)if(!input.getJSONObject(i).optString("id").equals(id))result.put(input.get(i));return result;}
    private static String norm(String value){return java.text.Normalizer.normalize(value,java.text.Normalizer.Form.NFKC).toLowerCase(Locale.ROOT);}
    private static boolean matches(String value,String[] terms){String normalized=norm(value);for(String term:terms)if(!normalized.contains(term))return false;return true;}
    private JSONArray search(JSONObject state,String query)throws Exception{
        JSONArray results=new JSONArray();if(query.trim().isEmpty())return results;String[] terms=norm(query).trim().split("\\s+");JSONArray bookmarks=state.getJSONArray("bookmarks");
        for(int i=0;i<bookmarks.length()&&results.length()<100;i++){JSONObject row=bookmarks.getJSONObject(i),track=row.getJSONObject("track");if(matches(track.optString("title")+" "+track.optString("artist")+" "+row.optString("note")+" "+row.optString("lyric"),terms))results.put(Json.obj("kind","bookmark","track",track,"seconds",row.getDouble("seconds"),"excerpt",row.optString("note").isEmpty()?row.optString("lyric"):row.optString("note"),"id",row.getString("id")));}
        JSONArray lyrics=state.getJSONArray("lyrics");Pattern timing=Pattern.compile("\\[(\\d+):(\\d+(?:\\.\\d+)?)\\]");
        for(int i=0;i<lyrics.length()&&results.length()<100;i++){JSONObject row=lyrics.getJSONObject(i),track=row.getJSONObject("track");for(String line:row.getString("text").split("\\r?\\n")){if(results.length()>=100)break;if(line.trim().isEmpty()||!matches(track.optString("title")+" "+track.optString("artist")+" "+line,terms))continue;Matcher found=timing.matcher(line);Object seconds=found.find()?Double.parseDouble(found.group(1))*60+Double.parseDouble(found.group(2)):JSONObject.NULL;String excerpt=line.replaceAll("\\[[^\\]]*\\]","");results.put(Json.obj("kind","lyric","track",track,"seconds",seconds,"excerpt",excerpt.substring(0,Math.min(500,excerpt.length())),"id",key(track)+":"+results.length()));}}
        JSONObject personal=store.object("personal");List<JSONObject> tracks=new ArrayList<>();for(String kind:List.of("liked","favorites","history")){JSONArray values=personal.optJSONArray(kind);if(values==null)continue;for(int i=0;i<values.length();i++)tracks.add(kind.equals("history")?values.getJSONObject(i).getJSONObject("track"):values.getJSONObject(i));}for(JSONObject list:lists(personal).values()){JSONArray values=list.getJSONArray("tracks");for(int i=0;i<values.length();i++)tracks.add(values.getJSONObject(i));}
        Set<String> seen=new HashSet<>();for(JSONObject track:tracks){if(results.length()>=100)break;String id=key(track);if(seen.add(id)&&matches(track.optString("title")+" "+track.optString("artist")+" "+track.optString("album"),terms))results.put(Json.obj("kind","track","track",reference(track),"seconds",JSONObject.NULL,"excerpt",track.optString("album"),"id",id));}return results;
    }
    private JSONObject undo(JSONObject state,String id)throws Exception{
        JSONArray journal=state.getJSONArray("journal");JSONObject row=null;for(int i=0;i<journal.length();i++)if(journal.getJSONObject(i).optString("id").equals(id))row=journal.getJSONObject(i);if(row==null||row.optBoolean("undone"))throw new Exception("此操作不存在或已经撤销");JSONObject personal=store.object("personal");Map<String,JSONObject> current=lists(personal);JSONArray changes=row.getJSONArray("changes");
        for(int i=0;i<changes.length();i++){JSONObject change=changes.getJSONObject(i);if(!BackupFormat.canonical(current.get(change.getString("id"))).equals(BackupFormat.canonical(change.isNull("after")?null:change.getJSONObject("after"))))throw new Exception("相关歌单已有后续修改，已保留当前资料，不能直接撤销");}
        for(int i=0;i<changes.length();i++){JSONObject change=changes.getJSONObject(i);if(change.isNull("before"))current.remove(change.getString("id"));else current.put(change.getString("id"),change.getJSONObject("before"));}
        JSONArray output=new JSONArray();Set<String> names=new HashSet<>();for(JSONObject list:current.values()){if(!names.add(norm(list.optString("name"))))throw new Exception("恢复后会产生同名歌单，请先调整名称");output.put(list);}Json.put(personal,"playlists",output);Json.put(row,"undone",true);Json.put(state,"revision",state.optLong("revision")+1);store.replaceAtomic(Json.obj("personal",personal,"personalFeatures",clean(state)));return state;
    }
    synchronized Object invoke(JSONObject args)throws Exception{return store.backupLocked(()->{JSONObject state=read();String action=args.optString("action");
        switch(action){
            case "read":return state;
            case "collectionAdd":{String kind=args.optString("kind");if(!Set.of("liked","favorites").contains(kind))throw new Exception("收藏分类无效");JSONObject track=reference(args.getJSONObject("track"));if(track.optString("source").equals("local")||track.optString("remoteId").isEmpty())throw new Exception("跨端收藏需要有效在线歌曲引用");JSONObject personal=store.object("personal");JSONArray old=personal.getJSONArray(kind);for(int i=0;i<old.length();i++)if(key(old.getJSONObject(i)).equals(key(track)))return personal;Json.put(track,"path","");Json.put(track,"audioUrl","");JSONArray next=new JSONArray().put(track);for(int i=0;i<old.length();i++)next.put(old.get(i));Json.put(personal,kind,next);store.replaceAtomic(Json.obj("personal",personal));return personal;}
            case "search":return search(state,text(args.optString("query"),500));
            case "bookmarkAdd":{JSONObject row=Json.obj("id",UUID.randomUUID().toString(),"track",reference(args.getJSONObject("track")),"seconds",args.getDouble("seconds"),"note",args.optString("note"),"lyric",args.optString("lyric"),"createdAt",System.currentTimeMillis());JSONArray values=new JSONArray().put(row),old=state.getJSONArray("bookmarks");for(int i=0;i<old.length();i++)values.put(old.get(i));Json.put(state,"bookmarks",values);break;}
            case "bookmarkDelete":Json.put(state,"bookmarks",without(state.getJSONArray("bookmarks"),args.optString("id")));break;
            case "lyricsSave":{JSONObject track=reference(args.getJSONObject("track"));JSONArray old=state.getJSONArray("lyrics"),values=new JSONArray().put(Json.obj("track",track,"text",text(args.opt("text"),120000),"updatedAt",System.currentTimeMillis()));for(int i=0;i<old.length()&&values.length()<1000;i++)if(!key(old.getJSONObject(i).getJSONObject("track")).equals(key(track)))values.put(old.get(i));Json.put(state,"lyrics",values);break;}
            case "undo":return undo(state,args.optString("id"));
            case "backupExport":{JSONObject exported=Json.copy(state);Json.put(exported,"journal",new JSONArray());String payload=Json.obj("personal",new JSONObject(),"extensions",Json.obj("personalFeatures",exported)).toString();return Json.obj("format","zenix-backup","schemaVersion",1,"createdAt",System.currentTimeMillis(),"payload",payload,"sha256",BackupFormat.sha(payload)).toString();}
            case "backupPreview":{String input=text(args.opt("text"),MAX_BYTES);if(input.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES)throw new Exception("备份超过12 MiB");JSONObject envelope=new JSONObject(input);String payload=envelope.getString("payload");if(!envelope.optString("format").equals("zenix-backup")||envelope.optInt("schemaVersion")!=1||!BackupFormat.sha(payload).equals(envelope.optString("sha256")))throw new Exception("备份格式或完整性校验失败");JSONObject extension=new JSONObject(payload).optJSONObject("extensions");if(extension==null||extension.optJSONObject("personalFeatures")==null)throw new Exception("此备份没有私人书签扩展，请使用常规备份入口恢复歌单");pending=clean(extension.getJSONObject("personalFeatures"));token=UUID.randomUUID().toString();previewRevision=state.optLong("revision");JSONObject preview=mergePreview(state,pending);Json.put(preview,"token",token);return preview;}
            case "backupApply":{if(pending==null||!args.optString("token").equals(token)||state.optLong("revision")!=previewRevision)throw new Exception("资料或预览已变化，请重新预览");JSONObject result=save(merge(state,pending));pending=null;token=null;return result;}
            case "backupDiscard":pending=null;token=null;return true;
            default:throw new Exception("未知私人资料操作");
        }Json.put(state,"revision",state.optLong("revision")+1);return save(state);
    });}
    static JSONObject mergePreview(JSONObject current,JSONObject incoming)throws Exception{return PersonalFeatureFormat.mergePreview(current,incoming);}
    static JSONObject merge(JSONObject current,JSONObject incoming)throws Exception{return PersonalFeatureFormat.merge(current,incoming);}
}
