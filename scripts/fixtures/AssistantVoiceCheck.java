package com.zenix.musicplayer;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.*;
import okio.ByteString;

public final class AssistantVoiceCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static final class Socket implements WebSocket {
        final List<String> sent=new ArrayList<>();boolean cancelled;
        final Request request;Socket(Request request){this.request=request;}
        public Request request(){return request;}public long queueSize(){return 0;}
        public boolean send(String text){sent.add(text);return true;}public boolean send(ByteString text){return false;}
        public boolean close(int code,String reason){cancelled=true;return true;}public void cancel(){cancelled=true;}
    }
    static ByteString frame(String type,byte[] data){byte[] headers=("Path:audio\r\nContent-Type:"+type+"\r\n").getBytes(StandardCharsets.US_ASCII);return ByteString.of(ByteBuffer.allocate(2+headers.length+data.length).putShort((short)headers.length).put(headers).put(data).array());}
    public static void main(String[] args)throws Exception{
        if(args.length>0){for(String value:args)System.out.println(EdgeVoiceToken.generate(Long.parseLong(value)));return;}
        List<Socket> sockets=new ArrayList<>();List<WebSocketListener> listeners=new ArrayList<>();
        AssistantOnlineVoice service=new AssistantOnlineVoice((request,listener)->{Socket socket=new Socket(request);sockets.add(socket);listeners.add(listener);return socket;},1000);
        AtomicInteger success=new AtomicInteger(),failure=new AtomicInteger();
        try{
            service.synthesize("你好 <星音> & 音乐",bytes->{check(bytes.length==200,"audio size");success.incrementAndGet();},failure::incrementAndGet);
            Socket socket=sockets.get(0);WebSocketListener listener=listeners.get(0);
            check(socket.request.url().host().equals("api.msedgeservices.com"),"fixed native endpoint");
            check(socket.request.url().isHttps(),"normal TLS");
            listener.onOpen(socket,null);
            check(socket.sent.get(1).contains("zh-CN-XiaoyiNeural"),"same chosen voice");
            check(socket.sent.get(1).contains("&lt;星音&gt; &amp;"),"escape data as SSML text");
            listener.onMessage(socket,frame("audio/mpeg",new byte[200]));listener.onMessage(socket,"Path:turn.end\r\n\r\n");
            listener.onClosed(socket,1000,"done");
            check(success.get()==1&&failure.get()==0&&socket.cancelled,"one verified completion closes socket");
            service.synthesize("取消测试",bytes->success.incrementAndGet(),failure::incrementAndGet);Socket cancelled=sockets.get(1);service.cancel();
            listeners.get(1).onMessage(cancelled,frame("audio/mpeg",new byte[200]));listeners.get(1).onMessage(cancelled,"Path:turn.end\r\n\r\n");
            check(success.get()==1&&failure.get()==0&&cancelled.cancelled,"no late audio or fallback after cancellation");
            service.synthesize("坏数据",bytes->success.incrementAndGet(),failure::incrementAndGet);listeners.get(2).onMessage(sockets.get(2),frame("text/html",new byte[200]));
            check(failure.get()==1,"bad frames fail rather than become audio");
            service.synthesize("缺音频",bytes->success.incrementAndGet(),failure::incrementAndGet);listeners.get(3).onMessage(sockets.get(3),"Path:turn.end\r\n\r\n");
            check(failure.get()==2,"empty audio is not success");
            service.synthesize("超大",bytes->success.incrementAndGet(),failure::incrementAndGet);listeners.get(4).onMessage(sockets.get(4),frame("audio/mpeg",new byte[2*1024*1024+1]));
            check(failure.get()==3,"audio memory limit");
        }finally{service.close();}
        AtomicInteger deadline=new AtomicInteger();AssistantOnlineVoice timeout=new AssistantOnlineVoice((request,listener)->new Socket(request),20);
        try{timeout.synthesize("等待",bytes->{throw new AssertionError();},deadline::incrementAndGet);Thread.sleep(100);check(deadline.get()==1,"voice-only deadline resolves failure once");}finally{timeout.close();}
        System.out.println("ASSISTANT_VOICE_NATIVE_PASS");
    }
}
