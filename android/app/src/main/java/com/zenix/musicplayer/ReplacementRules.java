package com.zenix.musicplayer;
import org.json.*;
import java.util.*;
import java.text.Normalizer;

/** Matches catalogue identities, never temporary URLs. Kept in parity with platformReplacement.cjs. */
final class ReplacementRules {
    private static final Set<String> LX_PLATFORMS=Set.of("kw","kg","wy","tx","mg");
    static String text(String s){return Normalizer.normalize(s,Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[\\u200b-\\u200d\\ufeff]","").trim().replaceAll("\\s+"," ");}
    static String title(String s){return text(s).replaceAll("[\\s\\p{P}]","");}
    static String recordingTitle(String s){java.util.regex.Matcher m=java.util.regex.Pattern.compile("\\([^)]*\\)|\\[[^\\]]*\\]|【[^】]*】").matcher(text(s));StringBuffer value=new StringBuffer();while(m.find())m.appendReplacement(value,java.util.regex.Matcher.quoteReplacement(edition(m.group()).isEmpty()?m.group():""));m.appendTail(value);return title(value.toString());}
    static String artist(String s){String[] parts=text(s).split("、|,|，|&|／|/|;|；|\\s+(?:feat\\.?|ft\\.?|and)\\s+");List<String> values=new ArrayList<>();for(String part:parts)if(!title(part).isEmpty())values.add(title(part));Collections.sort(values);return String.join("|",values);}
    static String edition(String s){java.util.regex.Matcher m=java.util.regex.Pattern.compile("live|现场|翻唱|cover|伴奏|instrumental|remix|加速|sped\\s*up|慢速|slowed|acoustic|不插电|demo|remaster(?:ed)?").matcher(text(s));Set<String> values=new TreeSet<>();Map<String,String> names=Map.of("现场","live","翻唱","cover","伴奏","instrumental","加速","spedup","sped up","spedup","慢速","slowed","不插电","acoustic","remastered","remaster");while(m.find())values.add(names.getOrDefault(m.group(),m.group()));return String.join("|",values);}
    static int rank(JSONObject original,JSONObject candidate){
        if(original.optString("title").isEmpty()||original.optString("artist").isEmpty()||candidate.optString("remoteId").isEmpty()||candidate.optString("providerId").isEmpty()||!candidate.optString("source").equals("custom"))return 0;
        if(!recordingTitle(original.optString("title")).equals(recordingTitle(candidate.optString("title")))||!artist(original.optString("artist")).equals(artist(candidate.optString("artist"))))return 0;
        if(!edition(original.optString("title")).equals(edition(candidate.optString("title"))))return 1;
        double a=original.optDouble("duration"),b=candidate.optDouble("duration");if(!(a>0&&b>0)||Math.abs(a-b)>3)return 1;
        if(!original.optString("album").isEmpty()&&!candidate.optString("album").isEmpty()&&!title(original.optString("album")).equals(title(candidate.optString("album"))))return 1;
        return text(original.optString("title")).equals(text(candidate.optString("title")))&&text(original.optString("artist")).equals(text(candidate.optString("artist")))?3:2;
    }
    static String key(JSONObject song){return song.optString("providerId")+"\n"+song.optString("remoteId");}
    /**
     * Normal sources keep their provider boundary. LX identity is only enabled
     * after the caller confirms that the provider is an LX music source.
     */
    static String recordingKey(JSONObject song){return key(song);}
    /** LX scripts sharing a catalog can resolve the same recording under different installation IDs. */
    static String recordingKey(JSONObject song,boolean lxCompatible){
        if(song==null)return "\n";
        if(!lxCompatible)return key(song);
        try{
            String encoded=song.optString("remoteId");
            if(encoded.length()>6000)return "lx-invalid\0"+key(song);
            String normalized=encoded.replace('-','+').replace('_','/');
            normalized+= "=".repeat((4-normalized.length()%4)%4);
            JSONObject info=new JSONObject(new String(Base64.getDecoder().decode(normalized),java.nio.charset.StandardCharsets.UTF_8));
            String source=info.optString("source");Object rawKey=info.opt("songmid");
            String key=rawKey instanceof String?(String)rawKey:rawKey instanceof Number?String.valueOf(rawKey):"";
            if(LX_PLATFORMS.contains(source)&&!key.isEmpty()&&key.length()<=250&&key.chars().noneMatch(Character::isISOControl))
                return "lx\0"+source+"\0"+key;
        }catch(Exception ignored){}
        return "lx-invalid\0"+key(song);
    }
    static boolean cacheMatches(JSONObject song,JSONObject saved,JSONObject personal){
        if(saved==null)return false;JSONObject target=null;JSONArray lists=personal==null?null:personal.optJSONArray("playlists");
        if(lists!=null)for(int i=0;i<lists.length();i++){JSONObject list=lists.optJSONObject(i);if(!list.optString("id").equals(song.optString("playlistId")))continue;JSONArray tracks=list.optJSONArray("tracks");if(tracks!=null)for(int j=0;j<tracks.length();j++){JSONObject track=tracks.optJSONObject(j);if(track.optString("id").equals(song.optString("id"))){JSONObject state=track.optJSONObject("replacement");target=state==null?null:state.optJSONObject("target");break;}}break;}
        String cached=saved.optString("replacementKey");
        return target==null?cached.isEmpty():!song.optString("playlistId").isEmpty()&&song.optString("playlistId").equals(saved.optString("cachePlaylistId"))&&key(target).equals(cached);
    }
    static JSONObject target(JSONObject song)throws Exception{
        if(song==null||!song.optString("source").equals("custom")||song.optString("providerId").isEmpty()||song.optString("providerId").length()>240||song.optString("remoteId").isEmpty()||song.optString("remoteId").length()>32768||!song.has("id")||!song.has("title"))throw new Exception("替代歌曲信息无效");
        double duration=song.optDouble("duration",0);return Json.obj("id",clip(song.optString("id"),32768),"title",clip(song.optString("title"),300),"artist",clip(song.optString("artist"),300),"album",clip(song.optString("album"),300),"duration",Double.isFinite(duration)?Math.min(86400,Math.max(0,duration)):0,"source","custom","providerId",song.getString("providerId"),"remoteId",song.getString("remoteId"),"path","","audioUrl","");
    }
    static String clip(String value,int size){return value.substring(0,Math.min(size,value.length()));}
    static JSONObject state(JSONObject value)throws Exception{
        if(value==null)return null;String status=value.optString("status");int attempts=value.optInt("attempts",-1);
        if(!Set.of("pending","verified","failed","needsChoice","original").contains(status)||attempts<0||attempts>3)throw new Exception("平替状态无效");
        JSONArray candidates=new JSONArray(),tried=new JSONArray(),rows=value.optJSONArray("candidates"),keys=value.optJSONArray("tried");
        if(rows!=null)for(int i=0;i<rows.length()&&i<12;i++)candidates.put(target(rows.getJSONObject(i)));
        if(keys!=null)for(int i=0;i<keys.length()&&i<3;i++)tried.put(clip(keys.optString(i),34000));
        JSONObject clean=Json.obj("status",status,"attempts",attempts,"tried",tried,"candidates",candidates,"message",clip(value.optString("message"),300));if(value.opt("roundComplete") instanceof Boolean)Json.put(clean,"roundComplete",value.optBoolean("roundComplete"));if(value.optJSONObject("target")!=null)Json.put(clean,"target",target(value.getJSONObject("target")));return clean;
    }
    static boolean complete(JSONObject state){return state!=null&&state.optString("status").equals("failed")&&state.optJSONObject("target")==null&&(state.optBoolean("roundComplete")||!state.has("roundComplete")&&Set.of("本轮3次尝试已用完","搜索结果中没有可播放的替代版本").contains(state.optString("message")));}
    static JSONObject empty(){return Json.obj("status","failed","attempts",0,"tried",new JSONArray(),"candidates",new JSONArray(),"message","");}
    static void edit(JSONObject source,JSONObject args)throws Exception{
        String edit=args.optString("edit");JSONArray tracks=source.getJSONArray("tracks");
        if(edit.equals("replacementPolicy")){Json.put(source,"autoReplacement",args.optBoolean("enabled"));return;}
        if(edit.equals("replacementClear")){for(int i=0;i<tracks.length();i++)tracks.getJSONObject(i).remove("replacement");return;}
        for(int i=0;i<tracks.length();i++){JSONObject song=tracks.getJSONObject(i);if(!song.optString("id").equals(args.optString("trackId")))continue;
            // JSONObject ordering differs across platforms: compare parsed structures.
            String expected=args.optString("expectedReplacement","null");Object old=song.opt("replacement");
            Object parsed=new JSONTokener(expected).nextValue();if(!equivalent(old,parsed))throw new Exception("平替状态已变化，请刷新后重试");
            if(args.optJSONObject("state")==null)song.remove("replacement");else Json.put(song,"replacement",state(args.getJSONObject("state")));return;
        }throw new Exception("歌曲已移出歌单");
    }
    static boolean equivalent(Object a,Object b){if(a==null||a==JSONObject.NULL)return b==null||b==JSONObject.NULL;if(a instanceof JSONObject&&b instanceof JSONObject){JSONObject x=(JSONObject)a,y=(JSONObject)b;if(x.length()!=y.length())return false;for(Iterator<String> keys=x.keys();keys.hasNext();){String key=keys.next();if(!y.has(key)||!equivalent(x.opt(key),y.opt(key)))return false;}return true;}if(a instanceof JSONArray&&b instanceof JSONArray){JSONArray x=(JSONArray)a,y=(JSONArray)b;if(x.length()!=y.length())return false;for(int i=0;i<x.length();i++)if(!equivalent(x.opt(i),y.opt(i)))return false;return true;}return a instanceof Number&&b instanceof Number?Double.compare(((Number)a).doubleValue(),((Number)b).doubleValue())==0:a.equals(b);}
}
