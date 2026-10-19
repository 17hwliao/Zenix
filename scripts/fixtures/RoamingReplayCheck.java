package com.zenix.musicplayer;
import org.json.*;
public final class RoamingReplayCheck {
 static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
 static JSONObject song(int id){JSONObject value=MobilePlaybackContractCheck.track("healthy");Json.put(value,"id","song-"+id);Json.put(value,"title","Song "+id);return value;}
 public static void main(String[] args){RoamingHistory history=new RoamingHistory();check(history.previous("")==null,"first roaming has no previous song");
  for(int i=1;i<=5;i++){history.record(song(i));JSONArray before=history.before("song-"+i);check(before.length()==Math.min(3,i-1),"retain at most three heard songs");}
  JSONArray before=history.before("song-5");check(before.getJSONObject(0).optString("id").equals("song-2")&&before.getJSONObject(2).optString("id").equals("song-4"),"fifth song retains songs two three four");
  for(int i=4;i>=2;i--){JSONObject previous=history.previous("song-"+(i+1));check(previous.optString("id").equals("song-"+i),"previous replays the actual prior song");history.record(previous);}
  check(history.previous("song-2")==null&&!history.has("song-1"),"bounded history cannot replay evicted song");
  for(int i=3;i<=5;i++){JSONObject next=history.next("song-"+(i-1));check(next.optString("id").equals("song-"+i),"replay reconnects to existing roaming sequence");history.record(next);}
  check(history.next("song-5")==null,"resume recommendations after replayed sequence");history.record(song(6));check(history.before("song-6").getJSONObject(0).optString("id").equals("song-3"),"replaying did not consume history slots");
  check(history.previous("loading-new-song").optString("id").equals("song-6"),"failed or pending new selection is not a heard song");history.clear();check(history.previous("")==null,"new roaming session resets replay window");
  System.out.println("ROAMING_REPLAY_PASS");
 }
}
