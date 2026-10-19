package com.zenix.musicplayer;
import android.content.Intent;
import org.json.*;
public class PlaylistShareCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args)throws Exception{
        check(!PlaylistShareInbox.receive(new Intent("android.intent.action.VIEW","text/plain","ignored")),"wrong action rejected");
        check(!PlaylistShareInbox.receive(new Intent(Intent.ACTION_SEND,"application/javascript","ignored")),"wrong type rejected");
        check(!PlaylistShareInbox.receive(new Intent(Intent.ACTION_SEND,"text/plain","x".repeat(500001))),"oversized share rejected");
        check(PlaylistShareInbox.receive(new Intent(Intent.ACTION_SEND,"text/plain","像风一样 - 薛之谦")),"cold share accepted");
        JSONObject first=PlaylistShareInbox.peek();check(first.optString("text").equals("像风一样 - 薛之谦"),"text preserved without execution");
        check(PlaylistShareInbox.receive(new Intent(Intent.ACTION_SEND,"text/plain","NewJeans《Ditto》")),"warm share accepted");
        check(!PlaylistShareInbox.consume(first.getString("token")),"stale consumer cannot erase new share");
        JSONObject next=PlaylistShareInbox.peek();check(next.getString("text").equals("NewJeans《Ditto》"),"new share retained");
        check(PlaylistShareInbox.consume(next.getString("token"))&&PlaylistShareInbox.peek().getString("text").isEmpty(),"explicit consume clears only pending share");
        System.out.println("PLAYLIST_SHARE_PASS");
    }
}
