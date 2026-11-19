package com.zenix.musicplayer;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.function.Consumer;
import okhttp3.*;
import okio.ByteString;

/** A bounded, cancellable speech-only connection. No model key, source policy or updater dependency. */
final class AssistantOnlineVoice {
    interface Factory { WebSocket open(Request request,WebSocketListener listener); }
    private final OkHttpClient client;
    private final Factory factory;
    private final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
    private final int timeoutMs;
    private Job active;
    private boolean closed;
    private static final class Job {
        WebSocket socket; ScheduledFuture<?> timer; boolean done;
        final ByteArrayOutputStream bytes=new ByteArrayOutputStream();
        final Consumer<byte[]> success; final Runnable failure;
        Job(Consumer<byte[]> success,Runnable failure){this.success=success;this.failure=failure;}
    }
    AssistantOnlineVoice(){client=new OkHttpClient.Builder().connectTimeout(15,TimeUnit.SECONDS).readTimeout(25,TimeUnit.SECONDS).build();factory=client::newWebSocket;timeoutMs=25000;}
    AssistantOnlineVoice(Factory factory,int timeoutMs){this.client=null;this.factory=factory;this.timeoutMs=timeoutMs;}
    synchronized void synthesize(String text,Consumer<byte[]> success,Runnable failure){
        cancel();
        if(closed||text==null||text.trim().isEmpty()||text.length()>300){failure.run();return;}
        Job job=new Job(success,failure);active=job;
        job.timer=deadlines.schedule(()->finish(job,false),timeoutMs,TimeUnit.MILLISECONDS);
        try{
            String id=UUID.randomUUID().toString().replace("-","");
            Request request=new Request.Builder().url("wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key="+EdgeVoiceToken.CLIENT+"&Sec-MS-GEC="+EdgeVoiceToken.generate(System.currentTimeMillis())+"&Sec-MS-GEC-Version=2-143.0.3650.75")
                .header("Origin","chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold")
                .header("User-Agent","Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0")
                .build();
            job.socket=factory.open(request,new WebSocketListener(){
                @Override public void onOpen(WebSocket socket,Response response){
                    synchronized(AssistantOnlineVoice.this){if(job.done){socket.cancel();return;}}
                    boolean configured=socket.send("Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}");
                    boolean sent=socket.send("X-RequestId:"+id+"\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n<speak version=\"1.0\" xmlns=\"http://www.w3.org/2001/10/synthesis\" xml:lang=\"zh-CN\"><voice name=\"zh-CN-XiaoyiNeural\"><prosody rate=\"+0%\" pitch=\"+0Hz\">"+xml(text)+"</prosody></voice></speak>");
                    if(!configured||!sent)finish(job,false);
                }
                @Override public void onMessage(WebSocket socket,String message){if(header(message,"Path").equals("turn.end"))finish(job,true);}
                @Override public void onMessage(WebSocket socket,ByteString message){
                    synchronized(AssistantOnlineVoice.this){
                        if(job.done)return;
                        byte[] frame=message.toByteArray();
                        if(frame.length<2){finish(job,false);return;}
                        int headerSize=((frame[0]&255)<<8)|(frame[1]&255),offset=headerSize+2;
                        if(offset>frame.length){finish(job,false);return;}
                        String headers=new String(frame,2,headerSize,StandardCharsets.UTF_8);
                        if(!header(headers,"Path").equals("audio")){finish(job,false);return;}
                        int size=frame.length-offset;
                        if(size==0)return;
                        if(!header(headers,"Content-Type").equals("audio/mpeg")||job.bytes.size()+size>2*1024*1024){finish(job,false);return;}
                        job.bytes.write(frame,offset,size);
                    }
                }
                @Override public void onFailure(WebSocket socket,Throwable error,Response response){finish(job,false);}
                @Override public void onClosing(WebSocket socket,int code,String reason){finish(job,false);}
                @Override public void onClosed(WebSocket socket,int code,String reason){finish(job,false);}
            });
            if(job.done)job.socket.cancel();
        }catch(Exception error){finish(job,false);}
    }
    private synchronized void finish(Job job,boolean success){
        if(job.done)return;job.done=true;
        if(job.timer!=null)job.timer.cancel(false);
        if(active==job)active=null;
        if(job.socket!=null)job.socket.cancel();
        if(success&&job.bytes.size()>=100)job.success.accept(job.bytes.toByteArray());else job.failure.run();
    }
    synchronized void cancel(){Job job=active;if(job==null)return;job.done=true;active=null;if(job.timer!=null)job.timer.cancel(false);if(job.socket!=null)job.socket.cancel();}
    synchronized void close(){closed=true;cancel();deadlines.shutdownNow();if(client!=null){client.dispatcher().executorService().shutdownNow();client.connectionPool().evictAll();}}
    private static String header(String message,String key){for(String line:message.split("\r\n")){if(line.isEmpty())break;int at=line.indexOf(':');if(at>0&&line.substring(0,at).equalsIgnoreCase(key))return line.substring(at+1).trim();}return "";}
    private static String xml(String text){return text.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&apos;").replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]"," ");}
}
