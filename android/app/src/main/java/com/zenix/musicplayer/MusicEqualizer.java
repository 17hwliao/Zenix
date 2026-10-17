package com.zenix.musicplayer;
import android.media.audiofx.Equalizer;
import org.json.*;
final class MusicEqualizer {
    private Equalizer effect;private int session=-1;
    private static final int[] FREQUENCIES={31,62,125,250,500,1000,2000,4000,8000,16000};
    static JSONObject validate(JSONObject raw)throws Exception{
        JSONArray gains=raw.getJSONArray("gains");if(gains.length()!=10)throw new Exception("均衡器需要 10 段增益");JSONArray clean=new JSONArray();for(int i=0;i<10;i++){double value=gains.getDouble(i);if(!Double.isFinite(value)||value< -12||value>12)throw new Exception("均衡器增益必须为 -12 至 12 dB");clean.put(value);}return Json.obj("enabled",raw.optBoolean("enabled"),"gains",clean,"preset",raw.optString("preset","custom"));
    }
    boolean apply(int sessionId,JSONObject settings)throws Exception{
        if(settings==null||!settings.optBoolean("enabled")){if(effect!=null)effect.setEnabled(false);return false;}
        if(sessionId<=0)return false;
        if(effect==null||session!=sessionId){close();effect=new Equalizer(0,sessionId);session=sessionId;}
        JSONArray gains=settings.getJSONArray("gains");short[] range=effect.getBandLevelRange();
        for(short band=0;band<effect.getNumberOfBands();band++){double frequency=effect.getCenterFreq(band)/1000.0;int nearest=0;for(int i=1;i<FREQUENCIES.length;i++)if(Math.abs(Math.log(frequency/FREQUENCIES[i]))<Math.abs(Math.log(frequency/FREQUENCIES[nearest])))nearest=i;short level=(short)Math.max(range[0],Math.min(range[1],Math.round(gains.getDouble(nearest)*100)));effect.setBandLevel(band,level);}effect.setEnabled(true);return effect.getEnabled();
    }
    void close(){if(effect!=null){effect.release();effect=null;}session=-1;}
}
