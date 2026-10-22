package com.zenix.musicplayer;
import org.json.*;
final class PersonalFeaturesCheck {
  static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
  public static void main(String[] args)throws Exception{
    PrivateStore store=new PrivateStore();PersonalFeatures features=new PersonalFeatures(store);
    JSONObject track=Json.obj("id","song","title","像风一样","artist","歌手","source","custom","providerId","qq","remoteId","one","duration",200,"audioUrl","https://private/?token=secret","path","private-path");
    JSONObject added=(JSONObject)features.invoke(Json.obj("action","bookmarkAdd","track",track,"seconds",42,"note","毕业旅行"));check(added.getJSONArray("bookmarks").length()==1,"bookmark saved");check(!added.toString().contains("secret"),"transport credentials omitted");
    features.invoke(Json.obj("action","lyricsSave","track",track,"text","[00:12.30]像风一样自由"));JSONArray found=(JSONArray)features.invoke(Json.obj("action","search","query","一样自由"));check(found.getJSONObject(0).getDouble("seconds")==12.3,"timestamp lyrics found");
    String backup=(String)features.invoke(Json.obj("action","backupExport"));JSONObject decoded=BackupFormat.decode(backup);check(decoded.getJSONObject("extensions").getJSONObject("personalFeatures").getJSONArray("bookmarks").length()==1,"portable backup extension preserved");
    JSONObject preview=(JSONObject)features.invoke(Json.obj("action","backupPreview","text",backup));features.invoke(Json.obj("action","bookmarkAdd","track",track,"seconds",50,"note","later"));try{features.invoke(Json.obj("action","backupApply","token",preview.getString("token")));throw new AssertionError("stale import accepted");}catch(AssertionError error){throw error;}catch(Exception expected){}
    JSONObject before=store.object("personal"),after=Json.copy(before);Json.put(after,"playlists",Json.array(Json.obj("id","one","name","new","tracks",Json.array(track))));JSONObject state=PersonalFeatureFormat.record(store.object("personalFeatures"),before,after,"create");store.replaceAtomic(Json.obj("personal",after,"personalFeatures",state));String change=state.getJSONArray("journal").getJSONObject(0).getString("id");
    JSONObject newer=store.object("personal");newer.getJSONArray("liked").put(track);newer.getJSONArray("playlists").put(Json.obj("id","two","name","later","tracks",new JSONArray()));store.replaceAtomic(Json.obj("personal",newer));features.invoke(Json.obj("action","undo","id",change));check(store.object("personal").getJSONArray("liked").length()==1,"undo retains later favorite");check(store.object("personal").getJSONArray("playlists").getJSONObject(0).getString("id").equals("two"),"undo retains unrelated playlist");
    int count=store.object("personalFeatures").getJSONArray("bookmarks").length();store.fail=true;try{features.invoke(Json.obj("action","bookmarkAdd","track",track,"seconds",60));throw new AssertionError("failed write accepted");}catch(AssertionError error){throw error;}catch(Exception expected){}store.fail=false;check(store.object("personalFeatures").getJSONArray("bookmarks").length()==count,"write failure preserves stored bookmarks");
    features.invoke(Json.obj("action","collectionAdd","kind","favorites","track",track));features.invoke(Json.obj("action","collectionAdd","kind","favorites","track",track));check(store.object("personal").getJSONArray("favorites").length()==1,"repeat sync cannot toggle off existing favorite");
    JSONObject failed=Json.copy(track);Json.put(failed,"remoteId","different");store.fail=true;try{features.invoke(Json.obj("action","collectionAdd","kind","favorites","track",failed));throw new AssertionError("failed sync accepted");}catch(AssertionError error){throw error;}catch(Exception expected){}store.fail=false;check(store.object("personal").getJSONArray("favorites").length()==1,"failed sync preserves existing favorites");
    System.out.println("PERSONAL_FEATURES_PASS");
  }
}
final class PrivateStore {
  JSONObject data=Json.obj("personal",Json.obj("liked",new JSONArray(),"favorites",new JSONArray(),"history",new JSONArray(),"playlists",new JSONArray()));boolean fail;
  synchronized JSONObject object(String key){return data.optJSONObject(key)==null?null:Json.copy(data.optJSONObject(key));}
  synchronized JSONObject readKeys(String... keys){JSONObject result=new JSONObject();for(String key:keys)if(data.has(key))Json.put(result,key,data.opt(key));return result;}
  synchronized <T>T backupLocked(java.util.concurrent.Callable<T> action)throws Exception{return action.call();}
  synchronized void replaceAtomic(JSONObject changes)throws Exception{if(fail)throw new Exception("disk full");JSONObject next=Json.copy(data);for(java.util.Iterator<String> keys=changes.keys();keys.hasNext();){String key=keys.next();Json.put(next,key,changes.opt(key));}data=next;}
}
