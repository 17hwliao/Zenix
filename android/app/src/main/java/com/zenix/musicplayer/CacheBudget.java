package com.zenix.musicplayer;

import androidx.media3.common.C;
import androidx.media3.datasource.cache.*;
import java.util.*;

/** Mutable disk budget. Spans are removed by oldest access time, independent of songs/collections. */
final class CacheBudget implements CacheEvictor {
    private long limit,used;
    private final TreeSet<CacheSpan> spans=new TreeSet<>((a,b)->{int time=Long.compare(a.lastTouchTimestamp,b.lastTouchTimestamp);return time==0?a.compareTo(b):time;});
    CacheBudget(long limit){this.limit=limit;}
    void setLimit(Cache cache,long value){synchronized(cache){limit=value;trim(cache,0);}}
    @Override public boolean requiresCacheSpanTouches(){return true;}
    @Override public void onCacheInitialized(){}
    @Override public void onStartFile(Cache cache,String key,long position,long length){if(length!=C.LENGTH_UNSET)trim(cache,length);}
    @Override public void onSpanAdded(Cache cache,CacheSpan span){if(spans.add(span))used+=span.length;trim(cache,0);}
    @Override public void onSpanRemoved(Cache cache,CacheSpan span){if(spans.remove(span))used-=span.length;}
    @Override public void onSpanTouched(Cache cache,CacheSpan oldSpan,CacheSpan newSpan){onSpanRemoved(cache,oldSpan);onSpanAdded(cache,newSpan);}
    private void trim(Cache cache,long reserve){while(!spans.isEmpty()&&used+reserve>limit){CacheSpan first=spans.first();cache.removeSpan(first);}}
}
