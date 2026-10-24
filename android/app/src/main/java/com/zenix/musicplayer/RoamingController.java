package com.zenix.musicplayer;

import android.os.SystemClock;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

/** Local recommendation and exploration. Network work is serialized outside the player thread. */
final class RoamingController implements AutoCloseable {
    private final ZenixRuntime runtime;
    private final PlaybackService service;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final ExecutorService persistence=Executors.newSingleThreadExecutor();
    private final Set<String> queried=new LinkedHashSet<>();
    private final LinkedHashMap<String,JSONObject> pool=new LinkedHashMap<>();
    private final LinkedHashMap<String,JSONObject> displayed=new LinkedHashMap<>();
    private final RoamingHistory replay=new RoamingHistory();
    private final LinkedHashMap<String,Query> queries=new LinkedHashMap<>();
    private JSONObject seen,affinity;
    private final RoamingLedger ledger;
    private final JSONObject dirtySeen=new JSONObject();
    private boolean initialized,startRequested;
    private String initializationError="";
    private JSONArray recent;
    private boolean active,waiting,searching,closed,paused;
    private String phase="idle",message="";
    private volatile long generation;
    private int failures,searchFailures,discovered,queryTurn,emptySearches,selection;
    private Branch branch;
    private static final class Branch {final LinkedHashMap<String,JSONObject> pool;final LinkedHashMap<String,Query> queries;final Set<String> queried;final Set<String> counted=new HashSet<>();int remaining;Branch(LinkedHashMap<String,JSONObject> p,LinkedHashMap<String,Query> q,Set<String> known,int count){pool=new LinkedHashMap<>(p);queries=new LinkedHashMap<>(q);queried=new LinkedHashSet<>(known);remaining=count;}}
    Object feature(JSONObject args)throws Exception{if(args.optString("edit").equals("return")){if(branch==null)throw new Exception("当前没有临时漫游路线");returnBranch();return Json.obj("branch",false);}if(!args.optString("edit").equals("branch"))throw new Exception("未知漫游设置");if(!active)throw new Exception("请先开始音乐漫游");String keyword=args.optString("keyword").trim();if(keyword.length()>120)keyword=keyword.substring(0,120);JSONObject track=args.optJSONObject("track");if(track==null)track=Json.obj("artist",keyword);if(track.optString("artist").isBlank())throw new Exception("当前歌曲没有歌手信息");returnBranch();generation++;selection++;searching=false;branch=new Branch(pool,queries,queried,Math.max(1,Math.min(5,args.optInt("count",3))));if(listening!=null)branch.counted.add(listening.optString("id"));pool.clear();queries.clear();queried.clear();emptySearches=0;addKeyword(keyword.isEmpty()?track.optString("artist"):keyword);save();if(waiting)pump();return Json.obj("branch",true,"remaining",branch.remaining);}
    private void returnBranch(){if(branch==null)return;Branch saved=branch;branch=null;generation++;selection++;searching=false;pool.clear();pool.putAll(saved.pool);queries.clear();queries.putAll(saved.queries);queried.clear();queried.addAll(saved.queried);emptySearches=0;save();}

    private JSONObject listening;
    private double listened;
    private long lastTick;private boolean listeningSaved;
    private static final int POOL_LIMIT=80,DISPLAY_LIMIT=60,QUERY_LIMIT=36;
    private static final class Query {
        final String source,keyword; String cursor=""; int pages; boolean done;
        Query(String source,String keyword){this.source=source;this.keyword=keyword;}
    }
    RoamingController(ZenixRuntime runtime,PlaybackService service){
        this.runtime=runtime;this.service=service;
        JSONObject saved=runtime.store.object("roaming");
        seen=saved==null?new JSONObject():saved.optJSONObject("seen");if(seen==null)seen=new JSONObject();
        affinity=saved==null?new JSONObject():saved.optJSONObject("artistAffinity");if(affinity==null)affinity=new JSONObject();
        recent=saved==null?new JSONArray():saved.optJSONArray("recentArtists");if(recent==null)recent=new JSONArray();
        if(saved!=null){JSONArray plans=saved.optJSONArray("queries");if(plans!=null)for(int i=0;i<plans.length()&&i<QUERY_LIMIT;i++){JSONObject item=plans.optJSONObject(i);if(item==null)continue;Query q=new Query(item.optString("source"),item.optString("keyword"));q.cursor=item.optString("cursor");q.pages=item.optInt("pages");q.done=item.optBoolean("done");String key=item.optString("key");queries.put(key,q);queried.add(key);}discovered=saved.optInt("discovered");active=saved.optBoolean("active");JSONArray values=saved.optJSONArray("tracks");if(values!=null)for(int i=0;i<values.length()&&i<DISPLAY_LIMIT;i++){JSONObject t=values.optJSONObject(i);if(t!=null)displayed.put(identity(t),t);}values=saved.optJSONArray("candidates");if(values!=null)for(int i=0;i<values.length()&&i<POOL_LIMIT;i++){JSONObject t=values.optJSONObject(i);if(t!=null&&!seen.has(identity(t)))pool.put(identity(t),t);}if(active){paused=true;phase="paused";message="继续音乐漫游，发现下一首";}}
        ledger=new RoamingLedger(service);
        JSONObject legacy=Json.copy(seen);seen=new JSONObject();
        JSONObject migrated=persisted();
        persistence.execute(()->{try{ledger.save(legacy);runtime.store.set("roaming",migrated);java.util.Set<String> used=new HashSet<>();JSONArray restored=migrated.optJSONArray("candidates");if(restored!=null)for(int i=0;i<restored.length();i++){JSONObject song=restored.optJSONObject(i);if(song!=null&&ledger.contains(identity(song)))used.add(identity(song));}runtime.main.post(()->{if(closed)return;pool.keySet().removeAll(used);initialized=true;if(startRequested){startRequested=false;start();}});}catch(Exception error){persistenceFailed(error);}});
        runtime.main.post(ticker);
    }
    boolean isActive(){return active;}
    boolean needsRetry(){return active&&(phase.equals("failed")||phase.equals("exhausted")||paused&&listening==null);}
    boolean pending(){return active&&!paused&&(waiting||phase.equals("searching")&&listening==null);}
    void userPause(){if(!active)return;sample();selection++;paused=true;waiting=false;phase="paused";message="漫游已暂停";save();runtime.emit();}
    void userResume(){paused=false;}

    JSONObject snapshot(){JSONArray tracks=new JSONArray();for(JSONObject value:displayed.values())tracks.put(Json.copy(value));return Json.obj("active",active,"phase",phase,"message",message,"discovered",discovered,"tracks",tracks);}
    private final Runnable ticker=new Runnable(){public void run(){if(closed)return;sample();runtime.main.postDelayed(this,1000);}};
    private void sample(){long now=SystemClock.elapsedRealtime();if(listening!=null&&service.isActuallyPlaying()&&lastTick>0)listened+=Math.min(2,(now-lastTick)/1000.0);lastTick=now;if(listening!=null&&!listeningSaved&&listened>=30){listeningSaved=true;mark(listening,"played");save();}}
    void selected(JSONObject track){finish("interrupted");listening=Json.copy(track);listened=0;listeningSaved=false;lastTick=SystemClock.elapsedRealtime();}
    void ready(JSONObject track){if(!active)return;failures=0;phase="playing";message="正在为你发现新音乐";if(track!=null)mark(track,"played");save();runtime.emit();pump();}
    void playingChanged(boolean playing){sample();if(playing&&branch!=null&&listening!=null&&branch.counted.add(listening.optString("id"))&&--branch.remaining<=0)returnBranch();lastTick=SystemClock.elapsedRealtime();if(active&&playing&&listening!=null){replay.record(listening);service.syncRoamingHistory(replay.before(listening.optString("id")),replay.after(listening.optString("id")));}if(active&&!waiting&&!searching&&!phase.equals("failed")&&!phase.equals("exhausted")){phase=playing?"playing":"paused";message=playing?"正在为你发现新音乐":"漫游已暂停";runtime.emit();}if(playing)pump();}
    private void finish(String reason){sample();if(listening==null)return;JSONObject song=listening;double seconds=listened,duration=service.currentDuration();listening=null;listened=0;
        double ratio=duration>0?seconds/duration:0;
        double delta=ratio>=.8?3:ratio>=.5?2:seconds>=30?.5:reason.equals("skip")&&seconds>.1&&seconds<15?-.7:0;
        if(!reason.equals("failed")&&delta!=0)for(String artist:artists(song)){JSONObject entry=affinity.optJSONObject(artist);double score=entry==null?0:decayed(entry);Json.put(affinity,artist,Json.obj("score",Math.max(-15,Math.min(30,score+delta)),"updatedAt",System.currentTimeMillis()));}
        if(!active&&(seconds>=30||ratio>=.5))mark(song,"played");
        if(active){mark(song,reason);if(!reason.equals("failed")&&seconds>.1){JSONArray next=new JSONArray();for(String artist:artists(song))next.put(artist);for(int i=0;i<recent.length()&&next.length()<5;i++)if(!contains(next,recent.optString(i)))next.put(recent.optString(i));recent=next;}}
        save();
    }
    private static boolean contains(JSONArray values,String value){for(int i=0;i<values.length();i++)if(values.optString(i).equals(value))return true;return false;}
    private double decayed(JSONObject entry){return entry.optDouble("score")*Math.pow(.5,Math.max(0,System.currentTimeMillis()-entry.optLong("updatedAt",entry.optLong("at")))/(30.0*86400000));}
    void start(){
        if(closed)return;if(!initialized){if(!initializationError.isEmpty()){phase="failed";message=initializationError;runtime.emit();return;}startRequested=true;phase="searching";message="正在整理漫游记录";runtime.emit();return;}if(active&&!paused&&(phase.equals("playing")||pending())){runtime.emit();return;}if(active&&paused&&listening!=null){service.resume();return;}generation++;selection++;searching=false;searchFailures=0;failures=0;emptySearches=0;queryTurn=0;if(queries.isEmpty())queried.clear();
        JSONObject personal=runtime.store.object("personal");if(personal==null)personal=new JSONObject();JSONArray history=personal.optJSONArray("history");if(history==null)history=new JSONArray();
        JSONArray liked=personal.optJSONArray("liked"),favorites=personal.optJSONArray("favorites");
        if(history.length()==0&&(liked==null||liked.length()==0)&&(favorites==null||favorites.length()==0)){active=false;paused=false;phase="idle";message="先搜索并听一首歌曲，再开启音乐漫游";runtime.emit();return;}
        JSONArray sources=runtime.sources.list();boolean available=false;if(sources!=null)for(int i=0;i<sources.length();i++)if(sources.optJSONObject(i)!=null&&sources.optJSONObject(i).optBoolean("enabled")){available=true;break;}
        if(!available){active=false;phase="failed";message="请先配置一个可用音乐源";runtime.emit();return;}
        for(int i=0;i<history.length();i++){JSONObject row=history.optJSONObject(i),song=row==null?null:row.optJSONObject("track");if(song!=null){if(!seen.has(identity(song)))mark(song,"history");if(i<12)addSongQueries(song);}}
        for(String kind:List.of("liked","favorites")){JSONArray values=personal.optJSONArray(kind);if(values!=null)for(int i=values.length()-1;i>=0&&i>=values.length()-12;i--){JSONObject t=values.optJSONObject(i);if(t!=null)addSongQueries(t);}}
        active=true;paused=false;waiting=true;phase="searching";message="正在根据你的听歌习惯寻找新歌曲";save();runtime.emit();next(false);
    }
    void retry(){if(!initialized){start();return;}if(!active||queries.isEmpty()){start();return;}generation++;selection++;searching=false;failures=0;searchFailures=0;emptySearches=0;for(Query query:queries.values())if(query.done){query.done=false;if(query.cursor.equals("null"))query.cursor="";}paused=false;waiting=true;phase="searching";message="正在继续寻找新歌曲";runtime.emit();next(false);}
    void stop(){branch=null;generation++;selection++;searching=false;waiting=false;finish("interrupted");active=false;paused=false;phase="idle";message="";replay.clear();service.leaveRoaming();save();runtime.emit();}
    void normalQueue(){if(active)stop();else finish("skip");}
    void next(boolean ended){
        if(active){JSONObject forward=replay.next(listening==null?"":listening.optString("id"));if(forward!=null){playAgain(forward);return;}}
        if(!active)return;paused=false;finish(ended?"ended":"skip");waiting=true;service.waitForRoaming();JSONObject candidate=choose();
        if(candidate!=null){waiting=false;emptySearches=0;pool.remove(identity(candidate));display(candidate);mark(candidate,"selected");phase="searching";message="正在准备下一首新歌曲";saveAndPlay(candidate);runtime.emit();}else {phase="searching";message="正在寻找下一首新歌曲";pump();}
    }
    void play(String id)throws Exception {
        if(active&&replay.has(id)){playAgain(replay.get(id));return;}
        if(!active)throw new Exception("漫游未开启");JSONObject song=null;for(JSONObject value:displayed.values())if(value.optString("id").equals(id))song=value;if(song==null)for(JSONObject value:pool.values())if(value.optString("id").equals(id))song=value;if(song==null)throw new Exception("这首歌曲已不在当前漫游中");paused=false;finish("skip");service.waitForRoaming();pool.remove(identity(song));display(song);mark(song,"selected");waiting=false;phase="searching";message="正在准备这首歌曲";saveAndPlay(song);runtime.emit();
    }
    void previous(){if(!active)return;JSONObject previous=replay.previous(listening==null?"":listening.optString("id"));if(previous!=null)playAgain(previous);}
    private void playAgain(JSONObject song){paused=false;finish("interrupted");service.waitForRoaming();waiting=false;display(song);phase="searching";message="正在重听最近的漫游歌曲";saveAndPlay(song);runtime.emit();}
    JSONArray previousSongs(String id){return replay.before(id);}
    JSONArray followingSongs(String id){return replay.after(id);}
    private void saveAndPlay(JSONObject song){JSONObject value=persisted(),marks=Json.copy(dirtySeen);long token=generation;int request=++selection;JSONObject detached=Json.copy(song);persistence.execute(()->{try{ledger.save(marks);runtime.store.set("roaming",value);runtime.main.post(()->{acknowledge(marks);if(!closed&&active&&!paused&&token==generation&&request==selection)service.playRoaming(detached);});}catch(Exception error){persistenceFailed(error);}});}
    void failed(){if(!active)return;finish("failed");if(++failures>=4){waiting=false;phase="failed";message="连续多首资源不可用，请检查网络或音乐源后重试";save();runtime.emit();return;}message="这首暂不可用，继续探索下一首";runtime.emit();next(false);}
    private void mark(JSONObject track,String reason){pool.remove(identity(track));String key=identity(track);if(dirtySeen.length()>=512&&!dirtySeen.has(key)){persistenceFailed(new Exception("漫游记录暂时无法写入"));return;}JSONObject value=Json.obj("reason",reason,"at",System.currentTimeMillis());Json.put(seen,key,value);Json.put(dirtySeen,key,value);if(seen.length()>512){java.util.Iterator<String> keys=seen.keys();if(keys.hasNext())seen.remove(keys.next());}}
    private void display(JSONObject track){String key=identity(track);displayed.remove(key);displayed.put(key,PrivateStore.cleanTrack(track));while(displayed.size()>DISPLAY_LIMIT){String first=displayed.keySet().iterator().next();if(listening!=null&&first.equals(identity(listening))){JSONObject current=displayed.remove(first);displayed.put(first,current);}else displayed.remove(first);}}
    private void seedWeight(Map<String,Double> weights,JSONObject song,double value){if(song!=null)for(String name:artists(song))weights.put(name,weights.getOrDefault(name,0.0)+value);}
    private JSONObject choose(){
        JSONObject best=null;double bestScore=-Double.MAX_VALUE;Map<String,Double> weights=new HashMap<>();JSONObject personal=runtime.store.object("personal");
        if(personal!=null){JSONArray history=personal.optJSONArray("history");if(history!=null)for(int i=0;i<history.length()&&i<30;i++){JSONObject row=history.optJSONObject(i);seedWeight(weights,row==null?null:row.optJSONObject("track"),i<5?3-i*.3:.15);}
            for(String kind:List.of("liked","favorites")){JSONArray values=personal.optJSONArray(kind);if(values!=null)for(int i=0;i<values.length();i++)seedWeight(weights,values.optJSONObject(i),kind.equals("liked")?2:1);}
            JSONArray playlists=personal.optJSONArray("playlists");if(playlists!=null)for(int i=0;i<playlists.length();i++){JSONObject list=playlists.optJSONObject(i);JSONArray values=list==null?null:list.optJSONArray("tracks");if(values!=null)for(int j=0;j<values.length();j++)seedWeight(weights,values.optJSONObject(j),.4);}
        }
        JSONObject preferences=SpaceFeatureCommands.preferences(runtime.store);for(JSONObject song:pool.values()){if(seen.has(identity(song))||!SpaceFeatureCommands.allows(song,preferences,personal))continue;double score=Math.random()*1.7-SpaceFeatureCommands.reducePenalty(song,preferences);for(String name:artists(song)){JSONObject value=affinity.optJSONObject(name);score+=value==null?1:decayed(value);double known=weights.getOrDefault(name,0.0);score+=Math.log1p(known)*3;score+=(known>0?1-preferences.optDouble("discovery",.5):preferences.optDouble("discovery",.5))*8;for(int r=0;r<recent.length()&&r<preferences.optInt("artistGap");r++)if(recent.optString(r).equals(name))score-=100;if(contains(recent,name))score-=5;}if(score>bestScore){bestScore=score;best=song;}}
        return best;
    }
    private void addSongQueries(JSONObject track){String artist=track.optString("artist").trim();if(!artist.isEmpty()&&!artist.equals("本地音乐"))addKeyword(artist);for(String split:track.optString("artist").split("(?i)\\s*(?:[/、&＋+]|\\b(?:feat\\.?|ft\\.?|featuring)\\b|\\s[xX]\\s)\\s*"))if(!split.isBlank()&&!split.equals(artist))addKeyword(split.trim());String album=track.optString("album").trim();if(!album.isEmpty()&&!album.matches("(?i)未知专辑|unknown|single|单曲"))addKeyword(artist+" "+album);}
    private void addKeyword(String keyword){if(keyword.length()>120)keyword=keyword.substring(0,120);JSONArray sources=runtime.sources.list();Set<String> catalogs=new HashSet<>();if(sources==null)return;queries.entrySet().removeIf(entry->entry.getValue().done);for(int i=0;i<sources.length()&&queries.size()<QUERY_LIMIT;i++){JSONObject source=sources.optJSONObject(i);if(source==null||!source.optBoolean("enabled"))continue;JSONObject settings=source.optJSONObject("settings");String catalog=source.optString("kind").equals("lx")?"lx:"+(settings==null?"":settings.optString("lxCatalog")):source.optString("id");if(!catalogs.add(catalog))continue;String key=catalog+"|"+normalize(keyword);if(!queries.containsKey(key)&&queried.add(key))queries.put(key,new Query(source.optString("id"),keyword));}while(queried.size()>512)queried.remove(queried.iterator().next());}
    private Query query(){if(queries.isEmpty())return null;List<Query> values=new ArrayList<>(queries.values());for(int i=0;i<values.size();i++){Query q=values.get((queryTurn++)%values.size());if(!q.done)return q;}return null;}
    private void pump(){
        JSONObject policy=SpaceFeatureCommands.preferences(runtime.store),personal=runtime.store.object("personal");pool.entrySet().removeIf(entry->!SpaceFeatureCommands.allows(entry.getValue(),policy,personal));
        if(!active||closed||searching||phase.equals("failed")||!waiting&&!service.isActuallyPlaying()||pool.size()>=POOL_LIMIT||!waiting&&pool.size()>=8)return;
        JSONObject preferences=SpaceFeatureCommands.preferences(runtime.store);
        if(!preferences.optString("scope","all").equals("all")){searching=true;long token=generation;JSONArray scoped=SpaceFeatureCommands.scoped(preferences,runtime.store.object("personal"));worker.execute(()->{try{JSONArray unseen=new JSONArray();for(int i=0;i<scoped.length();i++){JSONObject song=scoped.optJSONObject(i);if(song!=null&&!ledger.contains(identity(song)))unseen.put(song);}runtime.main.post(()->{if(token!=generation||closed)return;searching=false;for(int i=0;i<unseen.length()&&pool.size()<POOL_LIMIT;i++){JSONObject song=unseen.optJSONObject(i);if(song!=null)pool.put(identity(song),PrivateStore.cleanTrack(song));}if(waiting){if(choose()!=null)next(false);else{phase="exhausted";message="当前范围内没有未听过且符合偏好的歌曲";waiting=false;save();runtime.emit();}}});}catch(Exception error){runtime.main.post(()->{if(token==generation){searching=false;phase="failed";waiting=false;message="无法读取漫游范围，请重试";runtime.emit();}});}});return;}
        Query query=emptySearches>=24?null:query();if(query==null&&branch!=null){returnBranch();pump();return;}if(query==null){if(waiting){phase="exhausted";message="这一轮暂时没有新的歌曲，可稍后重试或继续听歌扩展偏好";waiting=false;save();runtime.emit();}return;}
        searching=true;long token=generation;String cursor=query.cursor;String source=query.source,keyword=query.keyword;
        worker.execute(()->{try{if(token!=generation)return;JSONObject page=runtime.sources.search(source,keyword,cursor);JSONArray items=page.optJSONArray("items"),fresh=new JSONArray();if(items!=null)for(int i=0;i<items.length();i++){JSONObject song=items.optJSONObject(i);if(song!=null&&!ledger.contains(identity(song)))fresh.put(song);}Json.put(page,"items",fresh);runtime.main.post(()->{if(token!=generation||closed)return;searching=false;searchFailures=0;query.pages++;String next=page.optString("nextCursor","");query.done=next.isEmpty()||next.equals("null")||next.equals(cursor);query.cursor=next;JSONArray values=page.optJSONArray("items");if(values==null||values.length()==0)query.done=true;int added=0;if(values!=null)for(int i=0;i<values.length()&&pool.size()<POOL_LIMIT;i++){JSONObject song=values.optJSONObject(i);if(song==null||artists(song).isEmpty())continue;if(branch==null&&(queries.size()<QUERY_LIMIT||query.done))addSongQueries(song);String key=identity(song);if(seen.has(key)||pool.containsKey(key))continue;JSONObject clean=PrivateStore.cleanTrack(song);pool.put(key,clean);display(clean);added++;}discovered+=added;emptySearches=added>0?0:emptySearches+1;save();runtime.emit();if(waiting&&choose()!=null)next(false);else pump();});}catch(Exception e){runtime.main.post(()->{if(token!=generation||closed)return;searching=false;query.done=true;if(++searchFailures>=5){phase="failed";waiting=false;message="暂时无法检索新歌曲，请检查网络或音乐源后重试";save();runtime.emit();}else pump();});}});
    }
    private JSONObject persisted(){JSONArray plans=new JSONArray();for(Map.Entry<String,Query> entry:(branch==null?queries:branch.queries).entrySet()){Query q=entry.getValue();plans.put(Json.obj("key",entry.getKey(),"source",q.source,"keyword",q.keyword,"cursor",q.cursor,"pages",q.pages,"done",q.done));}
        return Json.obj("schemaVersion",1,"active",active,"seen",new JSONObject(),"artistAffinity",Json.copy(affinity),"recentArtists",recent,"discovered",discovered,"tracks",snapshot().optJSONArray("tracks"),"candidates",new JSONArray((branch==null?pool:branch.pool).values()),"queries",plans);
    }
    private void save(){if(affinity.length()>256){List<String> keys=new ArrayList<>();for(Iterator<String> it=affinity.keys();it.hasNext();)keys.add(it.next());keys.sort(Comparator.comparingLong(key->{JSONObject entry=affinity.optJSONObject(key);return entry==null?0:entry.optLong("updatedAt",entry.optLong("at"));}));for(int i=0;i<keys.size()-256;i++)affinity.remove(keys.get(i));}JSONObject value=persisted(),marks=Json.copy(dirtySeen);persistence.execute(()->{try{ledger.save(marks);runtime.store.set("roaming",value);runtime.main.post(()->acknowledge(marks));}catch(Exception error){persistenceFailed(error);}});}
    private void acknowledge(JSONObject marks){for(Iterator<String> keys=marks.keys();keys.hasNext();){String key=keys.next();JSONObject current=dirtySeen.optJSONObject(key),saved=marks.optJSONObject(key);if(current!=null&&saved!=null&&current.toString().equals(saved.toString()))dirtySeen.remove(key);}}
    private void persistenceFailed(Exception error){runtime.main.post(()->{if(closed)return;if(!initialized)initializationError="无法迁移漫游记录，原记录已保留，请释放存储并重启";generation++;selection++;waiting=false;searching=false;paused=true;phase="failed";message="无法保存漫游记录，请检查设备存储后重试";service.waitForRoaming();runtime.emit();});}
    static String normalize(String value){return value.toLowerCase(Locale.ROOT).replaceAll("[\\s\"'`“”‘’.,，。!！?？:：;；·•_\\-—()（）\\[\\]【】{}<>《》]","");}
    static List<String> artists(JSONObject song){TreeSet<String> names=new TreeSet<>();for(String name:song.optString("artist").split("(?i)\\s*(?:[/、&＋+]|\\b(?:feat\\.?|ft\\.?|featuring)\\b|\\s[xX]\\s)\\s*")){String value=normalize(name);if(!value.isEmpty()&&!value.matches("未知歌手|unknown|unknownartist|variousartists|群星"))names.add(value);}return new ArrayList<>(names);}
    static String identity(JSONObject song){String title=normalize(song.optString("title"));List<String> names=artists(song);String raw=!title.isEmpty()&&!names.isEmpty()?title+"|"+String.join("&",names):title+"|"+normalize(song.optString("artist"))+"|"+song.optString("remoteId",song.optString("path",song.optString("id")));int a=0x811c9dc5,b=5381;for(int i=0;i<raw.length();i++){a=(a^raw.charAt(i))*0x01000193;b=(b*33)^raw.charAt(i);}return "v1:"+String.format(Locale.ROOT,"%08x%08x",a,b);}
    @Override public void close(){finish("interrupted");closed=true;generation++;runtime.main.removeCallbacks(ticker);worker.shutdownNow();persistence.execute(()->{try{if(worker.awaitTermination(25,TimeUnit.SECONDS))ledger.close();}catch(InterruptedException error){Thread.currentThread().interrupt();}});persistence.shutdown();}
}
