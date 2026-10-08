package com.zenix.musicplayer;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** Narrow opt-in LAN endpoint; independent of public music-source networking. */
final class PlaylistLan {
    private final java.util.function.Consumer<JSONObject> incoming;
    private ServerSocket server;private String code="";private long expiresAt;private JSONArray addresses=new JSONArray();
    private final ScheduledExecutorService acceptor=Executors.newSingleThreadScheduledExecutor();
    private final ExecutorService clients=Executors.newSingleThreadExecutor();private int attempts;
    PlaylistLan(java.util.function.Consumer<JSONObject> incoming){this.incoming=incoming;}
    static boolean privateAddress(String address){String[] parts=address.split("\\.");if(parts.length!=4)return false;int[] ip=new int[4];try{for(int i=0;i<4;i++){if(!parts[i].matches("[0-9]{1,3}"))return false;ip[i]=Integer.parseInt(parts[i]);if(ip[i]>255)return false;}}catch(Exception e){return false;}return ip[0]==10||ip[0]==172&&ip[1]>=16&&ip[1]<=31||ip[0]==192&&ip[1]==168||ip[0]==127;}
    static byte[] key(String code)throws Exception {if(!code.matches("[a-fA-F0-9]{16}"))throw new Exception("请输入接收端的 16 位配对码");return MessageDigest.getInstance("SHA-256").digest(code.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));}
    static String seal(String text,String code)throws Exception {byte[] nonce=new byte[12];new SecureRandom().nextBytes(nonce);Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,new SecretKeySpec(key(code),"AES"),new GCMParameterSpec(128,nonce));return Json.obj("nonce",Base64.getEncoder().encodeToString(nonce),"data",Base64.getEncoder().encodeToString(cipher.doFinal(text.getBytes(StandardCharsets.UTF_8)))).toString();}
    static String unseal(String text,String code)throws Exception {JSONObject envelope=new JSONObject(text);byte[] nonce=Base64.getDecoder().decode(envelope.getString("nonce")),data=Base64.getDecoder().decode(envelope.getString("data"));if(nonce.length!=12||data.length<16||data.length>PlaylistExchange.MAX_BYTES+16)throw new Exception("请求无效");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key(code),"AES"),new GCMParameterSpec(128,nonce));return new String(cipher.doFinal(data),StandardCharsets.UTF_8);}
    synchronized JSONObject status(){return Json.obj("listening",server!=null&&!server.isClosed(),"addresses",addresses,"code",code,"expiresAt",expiresAt);}
    synchronized void stop(){try{if(server!=null)server.close();}catch(Exception ignored){}server=null;code="";expiresAt=0;addresses=new JSONArray();}
    void close(){stop();acceptor.shutdownNow();clients.shutdownNow();}
    synchronized JSONObject start()throws Exception {
        stop();ServerSocket selected=new ServerSocket();selected.setReuseAddress(true);selected.bind(new InetSocketAddress("0.0.0.0",0),2);selected.setSoTimeout(1000);server=selected;byte[] bytes=new byte[8];new SecureRandom().nextBytes(bytes);StringBuilder pair=new StringBuilder();for(byte b:bytes)pair.append(String.format("%02x",b));code=pair.toString();String sessionCode=code;attempts=0;expiresAt=System.currentTimeMillis()+15*60000;
        for(NetworkInterface network:Collections.list(NetworkInterface.getNetworkInterfaces()))if(network.isUp()&&!network.isLoopback())for(InetAddress address:Collections.list(network.getInetAddresses()))if(address instanceof Inet4Address&&privateAddress(address.getHostAddress()))addresses.put(address.getHostAddress()+":"+selected.getLocalPort());
        acceptor.execute(()->{while(!selected.isClosed()){if(System.currentTimeMillis()>expiresAt){synchronized(this){if(server==selected)stop();}break;}try{Socket socket=selected.accept();if(!privateAddress(socket.getInetAddress().getHostAddress())){socket.close();continue;}synchronized(this){if(++attempts>20){socket.close();if(server==selected)stop();break;}}socket.setSoTimeout(5000);clients.execute(()->receive(socket,selected,sessionCode));}catch(SocketTimeoutException ignored){}catch(Exception error){break;}}});return status();
    }
    private static String line(InputStream input)throws Exception {ByteArrayOutputStream bytes=new ByteArrayOutputStream();int b;while((b=input.read())!=-1){if(b=='\n')return bytes.toString(StandardCharsets.US_ASCII).replace("\r","");bytes.write(b);if(bytes.size()>1024)throw new IOException("头部太大");}throw new EOFException();}
    private void receive(Socket socket,ServerSocket selected,String pair){try(socket){try{InputStream input=socket.getInputStream();String request=line(input);if(!request.equals("POST /zenix/playlist HTTP/1.1"))throw new IOException("请求不允许");int length=-1,total=0;String header;while(!(header=line(input)).isEmpty()){total+=header.length();if(total>8192)throw new IOException("头部太大");if(header.toLowerCase(Locale.ROOT).startsWith("content-length:")){if(length!=-1)throw new IOException("长度重复");length=Integer.parseInt(header.substring(15).trim());}if(header.toLowerCase(Locale.ROOT).startsWith("transfer-encoding:"))throw new IOException("传输方式不允许");}if(length<1||length>3*1024*1024)throw new IOException("歌单过大");byte[] body=new byte[length];int offset=0;while(offset<length){int count=input.read(body,offset,length-offset);if(count<0)throw new EOFException();offset+=count;}JSONObject bundle=PlaylistExchange.decode(unseal(new String(body,StandardCharsets.UTF_8),pair));synchronized(this){if(server!=selected||System.currentTimeMillis()>expiresAt)throw new IOException("接收已结束");}incoming.accept(bundle);reply(socket,200,"已送达，请在接收端确认导入");synchronized(this){if(server==selected)stop();}}catch(Exception error){reply(socket,400,"配对码不匹配或歌单无效");}}catch(Exception ignored){}}
    private static void reply(Socket socket,int status,String message)throws Exception {byte[] body=Json.obj("message",message).toString().getBytes(StandardCharsets.UTF_8);OutputStream output=socket.getOutputStream();output.write(("HTTP/1.1 "+status+" Result\r\nContent-Type: application/json\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));output.write(body);output.flush();}
    boolean send(String address,String code,JSONObject bundle)throws Exception {
        String[] parts=address.trim().split(":");if(parts.length!=2||!privateAddress(parts[0]))throw new Exception("请输入接收端显示的局域网 IP:端口");int port;try{port=Integer.parseInt(parts[1]);}catch(Exception error){throw new Exception("端口无效");}if(port<1||port>65535)throw new Exception("端口无效");
        byte[] body=seal(bundle.toString(),code.replaceAll("[\\s-]","")).getBytes(StandardCharsets.UTF_8);
        try(Socket socket=new Socket()){socket.connect(new InetSocketAddress(parts[0],port),5000);socket.setSoTimeout(10000);OutputStream output=socket.getOutputStream();output.write(("POST /zenix/playlist HTTP/1.1\r\nHost: "+address+"\r\nContent-Type: application/json\r\nContent-Length: "+body.length+"\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.US_ASCII));output.write(body);output.flush();String response=line(socket.getInputStream());if(!response.startsWith("HTTP/1.1 200 "))throw new Exception("发送未成功，请核对配对码并重新开启接收");return true;}
    }
}
