package com.zenix.musicplayer;

import org.json.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Portable original source files only; no user settings, origin URLs or permissions. */
final class SourceShare {
    interface Reader { JSONObject read(JSONObject source) throws Exception; }
    static JSONObject bundle(JSONArray records, Reader reader) throws Exception {
        if(records.length()<1||records.length()>24)throw new Exception("分享包支持 1–24 个音乐源");
        JSONArray sources=new JSONArray();Set<String> seen=new HashSet<>();
        for(int i=0;i<records.length();i++) {
            JSONObject source=records.getJSONObject(i),pack=reader.read(source);String raw=pack.getString("script");
            if(raw.isBlank())throw new Exception("音乐源文件不完整，打包已停止");
            boolean lx=source.optString("kind").equals("lx");
            String text=lx?raw:Json.obj("manifest",pack.getJSONObject("manifest"),"script",raw).toString();
            String label=source.getJSONObject("manifest").optString("name","音乐源");
            if(text.getBytes(StandardCharsets.UTF_8).length>512*1024)throw new Exception(label+"超过分享大小限制（512 KiB）");
            String sha=hash(text);if(!seen.add(sha))continue;
            label=label.replaceAll("[\\\\/:*?\"<>|\\x00-\\x1f]","_");if(label.length()>70)label=label.substring(0,70);
            sources.put(Json.obj("name",label+"-"+hash(source.getString("id")).substring(0,12)+(lx?".js":".zenixsource"),"url","local:"+sha,"local",true,"script",text,"sha256",sha));
        }
        JSONObject result=Json.obj("format","zenix-source-bundle","schemaVersion",1,"name","Zenix 音乐源分享包","sources",sources);
        if(result.toString().getBytes(StandardCharsets.UTF_8).length>8*1024*1024)throw new Exception("分享源包不能超过 8 MiB，请减少音乐源数量");
        return result;
    }
    private static String hash(String text)throws Exception {StringBuilder result=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))result.append(String.format(Locale.ROOT,"%02x",b&255));return result.toString();}
}
