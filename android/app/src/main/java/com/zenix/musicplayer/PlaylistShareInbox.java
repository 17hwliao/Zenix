package com.zenix.musicplayer;

import android.content.Intent;
import org.json.JSONObject;

/** Untrusted share text is previewed in the UI, never imported or executed here. */
final class PlaylistShareInbox {
    private static String text="", token="";
    static synchronized boolean receive(Intent intent) {
        if(intent==null||!Intent.ACTION_SEND.equals(intent.getAction())||!"text/plain".equals(intent.getType()))return false;
        try {
            CharSequence value=intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if(value==null||value.length()==0||value.length()>500000)return false;
            text=value.toString();token=java.util.UUID.randomUUID().toString();return true;
        } catch(RuntimeException invalid){return false;}
    }
    static synchronized JSONObject peek(){return Json.obj("token",token,"text",text);}
    static synchronized boolean consume(String expected){if(!token.equals(expected))return false;text="";token="";return true;}
}
