package com.zenix.musicplayer;

import android.content.Context;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.regex.*;

final class MusicSources implements AutoCloseable {
    private final Context context; private final PrivateStore store;
    private final File directory;
    private ScriptEngine catalogue,active; private String activeId="";
    private final Map<String,JSONObject> previews=new HashMap<>();
    private final Map<String,JSONObject> matched=new LinkedHashMap<>();
    private static final Set<String> PLATFORMS=Set.of("kw","kg","wy","tx","mg");
    MusicSources(Context context,PrivateStore store) { this.context=context.getApplicationContext();this.store=store;directory=new File(context.getFilesDir(),"sources");directory.mkdirs(); }
    JSONArray list() { return store.array("sources"); }
    private synchronized ScriptEngine catalog() throws Exception { if(catalogue==null) { catalogue=new ScriptEngine(context,"",new JSONObject(),null,true);catalogue.ready(); }return catalogue; }
    private synchronized ScriptEngine engine(JSONObject source) throws Exception {
        String id=source.getString("id"); if(!id.equals(activeId)) {
            if(active!=null)active.close();active=null;activeId="";
            JSONObject pack=new JSONObject(new String(SourceHttp.bounded(new FileInputStream(new File(directory,id+".json")),2*1024*1024),StandardCharsets.UTF_8));
            JSONArray hosts=source.optString("kind").equals("lx")?null:source.getJSONObject("manifest").getJSONObject("network").getJSONArray("apiHosts");
            ScriptEngine next=new ScriptEngine(context,pack.getString("script"),metadata(pack.getString("script")),hosts,false);
            try { next.ready();active=next;activeId=id; }catch(Exception e) { next.close();throw e; }
        }
        return active;
    }
    private synchronized Object invoke(JSONObject source,String method,Object payload,JSONObject settings) throws Exception {return engine(source).call(method,payload,settings);}
    synchronized JSONObject preview(String text,String origin,String originKind) throws Exception {
        if(text.length()>1024*1024)throw new Exception("音乐源文件不能超过 1 MiB");
        JSONObject manifest,pack;String kind;
        if(text.trim().startsWith("{")) {
            pack=new JSONObject(text);manifest=pack.getJSONObject("manifest");kind="zenix";
            String id=manifest.getString("id");if(!id.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}"))throw new Exception("音乐源 ID 无效");
            if(manifest.optInt("schemaVersion")!=1||!pack.has("script"))throw new Exception("只支持 Zenix v1 音乐源协议");
            JSONObject network=manifest.getJSONObject("network");for(String key:List.of("apiHosts","mediaHosts","artworkHosts")) { JSONArray hosts=network.getJSONArray(key);for(int i=0;i<hosts.length();i++)if(!hosts.getString(i).matches("(?:\\*\\.)?[a-zA-Z0-9.-]+"))throw new Exception("音乐源域名声明无效"); }
            JSONArray caps=manifest.getJSONArray("capabilities"),clean=new JSONArray();for(int i=0;i<caps.length();i++)if(Set.of("search","resolvePlayback","lyrics","artwork").contains(caps.optString(i)))clean.put(caps.get(i));Json.put(manifest,"capabilities",clean);
            if(!clean.toString().contains("resolvePlayback")||!clean.toString().contains("search"))throw new Exception("音乐源需要搜索和播放解析能力");
            if(!manifest.has("settings"))Json.put(manifest,"settings",new JSONArray());
            if(!manifest.has("qualities"))Json.put(manifest,"qualities",Json.array("standard","high"));
        } else {
            kind="lx";JSONObject info=metadata(text);String id="script-"+sha(info.optString("name")+"/"+info.optString("author")).substring(0,24);
            manifest=Json.obj("id",id,"name",info.getString("name"),"version",info.optString("version","1"),"capabilities",Json.array("search","resolvePlayback","lyrics","artwork"),"qualities",Json.array("standard","high","lossless"),"settings",new JSONArray(),"network",Json.obj("apiHosts",new JSONArray(),"mediaHosts",new JSONArray(),"artworkHosts",new JSONArray()));
            pack=Json.obj("manifest",manifest,"script",text);
        }
        String token=UUID.randomUUID().toString();JSONObject preview=Json.obj("token",token,"kind",kind,"manifest",manifest,"sha256",sha(pack.getString("script")),"origin",Json.obj("kind",originKind,"label",origin),"pack",pack);
        if(previews.size()>5)previews.clear();previews.put(token,preview);JSONObject result=Json.copy(preview);result.remove("pack");return result;
    }
    JSONObject importUrl(String url) throws Exception {
        if(!url.startsWith("https://"))throw new Exception("音乐源导入地址需要 HTTPS");JSONObject response=SourceHttp.request(url,new JSONObject(),null);if(response.getInt("status")!=200)throw new Exception("音乐源地址返回 HTTP "+response.optInt("status"));
        return preview(new String(Base64.decode(response.getString("data"),Base64.DEFAULT),StandardCharsets.UTF_8),url,"url");
    }
    synchronized JSONArray install(String token) throws Exception {
        JSONObject preview=previews.get(token);if(preview==null)throw new Exception("导入预览已失效，请重新选择");JSONObject manifest=preview.getJSONObject("manifest"),pack=preview.getJSONObject("pack");String id=manifest.getString("id");
        ScriptEngine candidate=new ScriptEngine(context,pack.getString("script"),metadata(pack.getString("script")),preview.getString("kind").equals("lx")?null:manifest.getJSONObject("network").getJSONArray("apiHosts"),false);
        try {
            JSONObject init=candidate.ready();
            if(preview.optString("kind").equals("lx")) {
                if(!init.optBoolean("status",true))throw new Exception(init.optString("message","音乐源初始化失败"));
                JSONObject sources=init.optJSONObject("sources"),platforms=new JSONObject();
                if(sources!=null)for(String platform:PLATFORMS) { JSONObject p=sources.optJSONObject(platform);if(p==null||!p.optString("type","music").equals("music")||p.optJSONArray("actions")==null||!p.optJSONArray("actions").toString().contains("musicUrl"))continue;JSONArray q=p.optJSONArray("qualitys");if(q!=null&&q.length()>0)Json.put(platforms,platform,Json.obj("name",p.optString("name",platform),"qualitys",q)); }
                if(platforms.length()==0)throw new Exception("音乐源没有可用播放平台");Json.put(manifest,"lxPlatforms",platforms);
                String first=platforms.keys().next();JSONArray options=new JSONArray();for(String platform:PLATFORMS)if(platforms.has(platform))options.put(platform);Json.put(manifest,"settings",Json.array(Json.obj("key","lxCatalog","label","歌曲目录","type","select","options",options,"default",first)));
            }
            JSONArray existing=list(),next=new JSONArray();long installed=System.currentTimeMillis();JSONObject settings=defaults(manifest);boolean replaced=false;
            for(int i=0;i<existing.length();i++) { JSONObject item=existing.getJSONObject(i);if(item.optString("id").equals(id)) { installed=item.optLong("installedAt",installed);settings=item.optJSONObject("settings")==null?settings:item.getJSONObject("settings");replaced=true;next.put(descriptor(preview,manifest,installed,settings)); }else next.put(item); }
            if(!replaced)next.put(descriptor(preview,manifest,installed,settings));
            android.util.AtomicFile file=new android.util.AtomicFile(new File(directory,id+".json"));FileOutputStream output=file.startWrite();try { output.write(pack.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(output); }catch(Exception e){file.failWrite(output);throw e;}
            store.set("sources",next);previews.remove(token);if(activeId.equals(id)){active.close();active=null;activeId="";}return next;
        }finally {candidate.close();}
    }
    private static JSONObject descriptor(JSONObject preview,JSONObject manifest,long installed,JSONObject settings) { return Json.obj("id",manifest.optString("id"),"kind",preview.optString("kind"),"manifest",manifest,"enabled",true,"origin",preview.opt("origin"),"sha256",preview.optString("sha256"),"installedAt",installed,"status","ready","lastError","","settings",settings); }
    private static JSONObject defaults(JSONObject manifest) { JSONObject result=new JSONObject();JSONArray settings=manifest.optJSONArray("settings");if(settings!=null)for(int i=0;i<settings.length();i++){JSONObject field=settings.optJSONObject(i);if(field!=null)Json.put(result,field.optString("key"),field.optString("default"));}return result; }
    synchronized JSONArray update(String id,String action,JSONObject args) throws Exception {
        JSONArray current=list(),next=new JSONArray();boolean found=false;
        for(int i=0;i<current.length();i++){JSONObject item=current.getJSONObject(i);if(item.optString("id").equals(id)){found=true;if(action.equals("remove")){new File(directory,id+".json").delete();continue;}if(action.equals("enable"))Json.put(item,"enabled",args.optBoolean("enabled"));else if(action.equals("configure"))Json.put(item,"settings",args.getJSONObject("values"));else throw new Exception("未知音乐源操作");}next.put(item);}
        if(!found)throw new Exception("音乐源不存在");store.set("sources",next);if(activeId.equals(id)){active.close();active=null;activeId="";}return next;
    }
    private JSONObject find(String id) throws Exception { JSONArray sources=list();for(int i=0;i<sources.length();i++)if(sources.getJSONObject(i).optString("id").equals(id))return sources.getJSONObject(i);throw new Exception("请先配置音乐源"); }
    JSONObject search(String id,String keyword,String cursor) throws Exception {
        JSONObject source=find(id);if(!source.optBoolean("enabled"))throw new Exception("音乐源已停用");JSONObject settings=source.getJSONObject("settings"),result;
        if(source.optString("kind").equals("lx")) { String platform=settings.optString("lxCatalog",source.getJSONObject("manifest").getJSONObject("lxPlatforms").keys().next()); result=(JSONObject)catalog().call("catalog:search",Json.array(platform,keyword,Math.max(1,parsePage(cursor)),25),new JSONObject()); }
        else result=(JSONObject)invoke(source,"search",Json.obj("keyword",keyword,"cursor",cursor.isEmpty()?null:cursor,"pageSize",25),settings);
        JSONArray rows=result.optJSONArray("items"),tracks=new JSONArray();if(rows!=null)for(int i=0;i<rows.length()&&i<100;i++){JSONObject song=rows.optJSONObject(i);if(song==null||song.optString("remoteId").isEmpty()||song.optString("title").isEmpty())continue;String remote=song.getString("remoteId");JSONObject track=Json.copy(song);Json.put(track,"id",id+":"+sha(remote).substring(0,24));Json.put(track,"providerId",id);Json.put(track,"source","custom");Json.put(track,"path","");Json.put(track,"audioUrl","");if(!track.has("duration"))Json.put(track,"duration",0);if(!track.has("artist"))Json.put(track,"artist","");
            if(!source.optString("kind").equals("lx")&&track.has("coverUrl"))try{SourceHttp.check(track.getString("coverUrl"),source.getJSONObject("manifest").getJSONObject("network").getJSONArray("artworkHosts"));}catch(Exception e){track.remove("coverUrl");}tracks.put(track);}
        return Json.obj("items",tracks,"nextCursor",result.opt("nextCursor"));
    }
    JSONObject artwork(JSONObject track) throws Exception {
        JSONObject source=find(track.getString("providerId"));Object value=source.optString("kind").equals("lx") ? catalog().call("catalog:artwork",Json.array(readInfo(track)),new JSONObject()) : invoke(source,"artwork",Json.obj("remoteId",track.getString("remoteId")),source.getJSONObject("settings"));
        String url=value instanceof JSONObject?((JSONObject)value).optString("url"):String.valueOf(value);if(url.equals("null")||url.isBlank())return new JSONObject();if(url.startsWith("http://"))url=url.replaceFirst("http://","https://");SourceHttp.check(url,source.optString("kind").equals("lx")?null:source.getJSONObject("manifest").getJSONObject("network").getJSONArray("artworkHosts"));return Json.obj("url",url);
    }
    Object lyrics(JSONObject track) throws Exception {
        if(track.optString("source").equals("local"))return JSONObject.NULL;
        File lyricDirectory=new File(context.getCacheDir(),"lyrics");lyricDirectory.mkdirs();File cached=new File(lyricDirectory,sha(track.getString("id"))+".json");
        if(cached.exists())try{return new JSONObject(new String(SourceHttp.bounded(new FileInputStream(cached),512*1024),StandardCharsets.UTF_8));}catch(Exception ignored){}
        JSONObject source=find(track.getString("providerId"));Object value=source.optString("kind").equals("lx")?catalog().call("catalog:lyrics",Json.array(readInfo(track)),new JSONObject()):invoke(source,"lyrics",Json.obj("remoteId",track.getString("remoteId")),source.getJSONObject("settings"));
        if(value instanceof String)value=Json.obj("text",value,"format","lrc","source","custom");if(value instanceof JSONObject){Json.put((JSONObject)value,"source","custom");byte[] data=value.toString().getBytes(StandardCharsets.UTF_8);if(data.length<512*1024){try(OutputStream output=new FileOutputStream(cached)){output.write(data);}File[] files=lyricDirectory.listFiles();if(files!=null&&files.length>100){Arrays.sort(files,Comparator.comparingLong(File::lastModified));for(int i=0;i<files.length-100;i++)files[i].delete();}}}return value;
    }
    interface Progress { void update(String phase,String message); }
    JSONObject resolve(JSONObject track,Set<String> attempted,String quality,Progress progress,java.util.function.BooleanSupplier cancelled) throws Exception {
        JSONArray installed=list();Exception last=null;JSONObject original=null;try{original=find(track.optString("providerId"));}catch(Exception ignored){}
        for(int i=0;i<installed.length();i++) {
            if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();
            JSONObject source=installed.getJSONObject(i);if(!source.optBoolean("enabled"))continue;String id=source.getString("id");JSONObject candidate=track;
            progress.update(i==0?"connecting":"switching",i==0?"正在连接音乐资源":"正在尝试下一个可用资源");
            try {
                boolean same=source.optString("kind").equals("lx")&&original!=null&&original.optString("kind").equals("lx");
                if(same) { JSONObject info=readInfo(track);same=source.getJSONObject("manifest").getJSONObject("lxPlatforms").has(info.optString("source")); }
                if(!id.equals(track.optString("providerId"))&&!same) {
                    String matchKey=track.optString("id")+":"+id; synchronized(matched){candidate=matched.get(matchKey);}
                    if(candidate==null){if(attempted.contains(id+":match"))continue;attempted.add(id+":match");
                    JSONArray matches=search(id,track.optString("title")+" "+track.optString("artist"),"").getJSONArray("items");
                    for(int j=0;j<matches.length();j++){JSONObject match=matches.getJSONObject(j);if(key(match.optString("title")).equals(key(track.optString("title")))&&key(match.optString("artist")).equals(key(track.optString("artist")))){candidate=match;break;}}
                    if(candidate!=null)synchronized(matched){if(matched.size()>=32)matched.remove(matched.keySet().iterator().next());matched.put(matchKey,candidate);}}
                    if(candidate==null)continue;
                }
                String[] qualities=quality.equals("lossless")?new String[]{"flac","320k","128k"}:new String[]{"320k","128k","flac"};
                for(String q:qualities) {
                    if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();
                    String attempt=id+":"+q;if(attempted.contains(attempt))continue;attempted.add(attempt);
                    String normalized=q.equals("flac")?"lossless":q.equals("320k")?"high":"standard";
                    try {
                        progress.update("resolving","正在获取"+(normalized.equals("lossless")?"无损":normalized.equals("high")?"高品质":"标准品质")+"音频");Object value;
                        if(source.optString("kind").equals("lx")){JSONObject info=readInfo(candidate);JSONObject platform=source.getJSONObject("manifest").getJSONObject("lxPlatforms").optJSONObject(info.optString("source"));if(platform==null||!platform.getJSONArray("qualitys").toString().contains(JSONObject.quote(q)))continue;value=invoke(source,"lx",Json.obj("source",info.optString("source"),"action","musicUrl","info",Json.obj("type",q,"musicInfo",info)),source.getJSONObject("settings"));}
                        else { if(!source.getJSONObject("manifest").getJSONArray("qualities").toString().contains(JSONObject.quote(normalized)))continue;value=invoke(source,"resolvePlayback",Json.obj("remoteId",candidate.getString("remoteId"),"quality",normalized),source.getJSONObject("settings")); }
                        JSONObject result=value instanceof JSONObject?(JSONObject)value:Json.obj("url",value);String url=result.optString("url");SourceHttp.check(url,source.optString("kind").equals("lx")?null:source.getJSONObject("manifest").getJSONObject("network").getJSONArray("mediaHosts"));
                        Json.put(result,"quality",normalized);Json.put(result,"providerId",id);Json.put(result,"cacheKey",track.getString("id")+":"+normalized);return result;
                    }catch(Exception e){last=e;progress.update("retrying","当前资源未就绪，继续尝试");}
                }
            }catch(java.util.concurrent.CancellationException e){throw e;}catch(Exception e){last=e;}
        }
        throw new Exception(last==null?"没有可用音乐源，请在个人空间中配置":"全部资源暂不可用，请检查网络或更换音乐源。"+Json.message(last));
    }
    private static int parsePage(String text){try{return Integer.parseInt(text);}catch(Exception e){return 1;}}
    private static String key(String s){return s.replaceAll("[\\s\\p{Punct}]","").toLowerCase(Locale.ROOT);}
    private static JSONObject readInfo(JSONObject track) throws JSONException { return new JSONObject(new String(Base64.decode(track.getString("remoteId"),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),StandardCharsets.UTF_8)); }
    static String sha(String text) throws Exception { StringBuilder b=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))b.append(String.format("%02x",value&255));return b.toString(); }
    private static JSONObject metadata(String script) { JSONObject info=new JSONObject();for(String field:List.of("name","author","description","version","homepage")){Matcher m=Pattern.compile("^\\s*\\*\\s*@"+field+"\\s+(.+)$",Pattern.MULTILINE|Pattern.CASE_INSENSITIVE).matcher(script);Json.put(info,field,m.find()?m.group(1).trim():field.equals("name")?"自定义音乐源":field.equals("version")?"1":"");}Json.put(info,"rawScript",script);return info; }
    @Override public synchronized void close() {if(active!=null)active.close();if(catalogue!=null)catalogue.close();active=null;catalogue=null;activeId="";}
}
