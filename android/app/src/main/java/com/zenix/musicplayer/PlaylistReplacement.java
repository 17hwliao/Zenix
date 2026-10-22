package com.zenix.musicplayer;
import org.json.*;
import java.util.*;
import java.util.function.BooleanSupplier;

/** One imported song/round: three candidate songs; each uses the normal source plan without an elapsed deadline. */
final class PlaylistReplacement {
    static final class Unavailable extends Exception {Unavailable(String message){super(message);}}
    final PrivateStore store;final MusicSources sources;
    PlaylistReplacement(PrivateStore store,MusicSources sources){this.store=store;this.sources=sources;}
    JSONObject[] context(JSONObject song){JSONArray lists=store.object("personal").optJSONArray("playlists");if(lists!=null)for(int i=0;i<lists.length();i++){JSONObject list=lists.optJSONObject(i);if(!list.optString("id").equals(song.optString("playlistId")))continue;JSONArray tracks=list.optJSONArray("tracks");for(int j=0;j<tracks.length();j++)if(tracks.optJSONObject(j).optString("id").equals(song.optString("id")))return new JSONObject[]{list,tracks.optJSONObject(j)};}return null;}
    void save(JSONObject[] ctx,JSONObject previous,JSONObject state)throws Exception{save(ctx,previous,state,()->false);}
    void save(JSONObject[] ctx,JSONObject previous,JSONObject state,BooleanSupplier cancel)throws Exception{store.personal("batchPlaylist",Json.obj("id",ctx[0].getString("id"),"edit","replacement","expected",QueueEdits.ids(ctx[0].getJSONArray("tracks")),"trackId",ctx[1].getString("id"),"expectedReplacement",previous==null?"null":previous.toString(),"state",state),cancel);Json.put(ctx[1],"replacement",state);}
    static void check(BooleanSupplier cancel){if(cancel.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();}
    JSONObject run(JSONObject[] ctx,JSONObject manual,MusicSources.Progress progress,BooleanSupplier cancel)throws Exception{
        return run(ctx,manual,progress,cancel,false);
    }
    JSONObject run(JSONObject[] ctx,JSONObject manual,MusicSources.Progress progress,BooleanSupplier cancel,boolean automatic)throws Exception{
        return run(ctx,manual,progress,cancel,automatic,"high");
    }
    JSONObject run(JSONObject[] ctx,JSONObject manual,MusicSources.Progress progress,BooleanSupplier cancel,boolean automatic,String quality)throws Exception{
        check(cancel);JSONObject original=ctx[1],previous=original.optJSONObject("replacement"),state=previous==null?ReplacementRules.empty():ReplacementRules.state(previous);
        if(state.optInt("attempts")>=3){if(automatic){Json.put(state,"roundComplete",true);Json.put(state,"status","failed");state.remove("target");Json.put(state,"message","本轮3次尝试已用完");save(ctx,previous,state,cancel);throw new Unavailable("本轮3次尝试已用完");}throw new Exception("本轮已尝试3次，请明确重新匹配后继续");}
        JSONArray candidates=manual==null?state.getJSONArray("candidates"):Json.array(ReplacementRules.target(manual));
        if(automatic&&manual==null&&state.optInt("attempts")==0){
            String query=original.optString("title").trim();progress.update("resolving","正在按歌名搜索替代版本 · "+query);
            Map<String,JSONObject> found=new LinkedHashMap<>();JSONArray rows=query.isEmpty()?new JSONArray():sources.replacementSearch(query,cancel,3,progress);
            for(int i=0;i<rows.length()&&found.size()<3;i++){try{JSONObject row=ReplacementRules.target(rows.getJSONObject(i));found.putIfAbsent(ReplacementRules.key(row),row);}catch(Exception invalid){}}
            candidates=new JSONArray();for(JSONObject row:found.values())candidates.put(row);Json.put(state,"candidates",candidates);check(cancel);save(ctx,previous,state,cancel);previous=Json.copy(state);
        }else if(candidates.length()==0){Map<String,JSONObject> found=new LinkedHashMap<>();Set<String> queries=new LinkedHashSet<>(List.of((original.optString("title")+" "+original.optString("artist")).trim(),(ReplacementRules.text(original.optString("title"))+" "+ReplacementRules.artist(original.optString("artist")).replace('|',' ')).trim(),original.optString("title").trim()));
            for(String query:queries){check(cancel);progress.update("resolving","正在搜索替代版本 · "+query);JSONArray rows=sources.replacementSearch(query,cancel);for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(ReplacementRules.rank(original,row)>0)found.put(ReplacementRules.key(row),ReplacementRules.target(row));}if(found.values().stream().anyMatch(row->ReplacementRules.rank(original,row)>=2))break;}
            List<JSONObject> sorted=new ArrayList<>(found.values());sorted.sort(Comparator.<JSONObject>comparingInt(row->ReplacementRules.rank(original,row)).reversed().thenComparingDouble(row->Math.abs(row.optDouble("duration")-original.optDouble("duration"))));candidates=new JSONArray();for(JSONObject row:sorted)if(candidates.length()<12)candidates.put(row);Json.put(state,"candidates",candidates);check(cancel);save(ctx,previous,state,cancel);previous=Json.copy(state);
        }
        candidates=PlaybackPreferences.order(candidates,original,store);
        for(int i=0;i<candidates.length()&&state.optInt("attempts")<3;i++){
            JSONObject target=candidates.getJSONObject(i);String key=ReplacementRules.key(target);if(manual==null&&(!automatic&&ReplacementRules.rank(original,target)<2||contains(state.getJSONArray("tried"),key)))continue;
            check(cancel);Json.put(state,"roundComplete",false);state.remove("target");Json.put(state,"status","failed");Json.put(state,"attempts",state.optInt("attempts")+1);state.getJSONArray("tried").put(key);Json.put(state,"message","正在解析替代版本");save(ctx,previous,state,cancel);previous=Json.copy(state);progress.update("resolving","正在验证替代音频 · "+state.optInt("attempts")+"/3");
            final int candidateNumber=state.optInt("attempts");
            try{JSONObject resolved;if(automatic){resolved=sources.replacementPlayable(target,original.optString("id"),quality,(phase,message)->progress.update(phase,"候选 "+candidateNumber+"/3 · "+message),cancel);}else{resolved=sources.replacementExact(target,original.optString("id"));check(cancel);sources.replacementProbe(resolved);}check(cancel);Json.put(state,"status","pending");Json.put(state,"target",target);Json.put(state,"message","音频响应已检查，待实际播放验证");save(ctx,previous,state,cancel);Json.put(resolved,"replacementKey",key);return resolved;}
            catch(Exception failure){check(cancel);Json.put(state,"message","候选 "+candidateNumber+"/3 明确失败 · "+SourceDiagnostics.reason(failure));save(ctx,previous,state,cancel);previous=Json.copy(state);}
        }
        boolean choice=false;for(int i=0;i<candidates.length();i++)if(ReplacementRules.rank(original,candidates.getJSONObject(i))==1)choice=true;
        Json.put(state,"roundComplete",true);state.remove("target");Json.put(state,"status",state.optInt("attempts")>=3||automatic?"failed":choice?"needsChoice":"failed");Json.put(state,"message",state.optInt("attempts")>=3?"本轮3次尝试已用完":automatic?"搜索结果中没有可播放的替代版本":choice?"版本信息有差异，请手动选择":"未找到同名、同歌手的替代版本");check(cancel);save(ctx,previous,state,cancel);if(automatic)throw new Unavailable(state.optString("message"));throw new Exception(state.optString("message"));
    }
    static boolean contains(JSONArray array,String value){for(int i=0;i<array.length();i++)if(value.equals(array.optString(i)))return true;return false;}
    JSONObject resolve(JSONObject song,Set<String> attempted,String quality,MusicSources.Progress progress,BooleanSupplier cancel)throws Exception{
        JSONObject[] ctx=context(song);if(ctx==null)return sources.resolve(song,attempted,quality,progress,cancel);
        JSONObject state=ctx[1].optJSONObject("replacement");boolean replacementFailed=attempted.contains("replacement-active");
        if(state!=null&&replacementFailed){JSONObject old=Json.copy(state);state.remove("target");Json.put(state,"status","failed");save(ctx,old,state,cancel);}
        if(state!=null&&state.optJSONObject("target")!=null&&state.optString("status").equals("verified")&&!replacementFailed){JSONObject old=Json.copy(state);Json.put(state,"status","pending");Json.put(state,"attempts",1);Json.put(state,"tried",Json.array(ReplacementRules.key(state.getJSONObject("target"))));save(ctx,old,state,cancel);}
        if(state!=null&&state.optJSONObject("target")!=null&&PlaybackPreferences.excluded(state.optJSONObject("target"),ctx[1],PlaybackPreferences.clean(store.object("playbackPreferences")))){JSONObject old=Json.copy(state);state.remove("target");Json.put(state,"status","failed");Json.put(state,"message","用户已排除此候选，继续本轮剩余候选");save(ctx,old,state,cancel);}
        JSONObject target=state==null?null:state.optJSONObject("target");
        boolean automatic=ctx[0].optBoolean("autoReplacement");
        if(automatic&&attempted.isEmpty()&&ReplacementRules.complete(state)){JSONObject old=Json.copy(state);state=ReplacementRules.empty();save(ctx,old,state,cancel);}
        if(target==null&&!replacementFailed&&!automatic)return sources.resolve(song,attempted,quality,progress,cancel);
        else if(target==null&&!ctx[0].optBoolean("autoReplacement"))throw new Exception("替代版本无法播放，请在歌单中重新选择或恢复原曲");
        if(target!=null){
            check(cancel);try{JSONObject result;if(automatic){result=sources.replacementPlayable(target,song.optString("id"),quality,progress,cancel);}else{result=sources.replacementExact(target,song.optString("id"));check(cancel);sources.replacementProbe(result);}check(cancel);save(ctx,state,state,cancel);Json.put(result,"replacementKey",ReplacementRules.key(target));attempted.add("replacement-active");return result;}
            catch(Exception failure){check(cancel);JSONObject old=Json.copy(state);state.remove("target");Json.put(state,"status","failed");Json.put(state,"message","已选替代版本明确失败");save(ctx,old,state,cancel);if(!ctx[0].optBoolean("autoReplacement"))throw failure;}
        }
        JSONObject result=run(ctx,null,progress,cancel,automatic,quality);attempted.add("replacement-active");return result;
    }
    void played(JSONObject song,String key)throws Exception{JSONObject[] ctx=context(song);if(ctx==null)return;JSONObject state=ctx[1].optJSONObject("replacement");if(state==null||state.optJSONObject("target")==null||!ReplacementRules.key(state.getJSONObject("target")).equals(key)||state.optString("status").equals("verified"))return;JSONObject old=Json.copy(state);Json.put(state,"status","verified");Json.put(state,"message","实际播放验证通过");save(ctx,old,state);}
}
