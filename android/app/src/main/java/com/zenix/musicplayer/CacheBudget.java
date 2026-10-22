package com.zenix.musicplayer;

import androidx.media3.common.C;
import androidx.media3.datasource.cache.*;
import java.util.*;

/** Mutable disk budget. Spans are removed by oldest access time, independent of songs/collections. */
@androidx.annotation.OptIn(markerClass = androidx.media3.common.util.UnstableApi.class)
final class CacheBudget implements CacheEvictor {
    private long limit,used;
    private boolean initialized;
    private final java.util.function.Predicate<String> pinned;
    private final TreeSet<CacheSpan> spans=new TreeSet<>((a,b)->{int time=Long.compare(a.lastTouchTimestamp,b.lastTouchTimestamp);return time==0?a.compareTo(b):time;});
    CacheBudget(long limit){this(limit,key->false);}
    CacheBudget(long limit,java.util.function.Predicate<String> pinned){this.limit=limit;this.pinned=pinned;}
    void setLimit(Cache cache,long value){synchronized(cache){limit=value;trim(cache,0);}}
    @Override public boolean requiresCacheSpanTouches(){return true;}
    @Override public void onCacheInitialized(){initialized=true;}
    @Override public void onStartFile(Cache cache,String key,long position,long length){if(length!=C.LENGTH_UNSET)trim(cache,length);}
    @Override public void onSpanAdded(Cache cache,CacheSpan span){if(spans.add(span))used+=span.length;trim(cache,0);if(initialized&&used>limit)cache.removeSpan(span);}
    @Override public void onSpanRemoved(Cache cache,CacheSpan span){if(spans.remove(span))used-=span.length;}
    @Override public void onSpanTouched(Cache cache,CacheSpan oldSpan,CacheSpan newSpan){if(spans.remove(oldSpan))used-=oldSpan.length;if(spans.add(newSpan))used+=newSpan.length;}
    private void trim(Cache cache,long reserve){while(!spans.isEmpty()&&used+reserve>limit){CacheSpan first=null;for(CacheSpan span:spans)if(!pinned.test(span.key)){first=span;break;}if(first==null)return;cache.removeSpan(first);}}
}
