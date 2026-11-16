package com.zenix.musicplayer;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.speech.*;
import android.speech.tts.*;
import org.json.JSONObject;
import java.util.Locale;
import java.util.function.Consumer;

/** Main-thread, user-held sessions. Never resumes recognition after release or cancellation. */
final class AssistantSpeech {
    private final Context context;private Session session;private TextToSpeech tts;private boolean ready;private Consumer<JSONObject> spoken;private String speechId;
    private final AssistantOnlineVoice onlineVoice=new AssistantOnlineVoice();
    private final android.os.Handler main=new android.os.Handler(android.os.Looper.getMainLooper());
    private android.media.MediaPlayer audio;private long voiceGeneration;private boolean systemFallback;private long onlineRetryAfter;private String pendingSystemText;
    private static final class Session {String token;SpeechRecognizer recognizer;boolean released;JSONObject value;Consumer<JSONObject> done;Consumer<String> fail;}
    AssistantSpeech(Context context){this.context=context;}
    void begin(String token,Consumer<JSONObject> done,Consumer<String> fail,Consumer<String> readyForSpeech){
        if(!token.matches("[a-fA-F0-9-]{36}")){fail.accept("语音会话无效");return;}
        if(session!=null){fail.accept("正在识别上一句话，请先取消或等待结果");return;}
        stopSpeaking();if(!SpeechRecognizer.isRecognitionAvailable(context)){fail.accept("系统没有可用的语音识别服务，请使用文字指令");return;}
        Session current=new Session();current.token=token;current.done=done;current.fail=fail;session=current;
        try{current.recognizer=SpeechRecognizer.createSpeechRecognizer(context);current.recognizer.setRecognitionListener(new RecognitionListener(){
            public void onReadyForSpeech(Bundle params){if(session==current)readyForSpeech.accept("listening");} public void onBeginningOfSpeech(){} public void onRmsChanged(float rms){} public void onBufferReceived(byte[] bytes){} public void onEndOfSpeech(){} public void onEvent(int event,Bundle params){} public void onPartialResults(Bundle partial){}
            public void onResults(Bundle results){if(session!=current)return;java.util.ArrayList<String> words=results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);float[] scores=results.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES);current.value=Json.obj("transcript",words==null||words.isEmpty()?"":words.get(0),"confidence",scores!=null&&scores.length>0&&scores[0]>=0?scores[0]:-1);if(current.released)complete(current,null);else readyForSpeech.accept("captured");}
            public void onError(int code){if(session!=current)return;String message=code==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS?"未取得麦克风许可，请授权后重试":code==SpeechRecognizer.ERROR_NO_MATCH||code==SpeechRecognizer.ERROR_SPEECH_TIMEOUT?"没有听清，请按住后再说一次":code==SpeechRecognizer.ERROR_NETWORK||code==SpeechRecognizer.ERROR_NETWORK_TIMEOUT?"系统语音服务网络不可用，可改用文字指令":"系统语音识别未完成，请松开后重试（"+code+"）";complete(current,message);}
        });Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"zh-CN");intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,false);intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,3);current.recognizer.startListening(intent);}catch(Exception error){complete(current,"无法启动麦克风，请使用文字指令");}
    }
    void stop(String token){Session current=session;if(current==null||!current.token.equals(token))return;current.released=true;if(current.value!=null)complete(current,null);else try{current.recognizer.stopListening();}catch(Exception error){complete(current,"无法结束语音识别，请重试");}}
    void cancel(String token){Session current=session;if(current==null||(token!=null&&!current.token.equals(token)))return;complete(current,"已取消语音识别");}
    private void complete(Session current,String error){if(session!=current)return;session=null;try{current.recognizer.cancel();current.recognizer.destroy();}catch(Exception ignored){}if(error!=null)current.fail.accept(error);else current.done.accept(current.value==null?Json.obj("transcript",""):current.value);}
    void speak(String text,Consumer<JSONObject> done){
        stopSpeaking();final String content=text.length()>300?text.substring(0,300):text;if(content.isEmpty()){done.accept(Json.obj("spoken",false));return;}
        spoken=done;speechId=java.util.UUID.randomUUID().toString();
        systemFallback=false;final long expected=voiceGeneration;
        if(android.os.SystemClock.elapsedRealtime()<onlineRetryAfter){systemSpeak(content);return;}
        onlineVoice.synthesize(content,bytes->main.post(()->{if(expected!=voiceGeneration)return;onlineRetryAfter=0;playOnline(bytes,content,expected);}),()->main.post(()->{if(expected==voiceGeneration)fallbackOnline(content);}));
    }
    private void playOnline(byte[] bytes,String content,long expected){
        try{
            final android.media.MediaPlayer player=new android.media.MediaPlayer();audio=player;
            player.setAudioAttributes(new android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY).setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setDataSource(new android.media.MediaDataSource(){public int readAt(long position,byte[] buffer,int offset,int size){if(size==0)return 0;if(position<0||position>=bytes.length)return -1;int count=Math.min(size,bytes.length-(int)position);System.arraycopy(bytes,(int)position,buffer,offset,count);return count;}public long getSize(){return bytes.length;}public void close(){}});
            player.setOnPreparedListener(value->{if(expected==voiceGeneration&&audio==value){try{value.start();}catch(Exception error){releaseAudio();fallbackOnline(content);}}});
            player.setOnCompletionListener(value->{if(expected==voiceGeneration&&audio==value){releaseAudio();finishSpeech(true);}});
            player.setOnErrorListener((value,what,extra)->{if(expected==voiceGeneration&&audio==value){releaseAudio();fallbackOnline(content);}return true;});
            player.prepareAsync();
        }catch(Exception error){releaseAudio();if(expected==voiceGeneration)fallbackOnline(content);}
    }
    private void fallbackOnline(String content){onlineRetryAfter=android.os.SystemClock.elapsedRealtime()+30000;systemSpeak(content);}
    private void systemSpeak(String content){
        systemFallback=true;
        pendingSystemText=content;
        if(tts!=null){if(ready)sayPending();return;}
        try{
            tts=new TextToSpeech(context,status->main.post(()->{
                if(tts==null)return;
                try{
                    ready=status==TextToSpeech.SUCCESS;
                    if(ready){int language=tts.setLanguage(Locale.SIMPLIFIED_CHINESE);ready=language!=TextToSpeech.LANG_MISSING_DATA&&language!=TextToSpeech.LANG_NOT_SUPPORTED;}
                    if(!ready)throw new IllegalStateException("中文语音引擎不可用");
                    listenSpeech();sayPending();
                }catch(Exception error){ready=false;TextToSpeech failed=tts;tts=null;try{failed.shutdown();}catch(Exception ignored){}if(pendingSystemText!=null)finishSpeech(false);}
            }));
        }catch(Exception error){ready=false;tts=null;finishSpeech(false);}
    }
    private void sayPending(){String content=pendingSystemText;if(content==null||speechId==null||spoken==null)return;pendingSystemText=null;try{say(content);}catch(Exception error){finishSpeech(false);}}
    private void listenSpeech(){tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){public void onStart(String id){}public void onDone(String id){new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{if(id.equals(speechId))finishSpeech(true);});}public void onError(String id){new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{if(id.equals(speechId))finishSpeech(false);});}});}
    private void say(String text){if(tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,speechId)==TextToSpeech.ERROR)finishSpeech(false);}
    private void finishSpeech(boolean success){Consumer<JSONObject> callback=spoken;spoken=null;speechId=null;pendingSystemText=null;if(callback!=null)callback.accept(Json.obj("spoken",success,"voice",systemFallback?"system":"zh-CN-XiaoyiNeural"));}
    private void releaseAudio(){if(audio!=null){android.media.MediaPlayer previous=audio;audio=null;previous.setOnPreparedListener(null);previous.setOnCompletionListener(null);previous.setOnErrorListener(null);previous.release();}}
    void stopSpeaking(){voiceGeneration++;onlineVoice.cancel();releaseAudio();if(tts!=null)tts.stop();finishSpeech(false);}
    void close(){cancel(null);stopSpeaking();onlineVoice.close();if(tts!=null){tts.shutdown();tts=null;ready=false;}}
}
