package com.zenix.musicplayer;
import org.json.*;
import java.util.*;
final class PlaylistBatch {
    static void apply(JSONObject personal,JSONObject args)throws Exception {
        JSONArray lists=personal.getJSONArray("playlists");JSONObject source=null,target=null;
        for(int i=0;i<lists.length();i++){JSONObject list=lists.getJSONObject(i);if(list.optString("id").equals(args.optString("id")))source=list;if(list.optString("id").equals(args.optString("target")))target=list;}
        if(source==null)throw new Exception("歌单不存在");JSONArray tracks=source.getJSONArray("tracks");
        if(!QueueEdits.ids(tracks).toString().equals(args.getJSONArray("expected").toString()))throw new Exception("歌单已变化，请重新选择");
        if(args.optString("edit").startsWith("replacement")){ReplacementRules.edit(source,args);return;}
        Set<String> selected=new HashSet<>();JSONArray ids=args.getJSONArray("ids");if(ids.length()>5000)throw new Exception("选中歌曲过多");for(int i=0;i<ids.length();i++)selected.add(ids.getString(i));
        List<JSONObject> picked=new ArrayList<>(),all=new ArrayList<>();JSONArray remain=new JSONArray();for(int i=0;i<tracks.length();i++){JSONObject track=tracks.getJSONObject(i);all.add(track);if(selected.contains(track.optString("id")))picked.add(track);else remain.put(track);}
        if(picked.size()!=selected.size())throw new Exception("选中歌曲已变化");String edit=args.optString("edit");
        if(edit.equals("sort")){String field=args.getString("field");if(!Set.of("title","artist").contains(field))throw new Exception("排序方式无效");java.text.Collator collator=java.text.Collator.getInstance(Locale.SIMPLIFIED_CHINESE);all.sort((a,b)->collator.compare(a.optString(field),b.optString(field)));JSONArray sorted=new JSONArray();for(JSONObject track:all)sorted.put(track);Json.put(source,"tracks",sorted);}
        else if(edit.equals("remove"))Json.put(source,"tracks",remain);
        else if(edit.equals("copy")||edit.equals("move")){if(target==null||target==source)throw new Exception("请选择其他目标歌单");JSONArray values=target.getJSONArray("tracks");Set<String> known=new HashSet<>();for(int i=0;i<values.length();i++)known.add(values.getJSONObject(i).optString("id"));for(JSONObject track:picked)if(known.add(track.optString("id")))values.put(track);if(values.length()>5000)throw new Exception("目标歌单最多 5000 首");if(edit.equals("move"))Json.put(source,"tracks",remain);}
        else throw new Exception("未知歌单操作");
    }
}
