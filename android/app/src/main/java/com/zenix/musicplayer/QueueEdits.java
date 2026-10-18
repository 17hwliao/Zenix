package com.zenix.musicplayer;
import org.json.*;
import java.util.*;
final class QueueEdits {
    static JSONArray ids(JSONArray queue){JSONArray result=new JSONArray();for(int i=0;i<queue.length();i++)result.put(queue.optJSONObject(i).optString("id"));return result;}
    static JSONArray apply(JSONArray previous,String current,JSONObject args)throws Exception{
        if(args.has("expected")&&!ids(previous).toString().equals(args.getJSONArray("expected").toString()))throw new Exception("队列已变化，请重新操作");
        List<JSONObject> tracks=new ArrayList<>();for(int i=0;i<previous.length();i++)tracks.add(previous.getJSONObject(i));
        String operation=args.optString("operation");
        if(operation.equals("next")||operation.equals("enqueue")){
            JSONObject track=PrivateStore.queueTrack(args.getJSONObject("track"));String id=track.getString("id");if(id.equals(current))return previous;
            tracks.removeIf(song->song.optString("id").equals(id));int at=tracks.size();if(operation.equals("next")){at=0;for(int i=0;i<tracks.size();i++)if(tracks.get(i).optString("id").equals(current))at=i+1;}tracks.add(at,track);
        }else if(operation.equals("move")){
            int from=args.getInt("from"),to=args.getInt("to");if(from<0||to<0||from>=tracks.size()||to>=tracks.size())throw new Exception("队列位置无效");tracks.add(to,tracks.remove(from));
        }else if(operation.equals("remove")){
            Set<String> selected=new HashSet<>();JSONArray ids=args.getJSONArray("ids");for(int i=0;i<ids.length();i++)selected.add(ids.getString(i));tracks.removeIf(song->selected.contains(song.optString("id")));
        }else if(operation.equals("restore")){
            tracks.clear();JSONArray values=args.getJSONArray("tracks");for(int i=0;i<values.length();i++)tracks.add(PrivateStore.queueTrack(values.getJSONObject(i)));
        }else throw new Exception("未知队列操作");
        if(tracks.size()>1000)throw new Exception("队列最多 1000 首");Set<String> seen=new HashSet<>();JSONArray result=new JSONArray();for(JSONObject track:tracks){String id=track.getString("id");if(id.isEmpty()||!seen.add(id))throw new Exception("队列包含重复歌曲");result.put(track);}return result;
    }
}
