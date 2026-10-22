package com.zenix.musicplayer;

import android.content.Context;
import android.net.*;
import org.json.*;

final class NetworkPreferences {
    static final String[] CATEGORIES={"audio","lyrics","artwork","preload"};
    static String network(Context context){try{ConnectivityManager manager=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);Network active=manager==null?null:manager.getActiveNetwork();NetworkCapabilities capabilities=active==null?null:manager.getNetworkCapabilities(active);if(capabilities==null||!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET))return "unknown";return manager.isActiveNetworkMetered()?"metered":"unmetered";}catch(SecurityException unavailable){return "unknown";}}
    static JSONObject policy(PrivateStore store){JSONObject raw=store.offlineNetworkPolicy(),value=new JSONObject();for(String key:CATEGORIES){String mode=raw==null?"always":raw.optString(key,"always");Json.put(value,key,java.util.Set.of("always","unmetered","never").contains(mode)?mode:"always");}return value;}
    static boolean allows(Context context,PrivateStore store,String category){String mode=policy(store).optString(category,"always");return !mode.equals("never")&&(!mode.equals("unmetered")||network(context).equals("unmetered"));}
    static void require(Context context,PrivateStore store,String category)throws Exception{if(!allows(context,store,category))throw new Exception("网络偏好限制了"+(category.equals("audio")?"音频联网":category.equals("lyrics")?"歌词联网":category.equals("artwork")?"封面联网":"后台离线准备")+"，请检查网络类型与偏好设置");}
    static boolean pinned(PrivateStore store,String key){return store.offlinePinned(key);}
}
