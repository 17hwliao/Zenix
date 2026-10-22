package com.zenix.musicplayer;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import org.json.*;

/** User-initiated LAN remote control. Does not use source or update networking. */
final class RemoteClient {
    private String base="",token="";private boolean approved;private long pairedAt;
    private volatile boolean closed;private volatile HttpURLConnection active;
    static String address(String raw)throws Exception {
        String value=raw.trim().replaceFirst("^http://","");
        if(!value.matches("[0-9.]+:[0-9]{1,5}"))throw new IOException("请填写电脑显示的局域网 IP:端口");
        String[] parts=value.split(":"),octets=parts[0].split("\\.");if(octets.length!=4)throw new IOException("电脑地址无效");int[] ip=new int[4];
        for(int i=0;i<4;i++){if(!octets[i].matches("0|[1-9][0-9]{0,2}"))throw new IOException("电脑地址无效");ip[i]=Integer.parseInt(octets[i]);if(ip[i]>255)throw new IOException("电脑地址无效");}
        int port=Integer.parseInt(parts[1]);if(port<1||port>65535||!(ip[0]==10||ip[0]==192&&ip[1]==168||ip[0]==172&&ip[1]>=16&&ip[1]<=31))throw new IOException("只能连接同一局域网中的电脑地址");
        return "http://"+parts[0]+":"+port;
    }
    private Object post(String target,JSONObject body)throws Exception {
        if(closed)throw new IOException("遥控已关闭");
        HttpURLConnection connection=(HttpURLConnection)new URL(target+"/api").openConnection();active=connection;
        connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(3000);connection.setReadTimeout(3000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setUseCaches(false);
        connection.setRequestProperty("Content-Type","application/json; charset=utf-8");connection.setRequestProperty("Origin",target);connection.setRequestProperty("Accept","application/json");
        byte[] bytes=body.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);
        long deadline=System.nanoTime()+8_000_000_000L;
        try {
            try(OutputStream out=connection.getOutputStream()){out.write(bytes);}
            int status=connection.getResponseCode();if(status!=200)throw new IOException(status>=300&&status<400?"电脑地址发生跳转，已拒绝连接":"电脑未接受请求，请检查配对码、电脑确认状态或重新配对");
            ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=connection.getInputStream()){byte[] buffer=new byte[4096];int read;while((read=in.read(buffer))!=-1){if(closed||System.nanoTime()>deadline)throw new IOException("遥控连接超时或已取消");if(out.size()+read>4*1024*1024)throw new IOException("遥控响应过大");out.write(buffer,0,read);}}
            Object result=new JSONTokener(out.toString("UTF-8")).nextValue();if(closed)throw new IOException("遥控已关闭");return result;
        }finally{active=null;connection.disconnect();}
    }
    private JSONObject request(String action,JSONObject extra)throws Exception {
        JSONObject body=Json.obj("action",action,"token",token);if(extra!=null)for(java.util.Iterator<String> keys=extra.keys();keys.hasNext();){String key=keys.next();body.put(key,extra.get(key));}
        Object value=post(base,body);return value instanceof JSONObject?(JSONObject)value:new JSONObject();
    }
    synchronized JSONObject invoke(JSONObject args)throws Exception {
        String operation=args.optString("operation");if(closed)throw new IOException("遥控已关闭");
        if(operation.equals("disconnect")){disconnect();return Json.obj("phase","idle");}
        if(operation.equals("connect")){
            String next=address(args.getString("address")),code=args.optString("code");if(!code.matches("[0-9]{6}"))throw new IOException("请输入电脑显示的六位配对码");
            disconnect();Object raw=post(next,Json.obj("action","pair","code",code,"label","Zenix Android"));if(!(raw instanceof JSONObject))throw new IOException("电脑未返回有效配对信息");
            JSONObject pair=(JSONObject)raw;String nextToken=pair.optString("token");if(!nextToken.matches("[a-f0-9]{48}"))throw new IOException("电脑返回的配对信息无效");
            base=next;token=nextToken;approved=false;pairedAt=System.nanoTime();return Json.obj("phase","waiting","address",base.substring(7));
        }
        if(token.isEmpty())return Json.obj("phase","idle");
        if(!approved){if(System.nanoTime()-pairedAt>120_000_000_000L){disconnect();throw new IOException("等待电脑确认已超时，请重新配对");}approved=request("pairStatus",null).optBoolean("approved");if(!approved)return Json.obj("phase","waiting","address",base.substring(7));}
        if(operation.equals("collaboration")){JSONObject extra=new JSONObject(args.toString());extra.remove("operation");return request("collaboration",Json.obj("request",extra));}
        if(!operation.equals("status")){
            if(Set.of("play-pause","previous","next").contains(operation))request(operation,null);
            else if(operation.equals("seek")){double seconds=args.optDouble("seconds",Double.NaN);if(!Double.isFinite(seconds)||seconds<0||seconds>86400)throw new IOException("进度无效");request("seek",Json.obj("seconds",seconds));}
            else if(operation.equals("volume")){double volume=args.optDouble("volume",Double.NaN);if(!Double.isFinite(volume)||volume<0||volume>1)throw new IOException("音量无效");request("volume",Json.obj("volume",volume));}
            else throw new IOException("无效遥控操作");
        }
        JSONObject state=request("status",null);return Json.obj("phase","connected","address",base.substring(7),"title",state.optString("title").substring(0,Math.min(300,state.optString("title").length())),"artist",state.optString("artist").substring(0,Math.min(300,state.optString("artist").length())),"playing",state.optBoolean("playing"),"position",finite(state.optDouble("position"),86400),"duration",finite(state.optDouble("duration"),86400),"volume",finite(state.optDouble("volume"),1));
    }
    private static double finite(double value,double max){return Double.isFinite(value)?Math.max(0,Math.min(max,value)):0;}
    private void disconnect(){String previous=base,secret=token;base="";token="";approved=false;if(!previous.isEmpty()&&!secret.isEmpty())try{post(previous,Json.obj("action","disconnect","token",secret));}catch(Exception ignored){}}
    void close(){closed=true;token="";base="";HttpURLConnection connection=active;if(connection!=null)connection.disconnect();}
}
