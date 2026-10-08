package com.zenix.musicplayer;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import org.json.*;
import java.text.*;
import java.util.*;

final class ListeningStats extends SQLiteOpenHelper {
    ListeningStats(Context context){super(context,"listening-stats.db",null,1);}
    @Override public void onCreate(SQLiteDatabase db){db.execSQL("CREATE TABLE listening(day TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,artist TEXT NOT NULL,seconds REAL NOT NULL,plays INTEGER NOT NULL,PRIMARY KEY(day,id))");db.execSQL("CREATE TABLE meta(startedAt INTEGER NOT NULL)");db.execSQL("INSERT INTO meta VALUES(?)",new Object[]{System.currentTimeMillis()});}
    @Override public void onUpgrade(SQLiteDatabase db,int oldVersion,int newVersion){}
    static String day(long now){return new SimpleDateFormat("yyyy-MM-dd",Locale.ROOT).format(new Date(now));}
    synchronized void record(JSONObject track,double seconds,int plays,long now)throws Exception {
        if(track==null||!Double.isFinite(seconds)||seconds<0||seconds>20||plays<0||plays>1)throw new Exception("聆听记录无效");
        String title=track.optString("title"),artist=track.optString("artist"),id=MusicSources.sha(java.text.Normalizer.normalize(title+"\u0000"+artist,java.text.Normalizer.Form.NFKC).toLowerCase(Locale.ROOT)).substring(0,24),date=day(now);
        SQLiteDatabase db=getWritableDatabase();db.beginTransaction();try{db.execSQL("INSERT OR IGNORE INTO listening VALUES(?,?,?,?,0,0)",new Object[]{date,id,title.substring(0,Math.min(300,title.length())),artist.substring(0,Math.min(300,artist.length()))});db.execSQL("UPDATE listening SET seconds=seconds+?,plays=plays+? WHERE day=? AND id=?",new Object[]{seconds,plays,date,id});db.execSQL("DELETE FROM listening WHERE day<?",new Object[]{day(now-365L*86400000)});db.setTransactionSuccessful();}finally{db.endTransaction();}
    }
    synchronized JSONObject query(String from,String to)throws Exception {
        if(!from.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")||!to.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")||from.compareTo(to)>0)throw new Exception("统计时间范围无效");SQLiteDatabase db=getReadableDatabase();String[] range={from,to};long started;
        try(Cursor c=db.rawQuery("SELECT startedAt FROM meta",null)){c.moveToFirst();started=c.getLong(0);}
        JSONObject result=Json.obj("startedAt",started,"from",from,"to",to);
        try(Cursor c=db.rawQuery("SELECT COALESCE(SUM(seconds),0),COALESCE(SUM(plays),0),COUNT(DISTINCT id),COUNT(DISTINCT day) FROM listening WHERE day>=? AND day<=?",range)){c.moveToFirst();Json.put(result,"seconds",c.getDouble(0));Json.put(result,"plays",c.getInt(1));Json.put(result,"uniqueTracks",c.getInt(2));Json.put(result,"activeDays",c.getInt(3));}
        JSONArray songs=new JSONArray(),artists=new JSONArray(),days=new JSONArray();
        try(Cursor c=db.rawQuery("SELECT title,artist,SUM(seconds),SUM(plays) FROM listening WHERE day>=? AND day<=? GROUP BY id ORDER BY SUM(seconds) DESC LIMIT 10",range)){while(c.moveToNext())songs.put(Json.obj("title",c.getString(0),"artist",c.getString(1),"seconds",c.getDouble(2),"plays",c.getInt(3)));}
        try(Cursor c=db.rawQuery("SELECT artist,SUM(seconds),SUM(plays) FROM listening WHERE day>=? AND day<=? GROUP BY artist ORDER BY SUM(seconds) DESC LIMIT 10",range)){while(c.moveToNext())artists.put(Json.obj("name",c.getString(0).isEmpty()?"未知歌手":c.getString(0),"seconds",c.getDouble(1),"plays",c.getInt(2)));}
        try(Cursor c=db.rawQuery("SELECT day,SUM(seconds),SUM(plays) FROM listening WHERE day>=? AND day<=? GROUP BY day ORDER BY day",range)){while(c.moveToNext())days.put(Json.obj("date",c.getString(0),"seconds",c.getDouble(1),"plays",c.getInt(2)));}
        Json.put(result,"topTracks",songs);Json.put(result,"topArtists",artists);Json.put(result,"days",days);return result;
    }
}
