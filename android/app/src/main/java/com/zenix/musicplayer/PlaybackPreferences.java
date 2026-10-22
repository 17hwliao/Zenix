package com.zenix.musicplayer;
import org.json.*;
import java.util.*;
import java.text.Normalizer;

/** Persistent version choice, independent of source credentials and player state. */
final class PlaybackPreferences {
    static String norm(String value){return Normalizer.normalize(value==null?"":value,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[\\s\\p{P}]","");}
    static String key(JSONObject track){return norm(track.optString("title"))+"\n"+norm(track.optString("artist"));}
    static JSONObject clean(JSONObject value){
        if(value==null)value=new JSONObject();String mode=value.optString("mode","any");if(!Set.of("any","original","live","acoustic").contains(mode))mode="any";
        JSONObject choices=new JSONObject(),raw=value.optJSONObject("choices");
        if(raw!=null)for(Iterator<String> it=raw.keys();it.hasNext()&&choices.length()<2000;){String key=it.next();JSONObject row=raw.optJSONObject(key);if(key.length()<=800&&row!=null&&row.optString("providerId").length()<=240&&row.optString("remoteId").length()<=32768)Json.put(choices,key,Json.obj("providerId",row.optString("providerId"),"remoteId",row.optString("remoteId")));}
        JSONObject excluded=new JSONObject(),blocked=value.optJSONObject("excluded");if(blocked!=null)for(Iterator<String> it=blocked.keys();it.hasNext()&&excluded.length()<2000;){String key=it.next();JSONArray rows=blocked.optJSONArray(key),valid=new JSONArray();if(key.length()>800||rows==null)continue;Set<String> seen=new HashSet<>();for(int i=0;i<rows.length()&&valid.length()<30;i++){Object row=rows.opt(i);if(row instanceof String&&((String)row).length()<=34000&&seen.add((String)row))valid.put(row);}if(valid.length()>0)Json.put(excluded,key,valid);}
        JSONObject result=Json.obj("mode",mode,"choices",choices);if(excluded.length()>0)Json.put(result,"excluded",excluded);return result;
    }
    static int score(JSONObject track,JSONObject original,JSONObject prefs){JSONObject choices=prefs.optJSONObject("choices"),remembered=choices==null?null:choices.optJSONObject(key(original));if(remembered!=null&&remembered.optString("providerId").equals(track.optString("providerId"))&&remembered.optString("remoteId").equals(track.optString("remoteId")))return 10000;String title=track.optString("title").toLowerCase(Locale.ROOT),mode=prefs.optString("mode");boolean live=title.matches(".*(?:live|现场).*"),cover=title.matches(".*(?:cover|翻唱|伴奏|instrumental|remix|加速|sped|slowed).*"),acoustic=title.matches(".*(?:acoustic|不插电).*");return (norm(original.optString("artist")).equals(norm(track.optString("artist")))?100:0)+((mode.equals("original")&&!live&&!cover||mode.equals("live")&&live||mode.equals("acoustic")&&acoustic)?30:0);}
    static boolean excluded(JSONObject track,JSONObject original,JSONObject prefs){JSONObject all=prefs.optJSONObject("excluded");JSONArray rows=all==null?null:all.optJSONArray(key(original));String candidate=track.optString("providerId")+"\n"+track.optString("remoteId",track.optString("id"));if(rows!=null)for(int i=0;i<rows.length();i++)if(candidate.equals(rows.optString(i)))return true;return false;}
    static JSONArray order(JSONArray rows,JSONObject original,PrivateStore store){JSONObject prefs=clean(store.object("playbackPreferences"));List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<rows.length();i++)if(rows.optJSONObject(i)!=null&&!excluded(rows.optJSONObject(i),original,prefs))sorted.add(rows.optJSONObject(i));if(!prefs.optString("mode").equals("any")||prefs.optJSONObject("choices").has(key(original)))sorted.sort((a,b)->Integer.compare(score(b,original,prefs),score(a,original,prefs)));JSONArray result=new JSONArray();for(JSONObject row:sorted)result.put(row);return result;}
}
