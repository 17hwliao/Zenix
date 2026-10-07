package com.zenix.musicplayer;
import org.json.*;
import java.io.IOException;
import java.util.Locale;

final class SourcePolicy {
    static JSONObject validate(JSONObject raw)throws IOException {
        if(raw==null)return Json.obj("allowHttp",false,"hosts",JSONObject.NULL);
        if(raw.has("allowHttp")&&!(raw.opt("allowHttp") instanceof Boolean))throw new IOException("HTTP 权限无效");
        JSONArray hosts=raw.optJSONArray("hosts"),clean=new JSONArray();
        if(raw.has("hosts")&&!raw.isNull("hosts")&&hosts==null)throw new IOException("网络域名格式无效");
        if(hosts!=null){if(hosts.length()>30)throw new IOException("最多授权 30 个域名");for(int i=0;i<hosts.length();i++){Object value=hosts.opt(i);if(!(value instanceof String))throw new IOException("域名格式无效");String host=((String)value).toLowerCase(Locale.ROOT);if(host.length()>253||host.contains("..")||!host.matches("(?:\\*\\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?"))throw new IOException("请填写域名，不包含协议或路径");clean.put(host);}}
        return Json.obj("allowHttp",raw.optBoolean("allowHttp"),"hosts",hosts==null?JSONObject.NULL:clean);
    }
    static boolean allowHttp(JSONObject source){JSONObject policy=source.optJSONObject("networkPolicy");return source.optString("kind").equals("lx")&&policy!=null&&policy.optBoolean("allowHttp");}
    static JSONArray hosts(JSONObject source,String key)throws JSONException {
        if(!source.optString("kind").equals("lx"))return source.getJSONObject("manifest").getJSONObject("network").getJSONArray(key);
        JSONObject policy=source.optJSONObject("networkPolicy");return policy==null?null:policy.optJSONArray("hosts");
    }
}
