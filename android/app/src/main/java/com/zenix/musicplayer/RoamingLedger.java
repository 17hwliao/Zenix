package com.zenix.musicplayer;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.*;
import org.json.*;
import java.util.Iterator;

/** Never prune lifetime identities. Read and write this index only on workers. */
final class RoamingLedger extends SQLiteOpenHelper {
    RoamingLedger(Context context){super(context,"roaming-ledger.db",null,1);setWriteAheadLoggingEnabled(true);}
    @Override public void onCreate(SQLiteDatabase database){database.execSQL("CREATE TABLE seen (identity TEXT PRIMARY KEY, reason TEXT NOT NULL, at INTEGER NOT NULL)");}
    @Override public void onUpgrade(SQLiteDatabase database,int oldVersion,int newVersion){throw new IllegalStateException("未知漫游记录版本");}
    boolean contains(String identity){try(Cursor cursor=getReadableDatabase().query("seen",new String[]{"identity"},"identity=?",new String[]{identity},null,null,null,"1")){return cursor.moveToFirst();}}
    void save(JSONObject values){SQLiteDatabase database=getWritableDatabase();database.beginTransaction();try{for(Iterator<String> keys=values.keys();keys.hasNext();){String key=keys.next();JSONObject entry=values.optJSONObject(key);if(entry==null)continue;ContentValues row=new ContentValues();row.put("identity",key);row.put("reason",entry.optString("reason"));row.put("at",entry.optLong("at"));if(database.insertWithOnConflict("seen",null,row,SQLiteDatabase.CONFLICT_REPLACE)==-1)throw new SQLiteException("无法保存漫游去重记录");}database.setTransactionSuccessful();}finally{database.endTransaction();}}
}
