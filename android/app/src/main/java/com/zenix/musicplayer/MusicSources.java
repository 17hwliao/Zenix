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
    final SourceDiagnostics diagnostics;
    private final File directory;
    private final java.util.concurrent.atomic.AtomicLong metadataEpoch=new java.util.concurrent.atomic.AtomicLong();
    private volatile long metadataBytes;
    private final SourceEngineLane<ScriptEngine> playbackLane=new SourceEngineLane<>(), browseLane=new SourceEngineLane<>(), playbackCatalog=new SourceEngineLane<>(), browseCatalog=new SourceEngineLane<>();
    private final SourceEngineLane<ScriptEngine> inspectionLane=new SourceEngineLane<>(),inspectionCatalog=new SourceEngineLane<>();
    private final ThreadLocal<Boolean> inspecting=ThreadLocal.withInitial(()->false);
    private final java.util.concurrent.atomic.AtomicReference<okhttp3.Call> inspectionProbe=new java.util.concurrent.atomic.AtomicReference<>(),playbackProbe=new java.util.concurrent.atomic.AtomicReference<>();
    private final PlaybackSourcePlan sourcePlan=new PlaybackSourcePlan(android.os.SystemClock::elapsedRealtime);
    private final Map<String,JSONObject> previews=new HashMap<>();
    private final Map<String,JSONObject> matched=new LinkedHashMap<>();
    private static final Set<String> PLATFORMS=Set.of("kw","kg","wy","tx","mg");
    MusicSources(Context context,PrivateStore store) { this.context=context.getApplicationContext();SourceHttp.configure(this.context);this.store=store;diagnostics=new SourceDiagnostics(context,store);directory=new File(context.getFilesDir(),"sources");directory.mkdirs(); }
    JSONArray list() { return store.array("sources"); }
    synchronized JSONObject shareBundle() throws Exception {
        return SourceShare.bundle(list(),source -> {
            String id=source.getString("id");if(!id.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{2,119}"))throw new Exception("音乐源 ID 无效");
            return new JSONObject(new String(SourceHttp.bounded(new FileInputStream(new File(directory,id+".json")),2*1024*1024),StandardCharsets.UTF_8));
        });
    }
    private Object catalogCall(String method,Object payload) throws Exception {return catalogCall(method,payload,false,20000);}
    private Object catalogCall(String method,Object payload,boolean playback,long timeout) throws Exception {
        return (inspecting.get()?inspectionCatalog:playback?playbackCatalog:browseCatalog).call("catalog",()->new ScriptEngine(context,"",new JSONObject(),null,true,false,playback),engine->engine.call(method,payload,new JSONObject(),timeout));
    }
    private ScriptEngine engine(JSONObject source) throws Exception {
        return engine(source,false);
    }
    private ScriptEngine engine(JSONObject source,boolean playback) throws Exception {
            String id=source.getString("id");
            JSONObject pack=new JSONObject(new String(SourceHttp.bounded(new FileInputStream(new File(directory,id+".json")),2*1024*1024),StandardCharsets.UTF_8));
            JSONArray hosts=SourcePolicy.hosts(source,"apiHosts");
            return new ScriptEngine(context,pack.getString("script"),metadata(pack.getString("script")),hosts,false,SourcePolicy.allowHttp(source),playback);
    }
    private Object invoke(JSONObject source,String method,Object payload,JSONObject settings) throws Exception {return invoke(source,method,payload,settings,false,20000);}
    private Object invoke(JSONObject source,String method,Object payload,JSONObject settings,boolean playback,long timeout) throws Exception {return (inspecting.get()?inspectionLane:playback?playbackLane:browseLane).call(source.getString("id"),()->engine(source,playback),engine->engine.call(method,payload,settings,timeout));}
    void cancelPlayback(){playbackLane.cancel();playbackCatalog.cancel();okhttp3.Call call=playbackProbe.getAndSet(null);if(call!=null)call.cancel();}
    void cancelReplacement(){inspectionLane.cancel();inspectionCatalog.cancel();okhttp3.Call call=inspectionProbe.getAndSet(null);if(call!=null)call.cancel();}
    private void invalidate(String id){playbackLane.cancel(id);browseLane.cancel(id);}
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
        JSONObject response=SourceHttp.request(url,new JSONObject(),null,null,url.startsWith("http://"));if(response.getInt("status")!=200)throw new Exception("音乐源地址返回 HTTP "+response.optInt("status"));
        return preview(new String(Base64.decode(response.getString("data"),Base64.DEFAULT),StandardCharsets.UTF_8),url,"url");
    }
    synchronized JSONArray install(String token,JSONObject requestedPolicy) throws Exception {
        JSONObject preview=previews.get(token);if(preview==null)throw new Exception("导入预览已失效，请重新选择");JSONObject manifest=preview.getJSONObject("manifest"),pack=preview.getJSONObject("pack");String id=manifest.getString("id");
        JSONObject oldSource=null;try{oldSource=find(id);}catch(Exception ignored){}
        JSONObject policy=SourcePolicy.validate(requestedPolicy!=null?requestedPolicy:oldSource==null?null:oldSource.optJSONObject("networkPolicy"));
        JSONObject declared=Json.obj("kind",preview.getString("kind"),"manifest",manifest,"networkPolicy",policy);
        ScriptEngine candidate=new ScriptEngine(context,pack.getString("script"),metadata(pack.getString("script")),SourcePolicy.hosts(declared,"apiHosts"),false,SourcePolicy.allowHttp(declared));
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
            for(int i=0;i<existing.length();i++) { JSONObject item=existing.getJSONObject(i);if(item.optString("id").equals(id)) { installed=item.optLong("installedAt",installed);settings=item.optJSONObject("settings")==null?settings:item.getJSONObject("settings");replaced=true;next.put(descriptor(preview,manifest,installed,settings,policy)); }else next.put(item); }
            if(!replaced)next.put(descriptor(preview,manifest,installed,settings,policy));
            android.util.AtomicFile file=new android.util.AtomicFile(new File(directory,id+".json"));FileOutputStream output=file.startWrite();try { output.write(pack.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(output); }catch(Exception e){file.failWrite(output);throw e;}
            store.set("sources",next);previews.remove(token);invalidate(id);return next;
        }finally {candidate.close();}
    }
    private static JSONObject descriptor(JSONObject preview,JSONObject manifest,long installed,JSONObject settings,JSONObject policy) { return Json.obj("id",manifest.optString("id"),"kind",preview.optString("kind"),"manifest",manifest,"enabled",true,"origin",preview.opt("origin"),"sha256",preview.optString("sha256"),"installedAt",installed,"status","ready","lastError","","settings",settings,"networkPolicy",policy); }
    private static JSONObject defaults(JSONObject manifest) { JSONObject result=new JSONObject();JSONArray settings=manifest.optJSONArray("settings");if(settings!=null)for(int i=0;i<settings.length();i++){JSONObject field=settings.optJSONObject(i);if(field!=null)Json.put(result,field.optString("key"),field.optString("default"));}return result; }
    synchronized JSONArray update(String id,String action,JSONObject args) throws Exception {
        JSONArray current=list(),next=new JSONArray();boolean found=false;
        for(int i=0;i<current.length();i++){JSONObject item=current.getJSONObject(i);if(item.optString("id").equals(id)){found=true;if(action.equals("remove")){new File(directory,id+".json").delete();continue;}if(action.equals("enable"))Json.put(item,"enabled",args.optBoolean("enabled"));else if(action.equals("configure")){if(args.has("networkPolicy"))Json.put(item,"networkPolicy",SourcePolicy.validate(args.getJSONObject("networkPolicy")));if(args.has("values")){JSONObject values=args.getJSONObject("values"),clean=new JSONObject();JSONArray fields=item.getJSONObject("manifest").getJSONArray("settings");for(int f=0;f<fields.length();f++){JSONObject field=fields.getJSONObject(f);String value=values.optString(field.getString("key"),field.optString("default"));if(value.length()>200)throw new IOException("源选项内容过长");if(field.optString("type").equals("select")&&!field.getJSONArray("options").toString().contains(JSONObject.quote(value)))throw new IOException("源选项无效");Json.put(clean,field.getString("key"),value);}Json.put(item,"settings",clean);}}else throw new Exception("未知音乐源操作");}next.put(item);}
        if(!found)throw new Exception("音乐源不存在");store.set("sources",next);invalidate(id);return next;
    }
    private JSONObject find(String id) throws Exception {
        // Metadata identity for imported public playlists. Never listed or used
        // as a playback service: resolution still iterates installed providers.
        if(id.equals("lx.playlist:catalog"))return Json.obj("id",id,"kind","lx","enabled",true,"settings",new JSONObject(),"manifest",Json.obj("lxPlatforms",Json.obj("tx",new JSONObject(),"wy",new JSONObject(),"kw",new JSONObject())),"networkPolicy",Json.obj("allowHttp",false,"hosts",JSONObject.NULL));
        JSONArray sources=list();for(int i=0;i<sources.length();i++)if(sources.getJSONObject(i).optString("id").equals(id))return sources.getJSONObject(i);throw new Exception("请先配置音乐源");
    }
    JSONObject search(String id,String keyword,String cursor) throws Exception {
        return search(id,keyword,cursor,false,20000);
    }
    private JSONObject search(String id,String keyword,String cursor,boolean playback,long timeout) throws Exception {
        JSONObject source=find(id);if(!source.optBoolean("enabled"))throw new Exception("音乐源已停用");JSONObject settings=source.getJSONObject("settings"),result;
        if(source.optString("kind").equals("lx")) { String platform=settings.optString("lxCatalog",source.getJSONObject("manifest").getJSONObject("lxPlatforms").keys().next()); result=(JSONObject)catalogCall("catalog:search",Json.array(platform,keyword,Math.max(1,parsePage(cursor)),25),playback,timeout); }
        else result=(JSONObject)invoke(source,"search",Json.obj("keyword",keyword,"cursor",cursor.isEmpty()?null:cursor,"pageSize",25),settings,playback,timeout);
        JSONArray rows=result.optJSONArray("items"),tracks=new JSONArray();if(rows!=null)for(int i=0;i<rows.length()&&i<100;i++){JSONObject song=rows.optJSONObject(i);if(song==null||song.optString("remoteId").isEmpty()||song.optString("title").isEmpty())continue;String remote=song.getString("remoteId");JSONObject track=Json.copy(song);Json.put(track,"id",id+":"+sha(remote).substring(0,24));Json.put(track,"providerId",id);Json.put(track,"source","custom");Json.put(track,"path","");Json.put(track,"audioUrl","");if(!track.has("duration"))Json.put(track,"duration",0);if(!track.has("artist"))Json.put(track,"artist","");
            String hint=track.optString("coverUrl");track.remove("coverUrl");track.remove("coverHint");
            if(hint.length()<=1500&&(hint.startsWith("https://")||hint.startsWith("http://")))Json.put(track,"coverHint",hint);
            String cached=cachedArtwork(track);if(!cached.isEmpty())Json.put(track,"coverUrl",cached);tracks.put(track);}
        return Json.obj("items",tracks,"nextCursor",result.opt("nextCursor"));
    }
    JSONObject artwork(JSONObject track) throws Exception {
        String cached=cachedArtwork(track);if(!cached.isEmpty())return Json.obj("url",cached);
        long epoch=metadataEpoch.get();JSONObject source=find(track.getString("providerId"));
        String url=track.optString("coverHint",track.optString("coverUrl"));
        if(!url.startsWith("http://")&&!url.startsWith("https://")){
            Object value=source.optString("kind").equals("lx") ? catalogCall("catalog:artwork",Json.array(readInfo(track))) : invoke(source,"artwork",Json.obj("remoteId",track.getString("remoteId")),source.getJSONObject("settings"));
            url=value instanceof JSONObject?((JSONObject)value).optString("url"):String.valueOf(value);
        }
        if(url.equals("null")||url.isBlank())return new JSONObject();
        JSONObject response=SourceHttp.request(url,new JSONObject(),SourcePolicy.hosts(source,"artworkHosts"),null,SourcePolicy.allowHttp(source));
        if(response.optInt("status")!=200)throw new IOException("封面资源暂不可用");
        byte[] data=Base64.decode(response.getString("data"),Base64.DEFAULT);String extension;
        if(data.length>=8&&(data[0]&255)==137&&data[1]==80&&data[2]==78&&data[3]==71)extension="png";
        else if(data.length>=3&&(data[0]&255)==255&&(data[1]&255)==216&&(data[2]&255)==255)extension="jpg";
        else if(data.length>=6&&new String(data,0,6,StandardCharsets.US_ASCII).matches("GIF8[79]a"))extension="gif";
        else if(data.length>=12&&new String(data,0,4,StandardCharsets.US_ASCII).equals("RIFF")&&new String(data,8,4,StandardCharsets.US_ASCII).equals("WEBP"))extension="webp";
        else throw new IOException("封面格式不受支持");
        synchronized(this){
        if(epoch!=metadataEpoch.get())return new JSONObject();
        cached=cachedArtwork(track);if(!cached.isEmpty())return Json.obj("url",cached);
        File folder=new File(context.getCacheDir(),"source-artwork");if(!folder.isDirectory()&&!folder.mkdirs())throw new IOException("无法保存封面缓存");
        File target=new File(folder,sha(track.getString("id"))+"."+extension),temporary=File.createTempFile("cover-",".tmp",folder);
        try{try(OutputStream output=new FileOutputStream(temporary)){output.write(data);}if(!temporary.renameTo(target))throw new IOException("无法保存封面缓存");}finally{temporary.delete();}
        if(epoch!=metadataEpoch.get()){target.delete();return new JSONObject();}pruneMetadata();
        return target.isFile()?Json.obj("url",target.getAbsolutePath()):new JSONObject();
        }
    }
    String cachedArtwork(JSONObject track){try{File folder=new File(context.getCacheDir(),"source-artwork");String hash=sha(track.optString("id"));for(String extension:List.of("jpg","png","webp","gif")){File file=new File(folder,hash+"."+extension);if(file.isFile()&&file.length()>0&&file.length()<=SourceHttp.MAX_BYTES)return file.getAbsolutePath();}}catch(Exception ignored){}return "";}
    Object lyrics(JSONObject track) throws Exception {
        if(track.optString("source").equals("local"))return JSONObject.NULL;
        long epoch=metadataEpoch.get();
        File lyricDirectory=new File(context.getCacheDir(),"lyrics");lyricDirectory.mkdirs();File cached=new File(lyricDirectory,sha(track.getString("id"))+".json");
        if(cached.exists())try{return new JSONObject(new String(SourceHttp.bounded(new FileInputStream(cached),512*1024),StandardCharsets.UTF_8));}catch(Exception ignored){}
        JSONObject source=find(track.getString("providerId"));Object value=source.optString("kind").equals("lx")?catalogCall("catalog:lyrics",Json.array(readInfo(track))):invoke(source,"lyrics",Json.obj("remoteId",track.getString("remoteId")),source.getJSONObject("settings"));
        if(value instanceof String)value=Json.obj("text",value,"format","lrc","source","custom");if(value instanceof JSONObject){Json.put((JSONObject)value,"source","custom");byte[] data=value.toString().getBytes(StandardCharsets.UTF_8);if(data.length<512*1024&&epoch==metadataEpoch.get()){try(OutputStream output=new FileOutputStream(cached)){output.write(data);}if(epoch!=metadataEpoch.get())cached.delete();pruneMetadata();}}return value;
    }
    long metadataLimit(){return Math.max(8,Math.min(64,store.integer("cacheLimitMiB",512)/8))*1024L*1024L;}
    long metadataBytes(){return metadataBytes;}
    private List<File> metadataFiles(){List<File> values=new ArrayList<>();for(String folder:List.of("lyrics","source-artwork")){File[] files=new File(context.getCacheDir(),folder).listFiles(file->file.isFile()&&file.getName().matches("[a-f0-9]{64}\\.(json|jpg|png|webp|gif)"));if(files!=null)Collections.addAll(values,files);}return values;}
    synchronized void pruneMetadata(){List<File> files=metadataFiles();files.sort(Comparator.comparingLong(File::lastModified));long used=0;for(File file:files)used+=file.length();long limit=metadataLimit(),now=System.currentTimeMillis();for(File file:files)if(used>limit||now-file.lastModified()>30L*86400000L){long size=file.length();if(file.delete())used-=size;}metadataBytes=used;}
    synchronized void clearMetadata(){metadataEpoch.incrementAndGet();for(File file:metadataFiles())file.delete();pruneMetadata();}
    JSONObject inspectReplacement(JSONObject args,java.util.function.BooleanSupplier cancel)throws Exception{
        return inspectReplacement(args,cancel,song->false);
    }
    JSONObject inspectReplacement(JSONObject args,java.util.function.BooleanSupplier cancel,java.util.function.Predicate<JSONObject> completeCache)throws Exception{
        inspecting.set(true);
        try{
            PlaylistReplacement manager=new PlaylistReplacement(store,this);JSONObject reference=Json.obj("id",args.getString("trackId"),"playlistId",args.getString("id"));JSONObject[] ctx=manager.context(reference);if(ctx==null)throw new Exception("歌曲已移出歌单");
            if(args.optJSONObject("candidate")==null&&ctx[1].optJSONObject("replacement")==null){
                JSONObject cachedReference=Json.copy(ctx[1]);Json.put(cachedReference,"playlistId",args.getString("id"));
                if(completeCache.test(cachedReference)){PlaylistReplacement.check(cancel);JSONObject state=ReplacementRules.empty();Json.put(state,"status","original");Json.put(state,"message","原曲已有完整缓存，无需平替");manager.save(ctx,null,state,cancel);return store.object("personal");}
                try{JSONObject result=resolve(ctx[1],new HashSet<>(),"high",(phase,message)->{},cancel);PlaylistReplacement.check(cancel);replacementProbe(result);PlaylistReplacement.check(cancel);JSONObject state=ReplacementRules.empty();Json.put(state,"status","original");Json.put(state,"message","原曲音频响应正常，待实际播放验证");manager.save(ctx,null,state,cancel);return store.object("personal");}
                catch(Exception failure){PlaylistReplacement.check(cancel);}
            }
            try{manager.run(ctx,args.optJSONObject("candidate"),(phase,message)->{},cancel);}catch(Exception failure){PlaylistReplacement.check(cancel);if(manager.context(reference)[1].optJSONObject("replacement")==null)throw failure;}
            return store.object("personal");
        }finally{inspecting.remove();inspectionLane.trimIdle();inspectionCatalog.trimIdle();}
    }
    JSONArray replacementSearch(String keyword,java.util.function.BooleanSupplier cancel)throws Exception{
        return replacementSearch(keyword,cancel,Integer.MAX_VALUE);
    }
    JSONArray replacementSearch(String keyword,java.util.function.BooleanSupplier cancel,int limit)throws Exception{
        return replacementSearch(keyword,cancel,limit,(phase,message)->{});
    }
    JSONArray replacementSearch(String keyword,java.util.function.BooleanSupplier cancel,int limit,Progress progress)throws Exception{
        Set<String> seen=new HashSet<>();
        int requested=0,completed=0;Exception last=null;
        JSONArray result=new JSONArray(),installed=list();for(int i=0;i<installed.length();i++){
            PlaylistReplacement.check(cancel);JSONObject source=installed.getJSONObject(i);String caps=source.getJSONObject("manifest").getJSONArray("capabilities").toString();if(!source.optBoolean("enabled")||!caps.contains("\"search\"")||!caps.contains("\"resolvePlayback\""))continue;
            String name=source.getJSONObject("manifest").optString("name","音乐源");requested++;progress.update("resolving","正在搜索歌名 · "+keyword+" · "+name);
            try{JSONArray rows=search(source.getString("id"),keyword,"",true,0).getJSONArray("items");completed++;progress.update("resolving",name+" 返回 "+rows.length()+" 项结果，正在选取前三个候选");for(int j=0;j<rows.length();j++){try{JSONObject row=ReplacementRules.target(rows.getJSONObject(j));if(seen.add(ReplacementRules.key(row)))result.put(row);}catch(Exception invalid){}if(result.length()>=limit)return result;}}catch(Exception failure){PlaylistReplacement.check(cancel);last=failure;progress.update("switching",name+" 搜索失败 · "+SourceDiagnostics.reason(failure));}
        }
        if(requested==0)throw new Exception("没有已启用且支持搜索与播放的音乐源");
        if(completed==0)throw new Exception("歌名搜索全部失败，尚未解析任何候选 · "+SourceDiagnostics.reason(last));
        return result;
    }
    JSONObject replacementExact(JSONObject target,String originalId)throws Exception{
        JSONObject source=find(target.getString("providerId"));if(!source.optBoolean("enabled"))throw new Exception("替代音源已停用");boolean lx=source.optString("kind").equals("lx");JSONObject info=lx?readInfo(target):null;JSONArray qualities=lx?source.getJSONObject("manifest").getJSONObject("lxPlatforms").getJSONObject(info.getString("source")).getJSONArray("qualitys"):source.getJSONObject("manifest").getJSONArray("qualities");String chosen="",normalized="";
        for(String q:List.of("320k","128k","flac")){String tier=q.equals("320k")?"high":q.equals("128k")?"standard":"lossless";if(qualities.toString().contains(JSONObject.quote(lx?q:tier))){chosen=q;normalized=tier;break;}}if(chosen.isEmpty())throw new Exception("音源不支持此歌曲目录或品质");
        Object value=lx?invoke(source,"lx",Json.obj("source",info.getString("source"),"action","musicUrl","info",Json.obj("type",chosen,"musicInfo",info)),source.getJSONObject("settings"),true,0):invoke(source,"resolvePlayback",Json.obj("remoteId",target.getString("remoteId"),"quality",normalized),source.getJSONObject("settings"),true,0);
        JSONObject result=value instanceof String?Json.obj("url",value):Json.copy((JSONObject)value);String url=result.optString("url");JSONArray hosts=SourcePolicy.hosts(source,"mediaHosts");SourceHttp.check(url,hosts,SourcePolicy.allowHttp(source));Json.put(result,"allowHttp",SourcePolicy.allowHttp(source));if(hosts!=null)Json.put(result,"mediaHosts",hosts);Json.put(result,"providerId",source.getString("id"));Json.put(result,"providerName",source.getJSONObject("manifest").optString("name"));Json.put(result,"quality",normalized);Json.put(result,"cacheKey",originalId+":"+normalized+":"+sha(source.getString("id")+"\n"+url));return result;
    }
    /** Three replacement SONGS; each song uses the same bounded source/quality plan as normal playback. */
    JSONObject replacementPlayable(JSONObject target,String originalId,String quality,Progress progress,java.util.function.BooleanSupplier cancel)throws Exception{
        Set<String> attempted=new HashSet<>();
        while(true){
            PlaylistReplacement.check(cancel);int before=attempted.size();
            JSONObject result=resolve(target,attempted,quality,progress,cancel);
            PlaylistReplacement.check(cancel);
            try{
                progress.update("connecting","正在检查当前候选音频 · "+result.optString("providerName"));
                replacementProbe(result);PlaylistReplacement.check(cancel);
                Json.put(result,"cacheKey",originalId+":"+result.optString("quality")+":"+sha(result.optString("providerId")+"\n"+result.getString("url")));
                return result;
            }catch(Exception failure){
                PlaylistReplacement.check(cancel);diagnostics.outcome(result,false,SourceDiagnostics.reason(failure));
                if(attempted.size()<=before)throw failure;
                progress.update("switching","当前候选连接明确失败，继续其他音源或音质 · "+SourceDiagnostics.reason(failure));
            }
        }
    }
    void replacementProbe(JSONObject result)throws Exception{
        okhttp3.Request.Builder request=new okhttp3.Request.Builder().url(result.getString("url")).header("Range","bytes=0-4095");JSONObject headers=result.optJSONObject("headers");if(headers!=null)for(Iterator<String> keys=headers.keys();keys.hasNext();){String key=keys.next();if(!key.matches("(?i)host|content-length|range"))request.header(key,headers.optString(key));}
        okhttp3.Call call=SourceHttp.playbackClient(result.optJSONArray("mediaHosts"),result.optBoolean("allowHttp")).newCall(request.build());java.util.concurrent.atomic.AtomicReference<okhttp3.Call> active=inspecting.get()?inspectionProbe:playbackProbe;active.set(call);
        try(okhttp3.Response response=call.execute()){
            if(!response.isSuccessful()||response.body()==null)throw new Exception("音频返回HTTP "+response.code());byte[] bytes=new byte[64];int count=0;java.io.InputStream input=response.body().byteStream();while(count<16){int read=input.read(bytes,count,bytes.length-count);if(read<0)break;count+=read;}if(!audioPrefix(bytes,count))throw new Exception("响应不是可识别的音频");
        }finally{active.compareAndSet(call,null);}
    }
    static boolean audioPrefix(byte[] bytes,int count){String text=new String(bytes,0,count,java.nio.charset.StandardCharsets.UTF_8);return count>=4&&(text.startsWith("ID3")||text.startsWith("fLaC")||text.startsWith("OggS")||text.startsWith("#EXTM3U")||text.startsWith("RIFF")&&count>=12&&new String(bytes,8,4,java.nio.charset.StandardCharsets.US_ASCII).equals("WAVE")||count>=8&&new String(bytes,4,4,java.nio.charset.StandardCharsets.US_ASCII).equals("ftyp")||(bytes[0]&255)==255&&(bytes[1]&224)==224);}
    interface Progress { void update(String phase,String message); }
    JSONObject resolve(JSONObject track,Set<String> attempted,String quality,Progress progress,java.util.function.BooleanSupplier cancelled) throws Exception {
        String family=family(track);List<JSONObject> installed=sourcePlan.order(list(),family,track.optString("providerId"));if(!store.readKeys("smoothPlayback").optBoolean("smoothPlayback")){installed=new ArrayList<>();JSONArray configured=list();for(int n=0;n<configured.length();n++){JSONObject item=configured.optJSONObject(n);if(item!=null&&item.optBoolean("enabled"))installed.add(item);}}else {JSONObject stats=diagnostics.state().optJSONObject("sources");if(stats!=null)installed.sort((a,b)->{int health=Boolean.compare(sourcePlan.cooling(a.optString("id")),sourcePlan.cooling(b.optString("id")));return health!=0?health:Long.compare(stats.optJSONObject(b.optString("id"))==null?0:stats.optJSONObject(b.optString("id")).optLong("lastPlayedAt"),stats.optJSONObject(a.optString("id"))==null?0:stats.optJSONObject(a.optString("id")).optLong("lastPlayedAt"));});}String preferred=track.optString("preferredPlaybackProviderId");if(!preferred.isEmpty()){JSONArray configured=list();for(int n=0;n<configured.length();n++){JSONObject item=configured.optJSONObject(n);if(item!=null&&item.optBoolean("enabled")&&item.optString("id").equals(preferred)&&installed.stream().noneMatch(value->value.optString("id").equals(preferred)))installed.add(item);}}installed.removeIf(item->{JSONObject manifest=item.optJSONObject("manifest");JSONArray capabilities=manifest==null?null:manifest.optJSONArray("capabilities");return capabilities!=null&&!capabilities.toString().contains(JSONObject.quote("resolvePlayback"));});if(!preferred.isEmpty())installed.sort((a,b)->Boolean.compare(!a.optString("id").equals(preferred),!b.optString("id").equals(preferred)));Exception last=null;JSONObject original=null;try{original=find(track.optString("providerId"));}catch(Exception ignored){}
        if(original!=null&&original.optString("kind").equals("lx")){String platform=readInfo(track).optString("source");installed.sort((a,b)->Boolean.compare(!directPlatform(a,platform),!directPlatform(b,platform)));}
        for(int i=0;i<installed.size();i++) {
            if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();
            JSONObject source=installed.get(i);String id=source.getString("id");JSONObject candidate=track;
            String label=" · "+source.getJSONObject("manifest").optString("name","音乐源")+"（"+(i+1)+"/"+installed.size()+"）";
            progress.update(i==0?"connecting":"switching",(i==0?"正在连接":"正在切换音乐源")+label);
            try {
                boolean same=source.optString("kind").equals("lx")&&original!=null&&original.optString("kind").equals("lx");
                if(same) { JSONObject info=readInfo(track);same=source.getJSONObject("manifest").getJSONObject("lxPlatforms").has(info.optString("source")); }
                if(!id.equals(track.optString("providerId"))&&!same) {
                    candidate=null;
                    String matchKey=track.optString("id")+":"+id; synchronized(matched){candidate=matched.get(matchKey);}
                    if(candidate==null){if(attempted.contains(id+":match"))continue;attempted.add(id+":match");
                    JSONArray matches=search(id,track.optString("title")+" "+track.optString("artist"),"",true,0).getJSONArray("items");
                    for(int j=0;j<matches.length();j++){JSONObject match=matches.getJSONObject(j);if(sameRecordingMetadata(track,match)){candidate=match;break;}}
                    if(candidate!=null)synchronized(matched){if(matched.size()>=32)matched.remove(matched.keySet().iterator().next());matched.put(matchKey,candidate);}}
                    if(candidate==null)continue;
                }
                String[] qualities=quality.equals("lossless")?new String[]{"flac","320k","128k"}:new String[]{"320k","128k","flac"};
                for(String q:qualities) {
                    if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();
                    String attempt=id+":"+q;if(attempted.contains(attempt))continue;attempted.add(attempt);
                    String normalized=q.equals("flac")?"lossless":q.equals("320k")?"high":"standard";
                    long diagnosticStarted=android.os.SystemClock.elapsedRealtime();
                    try {
                        boolean lx=source.optString("kind").equals("lx");JSONObject info=lx?readInfo(candidate):null;
                        if(lx){JSONObject platform=source.getJSONObject("manifest").getJSONObject("lxPlatforms").optJSONObject(info.optString("source"));if(platform==null||!platform.getJSONArray("qualitys").toString().contains(JSONObject.quote(q)))continue;}
                        else if(!source.getJSONObject("manifest").getJSONArray("qualities").toString().contains(JSONObject.quote(normalized)))continue;
                        progress.update("resolving","正在获取"+(normalized.equals("lossless")?"无损":normalized.equals("high")?"高品质":"标准品质")+"音频"+label);
                        Object value;
                        for(int retry=0;;retry++){
                            try {
                                value=lx?invoke(source,"lx",Json.obj("source",info.optString("source"),"action","musicUrl","info",Json.obj("type",q,"musicInfo",info)),source.getJSONObject("settings"),true,0)
                                    :invoke(source,"resolvePlayback",Json.obj("remoteId",candidate.getString("remoteId"),"quality",normalized),source.getJSONObject("settings"),true,0);
                                break;
                            }catch(Exception failure){
                                if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
                                if(retry!=0||!PlaybackSourcePlan.retryTransient(failure))throw failure;
                                diagnostics.record(id,diagnosticStarted,failure);
                                progress.update("retrying","连接暂时失败，重试一次"+label);
                                diagnosticStarted=android.os.SystemClock.elapsedRealtime();
                                if(cancelled.getAsBoolean())throw new java.util.concurrent.CancellationException();
                            }
                        }
                        JSONObject result=value instanceof JSONObject?(JSONObject)value:Json.obj("url",value);String url=result.optString("url");JSONArray mediaHosts=SourcePolicy.hosts(source,"mediaHosts");SourceHttp.check(url,mediaHosts,SourcePolicy.allowHttp(source));
                        if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();
                        Json.put(result,"allowHttp",SourcePolicy.allowHttp(source));if(mediaHosts!=null)Json.put(result,"mediaHosts",mediaHosts);
                        Json.put(result,"providerName",source.getJSONObject("manifest").optString("name","音乐源"));Json.put(result,"diagnosticAttemptId",diagnostics.record(id,diagnosticStarted,null));progress.update("connecting","地址已取得，正在连接音频"+label);
                        // Different providers/URLs can encode different byte streams.
                        // Never concatenate an old provider's cached prefix with a fallback.
                        Json.put(result,"quality",normalized);Json.put(result,"providerId",id);Json.put(result,"cacheKey",track.getString("id")+":"+normalized+":"+sha(id+"\n"+url));return result;
                    }catch(Exception e){if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();diagnostics.record(id,diagnosticStarted,e);last=e;if(PlaybackSourcePlan.transportFailure(e)){sourcePlan.failure(id);break;}progress.update("retrying","当前品质不可用，尝试下一档"+label);}
                }
            }catch(java.util.concurrent.CancellationException e){throw e;}catch(Exception e){if(cancelled.getAsBoolean()||Thread.currentThread().isInterrupted())throw new java.util.concurrent.CancellationException();last=e;if(PlaybackSourcePlan.transportFailure(e))sourcePlan.failure(id);}
        }
        throw new Exception(last==null?"没有可用音乐源，请在个人空间中配置":"全部资源暂不可用，请检查网络或更换音乐源。"+Json.message(last));
    }
    private String family(JSONObject track){try{JSONObject source=find(track.optString("providerId"));if(source.optString("kind").equals("lx"))return "lx:"+readInfo(track).optString("source");}catch(Exception ignored){}return track.optString("providerId");}
    void playbackReady(JSONObject track,JSONObject result){diagnostics.outcome(result,true,null);if(track!=null&&result!=null&&!result.has("cacheHit"))sourcePlan.success(family(track),result.optString("providerId"));}
    void playbackFailed(JSONObject result,boolean transport){diagnostics.outcome(result,false,transport?"网络连接失败":"音频格式不支持");if(transport&&result!=null&&!result.has("cacheHit"))sourcePlan.failure(result.optString("providerId"));}
    JSONObject cachedNetwork(JSONObject saved)throws Exception {JSONObject source=find(saved.getString("providerId"));if(!source.optBoolean("enabled"))throw new Exception("原音乐源已关闭");JSONObject copy=Json.copy(saved);JSONArray hosts=SourcePolicy.hosts(source,"mediaHosts");SourceHttp.check(copy.getString("url"),hosts,SourcePolicy.allowHttp(source));Json.put(copy,"mediaHosts",hosts==null?JSONObject.NULL:hosts);Json.put(copy,"allowHttp",SourcePolicy.allowHttp(source));return copy;}
    synchronized JSONArray move(String id,int direction)throws Exception {JSONArray current=list();int at=-1;for(int i=0;i<current.length();i++)if(current.optJSONObject(i).optString("id").equals(id))at=i;if(at<0)throw new Exception("音乐源不存在");int next=Math.max(0,Math.min(current.length()-1,at+(direction<0?-1:1)));JSONArray result=new JSONArray();for(int i=0;i<current.length();i++)result.put(current.opt(i==at?next:i==next?at:i));store.set("sources",result);return result;}
    private static boolean directPlatform(JSONObject source,String platform){JSONObject manifest=source.optJSONObject("manifest"),platforms=manifest==null?null:manifest.optJSONObject("lxPlatforms");return source.optString("kind").equals("lx")&&platforms!=null&&platforms.has(platform);}
    private static int parsePage(String text){try{return Integer.parseInt(text);}catch(Exception e){return 1;}}
    private static String recordingText(String value){return java.text.Normalizer.normalize(value,java.text.Normalizer.Form.NFKC).toLowerCase(Locale.ROOT).replaceAll("[\\u200b-\\u200d\\ufeff]","").trim().replaceAll("\\s+"," ");}
    static boolean sameRecordingMetadata(JSONObject original,JSONObject candidate){
        String title=recordingText(original.optString("title")),artist=recordingText(original.optString("artist")),album=recordingText(original.optString("album")),otherAlbum=recordingText(candidate.optString("album"));
        double duration=original.optDouble("duration",0),otherDuration=candidate.optDouble("duration",0);
        return !title.isEmpty()&&!artist.isEmpty()&&title.equals(recordingText(candidate.optString("title")))&&artist.equals(recordingText(candidate.optString("artist")))
            &&(album.isEmpty()||otherAlbum.isEmpty()||album.equals(otherAlbum))&&Double.isFinite(duration)&&Double.isFinite(otherDuration)&&duration>0&&otherDuration>0&&Math.abs(duration-otherDuration)<=3;
    }
    private static JSONObject readInfo(JSONObject track) throws JSONException { return new JSONObject(new String(Base64.decode(track.getString("remoteId"),Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING),StandardCharsets.UTF_8)); }
    static String sha(String text) throws Exception { StringBuilder b=new StringBuilder();for(byte value:MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))b.append(String.format("%02x",value&255));return b.toString(); }
    private static JSONObject metadata(String script) { JSONObject info=new JSONObject();for(String field:List.of("name","author","description","version","homepage")){Matcher m=Pattern.compile("^\\s*\\*\\s*@"+field+"\\s+(.+)$",Pattern.MULTILINE|Pattern.CASE_INSENSITIVE).matcher(script);Json.put(info,field,m.find()?m.group(1).trim():field.equals("name")?"自定义音乐源":field.equals("version")?"1":"");}Json.put(info,"rawScript",script);return info; }
    void trimIdle(){playbackLane.trimIdle();playbackCatalog.trimIdle();browseLane.trimIdle();browseCatalog.trimIdle();}
    @Override public void close() {diagnostics.close();cancelReplacement();cancelPlayback();playbackLane.cancel();playbackCatalog.cancel();browseLane.cancel();browseCatalog.cancel();}
}
