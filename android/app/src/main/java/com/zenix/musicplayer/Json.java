package com.zenix.musicplayer;

import org.json.*;
final class Json {
    static JSONObject obj(Object... pairs) {
        JSONObject value = new JSONObject();
        for (int i=0;i<pairs.length;i+=2) put(value, (String)pairs[i], pairs[i+1]);
        return value;
    }
    static void put(JSONObject value, String key, Object item) { try { value.put(key, item == null ? JSONObject.NULL : item); } catch (JSONException e) { throw new IllegalArgumentException(e); } }
    static JSONObject copy(JSONObject value) { try { return new JSONObject(value.toString()); } catch (JSONException e) { throw new IllegalArgumentException(e); } }
    static JSONArray array(Object... values) { JSONArray result=new JSONArray(); for(Object value:values) result.put(value); return result; }
    static String message(Throwable e) { while(e.getCause()!=null) e=e.getCause(); return e.getMessage()==null ? "操作失败，请重试" : e.getMessage(); }
}
