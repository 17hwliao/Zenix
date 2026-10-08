package com.zenix.musicplayer;

import android.content.Context;
import org.json.*;

final class CompanionTools {
    final PlaylistLan lan;final ListeningStats stats;private final ZenixRuntime runtime;
    private JSONObject pending;private String token;private boolean importing;volatile String statsError="";
    CompanionTools(Context context,ZenixRuntime runtime){this.runtime=runtime;stats=new ListeningStats(context);lan=new PlaylistLan(bundle->{try{preview(bundle);}catch(Exception e){throw new IllegalArgumentException(e);}});}
    synchronized JSONObject preview(JSONObject bundle)throws Exception {if(pending!=null)throw new Exception("请先处理当前待接收歌单");pending=bundle;token=java.util.UUID.randomUUID().toString();return status();}
    synchronized JSONObject status(){JSONObject state=lan.status();if(pending==null)Json.put(state,"pending",JSONObject.NULL);else{JSONArray lists=pending.optJSONArray("playlists"),preview=new JSONArray();for(int i=0;i<lists.length();i++){JSONObject list=lists.optJSONObject(i);JSONArray tracks=list.optJSONArray("tracks");int local=0;for(int j=0;j<tracks.length();j++)if(tracks.optJSONObject(j).optString("source").equals("local"))local++;preview.put(Json.obj("name",list.optString("name"),"count",tracks.length(),"localCount",local));}Json.put(state,"pending",Json.obj("token",token,"playlists",preview));}return state;}
    Object invoke(JSONObject args)throws Exception {
        switch(args.optString("operation")){
            case "lanStatus":return status();
            case "lanStart":synchronized(this){if(pending!=null)throw new Exception("请先处理当前待接收歌单");}lan.start();return status();
            case "lanStop":lan.stop();return status();
            case "lanSend":return lan.send(args.getString("address"),args.getString("code"),PlaylistExchange.bundle(runtime.store,args.optJSONArray("ids")));
            case "importDiscard":synchronized(this){if(importing)throw new Exception("正在导入歌单");pending=null;token=null;}return status();
            case "importConfirm":{
                JSONObject bundle;synchronized(this){if(importing||pending==null||!args.optString("token").equals(token))throw new Exception("导入预览已失效或正在导入");importing=true;bundle=pending;}
                try{JSONArray lists=PlaylistExchange.restore(bundle,runtime.store.array("localTracks"));runtime.store.personal("importPlaylists",Json.obj("playlists",lists));synchronized(this){pending=null;token=null;}runtime.emit();return status();}finally{synchronized(this){importing=false;}}
            }
            case "stats":if(!statsError.isEmpty())throw new Exception(statsError);return stats.query(args.getString("from"),args.getString("to"));
            default:throw new Exception("未知音乐工具操作");
        }
    }
}
