package com.zenix.musicplayer;

import org.json.*;
import java.util.*;

final class PersonalCollections {
    static void add(JSONObject personal,JSONObject track,JSONArray kinds)throws Exception {
        if(track==null||track.optString("id").isEmpty()||kinds==null||kinds.length()<1||kinds.length()>2)throw new Exception("请选择喜欢或收藏");
        Set<String> targets=new HashSet<>();
        for(int i=0;i<kinds.length();i++){String kind=kinds.getString(i);if(!kind.equals("liked")&&!kind.equals("favorites"))throw new Exception("无效收藏类型");targets.add(kind);}
        for(String kind:targets){JSONArray values=personal.getJSONArray(kind);boolean exists=false;for(int i=0;i<values.length();i++)if(values.getJSONObject(i).optString("id").equals(track.getString("id")))exists=true;if(!exists)values.put(Json.copy(track));}
    }
}
