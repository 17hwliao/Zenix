package com.zenix.musicplayer;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.json.*;
// Storage is not exercised on the JVM; only production exchange/network code is.
class PrivateStore {JSONObject object(String key){return new JSONObject();}}
class MusicSources {static String sha(String text)throws Exception{StringBuilder value=new StringBuilder();for(byte b:java.security.MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)))value.append(String.format("%02x",b&255));return value.toString();}}
public class PlaylistContractCheck {
    public static void main(String[] args)throws Exception{
        String wire=Files.readString(Path.of(args[0])),code=args[1],nodeAddress=args[2];JSONObject bundle=PlaylistExchange.decode(PlaylistLan.unseal(wire,code));
        if(!bundle.getJSONArray("playlists").getJSONObject(0).getString("name").equals("测试歌单"))throw new Exception("UTF-8 exchange failed");
        if(bundle.toString().contains("fixture-secret")||bundle.toString().contains("C:\\private"))throw new Exception("Unsafe fields leaked");
        PlaylistLan sender=new PlaylistLan(value->{});boolean rejected=false;try{sender.send(nodeAddress,"ffffffffffffffff",bundle);}catch(Exception expected){rejected=true;}if(!rejected)throw new Exception("Wrong code accepted");sender.send(nodeAddress,code,bundle);sender.close();
        CountDownLatch received=new CountDownLatch(1);PlaylistLan receiver=new PlaylistLan(value->{if(value.toString().equals(bundle.toString()))received.countDown();});JSONObject state=receiver.start();
        var field=PlaylistLan.class.getDeclaredField("server");field.setAccessible(true);int port=((java.net.ServerSocket)field.get(receiver)).getLocalPort();
        System.out.println("READY "+port+" "+state.getString("code"));System.out.flush();
        if(!received.await(10,TimeUnit.SECONDS))throw new Exception("Node to Java TCP exchange failed");receiver.close();System.out.println("PLAYLIST_CONTRACT_PASS");
    }
}
