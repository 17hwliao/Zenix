package com.zenix.musicplayer;
import org.json.*;
public class SpaceFeaturesCheck {
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 public static void main(String[] args)throws Exception{
  JSONObject a=Json.obj("id","a","title","如果的事","artist","测试歌手","providerId","qq","remoteId","one","audioUrl","secret","path","private"),b=Json.copy(a);Json.put(b,"remoteId","two");
  JSONObject raw=Json.obj("motion","light","bookmarks",Json.array(Json.obj("id","b","name","空间","selectedId","a","camera",Json.obj("scale",99),"tracks",Json.array(a)))),clean=SpaceFeatureCommands.clean(raw);
  check(!clean.toString().contains("secret")&&!clean.toString().contains("private"),"space references strip paths and URLs");check(clean.getJSONArray("bookmarks").getJSONObject(0).getJSONObject("camera").getDouble("scale")==2.5,"clamped scale");
  JSONObject p=SpaceFeatureCommands.clean(Json.obj("roaming",Json.obj("scope","playlist","playlistId","list","excluded",Json.array(Json.obj("kind","version","key",SpaceFeatureCommands.versionKey(a)))))).getJSONObject("roaming"),personal=Json.obj("playlists",Json.array(Json.obj("id","list","tracks",Json.array(a))));
  check(!SpaceFeatureCommands.allows(a,p,personal),"excluded recording");check(SpaceFeatureCommands.allows(b,p,personal),"other version allowed in scoped song");Json.put(b,"title","别的歌");check(!SpaceFeatureCommands.allows(b,p,personal),"scope cannot leak");
  ZenixRuntime runtime=new ZenixRuntime();SpaceFeatureCommands.invoke(runtime,Json.obj("action","save","value",clean));check(((JSONObject)SpaceFeatureCommands.invoke(runtime,Json.obj("action","read"))).optString("motion").equals("light"),"persisted state");boolean conflict=false;try{SpaceFeatureCommands.invoke(runtime,Json.obj("action","save","value",clean));}catch(Exception expected){conflict=true;}check(conflict,"stale settings cannot overwrite newer revision");System.out.println("SPACE_FEATURES_PASS");
 }
}
class PrivateStore {JSONObject value;JSONObject object(String key){return value;}<T>T backupLocked(java.util.concurrent.Callable<T> action)throws Exception{return action.call();}void replaceAtomic(JSONObject changes){value=Json.copy(changes.optJSONObject("spaceFeatures"));}}
class PlaybackService {Object spaceFeature(JSONObject args){return Json.obj("branch",false);}}
class ZenixRuntime {PrivateStore store=new PrivateStore();PlaybackService service=new PlaybackService();}
