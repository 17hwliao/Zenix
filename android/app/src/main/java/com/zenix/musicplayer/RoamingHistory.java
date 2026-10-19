package com.zenix.musicplayer;
import org.json.*;
import java.util.*;

/** A bounded replay window, independent of recommendations and the lifetime ledger. */
final class RoamingHistory {
    private final List<JSONObject> entries=new ArrayList<>();private int cursor=-1;
    void clear(){entries.clear();cursor=-1;}
    private int index(String id){for(int i=0;i<entries.size();i++)if(entries.get(i).optString("id").equals(id))return i;return -1;}
    boolean has(String id){return index(id)>=0;}
    JSONObject get(String id){int at=index(id);return at<0?null:Json.copy(entries.get(at));}
    void record(JSONObject song){int at=index(song.optString("id"));if(at>=0){entries.set(at,PrivateStore.cleanTrack(song));cursor=at;return;}while(entries.size()>cursor+1)entries.remove(entries.size()-1);entries.add(PrivateStore.cleanTrack(song));while(entries.size()>4)entries.remove(0);cursor=entries.size()-1;}
    JSONObject previous(String currentId){if(cursor<0)return null;if(!entries.get(cursor).optString("id").equals(currentId))return Json.copy(entries.get(cursor));if(cursor==0)return null;return Json.copy(entries.get(--cursor));}
    JSONObject next(String currentId){if(cursor<0||!entries.get(cursor).optString("id").equals(currentId)||cursor>=entries.size()-1)return null;return Json.copy(entries.get(++cursor));}
    JSONArray before(String currentId){int at=index(currentId);if(at<0)at=cursor+1;JSONArray result=new JSONArray();for(int i=Math.max(0,at-3);i<at;i++)result.put(Json.copy(entries.get(i)));return result;}
    JSONArray after(String currentId){int at=index(currentId);JSONArray result=new JSONArray();if(at>=0)for(int i=at+1;i<entries.size();i++)result.put(Json.copy(entries.get(i)));return result;}
}
