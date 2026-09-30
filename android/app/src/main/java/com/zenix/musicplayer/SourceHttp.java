package com.zenix.musicplayer;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

final class SourceHttp {
    static final int MAX_BYTES=4*1024*1024;
    static URL check(String address,JSONArray allowed) throws Exception {
        URL url=new URL(address);
        if(!(url.getProtocol().equals("https")||url.getProtocol().equals("http"))||url.getUserInfo()!=null) throw new Exception("无效网络地址");
        String host=url.getHost().toLowerCase(Locale.ROOT);
        if(allowed!=null) {
            boolean match=false;
            for(int i=0;i<allowed.length();i++) { String rule=allowed.optString(i).toLowerCase(Locale.ROOT); if(host.equals(rule)||rule.startsWith("*.")&&host.endsWith(rule.substring(1))) match=true; }
            if(!match||!url.getProtocol().equals("https")) throw new Exception("网络地址不在音乐源声明范围");
        }
        for(InetAddress resolved:InetAddress.getAllByName(host)) {
            byte[] bytes=resolved.getAddress();
            if(resolved.isAnyLocalAddress()||resolved.isLoopbackAddress()||resolved.isLinkLocalAddress()||resolved.isSiteLocalAddress()||resolved.isMulticastAddress()||bytes.length==16&&(bytes[0]&0xfe)==0xfc) throw new Exception("音乐源不能访问内网或本机地址");
        }
        return url;
    }
    static JSONObject request(String address,JSONObject options,JSONArray allowed) throws Exception {
        URL url=check(address,allowed); String method=options.optString("method","GET").toUpperCase(Locale.ROOT);
        if(!method.equals("GET")&&!method.equals("POST")) throw new Exception("只支持 GET/POST");
        JSONObject headers=options.optJSONObject("headers");
        String body=options.has("body")?String.valueOf(options.opt("body")):"";
        if(options.optJSONObject("json")!=null) {body=options.getJSONObject("json").toString();if(headers==null)headers=new JSONObject();Json.put(headers,"Content-Type","application/json");}
        if(options.optJSONObject("formData")!=null) {
            String boundary="Zenix"+UUID.randomUUID().toString().replace("-","");JSONObject form=options.getJSONObject("formData");StringBuilder parts=new StringBuilder();
            for(Iterator<String> it=form.keys();it.hasNext();) {String key=it.next().replaceAll("[\\r\\n\"]","");parts.append("--").append(boundary).append("\r\nContent-Disposition: form-data; name=\"").append(key).append("\"\r\n\r\n").append(form.optString(key)).append("\r\n");}
            parts.append("--").append(boundary).append("--\r\n");body=parts.toString();if(headers==null)headers=new JSONObject();Json.put(headers,"Content-Type","multipart/form-data; boundary="+boundary);
        }
        if(options.optJSONObject("form")!=null) { JSONObject form=options.getJSONObject("form"); StringBuilder s=new StringBuilder(); for(Iterator<String> it=form.keys();it.hasNext();) { String key=it.next(); if(s.length()>0)s.append('&'); s.append(URLEncoder.encode(key,"UTF-8")).append('=').append(URLEncoder.encode(form.optString(key),"UTF-8")); } body=s.toString(); if(headers==null)headers=new JSONObject(); Json.put(headers,"Content-Type","application/x-www-form-urlencoded"); }
        if(body.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES) throw new Exception("请求内容过大");
        for(int hop=0;hop<5;hop++) {
            HttpURLConnection c=(HttpURLConnection)url.openConnection(); c.setInstanceFollowRedirects(false); c.setConnectTimeout(8000); c.setReadTimeout(Math.max(2000,Math.min(15000,options.optInt("timeout",10000)))); c.setRequestMethod(method);
            c.setRequestProperty("User-Agent","Zenix/0.1 Android"); c.setRequestProperty("Accept-Encoding","identity");
            if(headers!=null) for(Iterator<String> it=headers.keys();it.hasNext();) { String key=it.next(); if(key.equalsIgnoreCase("Host")||key.equalsIgnoreCase("Content-Length")||key.contains("\n"))continue; c.setRequestProperty(key,headers.optString(key)); }
            try {
                if(method.equals("POST")) { c.setDoOutput(true); try(OutputStream output=c.getOutputStream()) { output.write(body.getBytes(StandardCharsets.UTF_8)); } }
                int status=c.getResponseCode();
                if(status>=300&&status<400) { URL target=check(new URL(url,c.getHeaderField("Location")).toString(),allowed); if(!target.getHost().equalsIgnoreCase(url.getHost())) headers=null; url=target; if(status==303||status==302) { method="GET";body=""; } continue; }
                JSONObject resultHeaders=new JSONObject(); for(Map.Entry<String,List<String>> entry:c.getHeaderFields().entrySet()) if(entry.getKey()!=null)Json.put(resultHeaders,entry.getKey().toLowerCase(Locale.ROOT),String.join(", ",entry.getValue()));
                InputStream input=status>=400?c.getErrorStream():c.getInputStream(); byte[] data=input==null?new byte[0]:bounded(input,MAX_BYTES);
                return Json.obj("status",status,"headers",resultHeaders,"data",android.util.Base64.encodeToString(data,android.util.Base64.NO_WRAP));
            } finally { c.disconnect(); }
        }
        throw new Exception("重定向次数过多");
    }
    static byte[] bounded(InputStream input,int limit) throws IOException {
        try(InputStream in=input;ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[8192]; int count;
            while((count=in.read(buffer))!=-1) { if(output.size()+count>limit)throw new IOException("内容超过大小限制");output.write(buffer,0,count); } return output.toByteArray();
        }
    }
}
