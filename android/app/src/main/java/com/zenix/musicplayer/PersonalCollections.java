package com.zenix.musicplayer;

import org.json.*;
import java.util.*;

final class PersonalCollections {
    static void addMany(JSONObject personal,JSONArray tracks,JSONArray kinds)throws Exception {
        if(tracks==null||tracks.length()<1||tracks.length()>5000||kinds==null||kinds.length()<1||kinds.length()>2)throw new Exception("请选择 1–5000 首歌曲以及喜欢或收藏");
        Set<String> targets=new HashSet<>();
        for(int i=0;i<kinds.length();i++){String kind=kinds.getString(i);if(!kind.equals("liked")&&!kind.equals("favorites"))throw new Exception("无效收藏类型");targets.add(kind);}
        for(int i=0;i<tracks.length();i++){JSONObject track=tracks.getJSONObject(i);if(track.optString("id").trim().isEmpty()||track.optString("title").trim().isEmpty())throw new Exception("歌曲信息无效");}
        for(String kind:targets){JSONArray values=personal.getJSONArray(kind);Set<String> seen=new HashSet<>();for(int i=0;i<values.length();i++)seen.add(values.getJSONObject(i).getString("id"));for(int i=0;i<tracks.length();i++){JSONObject track=tracks.getJSONObject(i);if(seen.add(track.getString("id")))values.put(Json.copy(track));}}
    }
    static void add(JSONObject personal,JSONObject track,JSONArray kinds)throws Exception {
        if(track==null||track.optString("id").isEmpty()||kinds==null||kinds.length()<1||kinds.length()>2)throw new Exception("请选择喜欢或收藏");
        Set<String> targets=new HashSet<>();
        for(int i=0;i<kinds.length();i++){String kind=kinds.getString(i);if(!kind.equals("liked")&&!kind.equals("favorites"))throw new Exception("无效收藏类型");targets.add(kind);}
        for(String kind:targets){JSONArray values=personal.getJSONArray(kind);boolean exists=false;for(int i=0;i<values.length();i++)if(values.getJSONObject(i).optString("id").equals(track.getString("id")))exists=true;if(!exists)values.put(Json.copy(track));}
    }
}
