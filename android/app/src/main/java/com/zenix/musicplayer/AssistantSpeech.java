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
        if(tts==null){final String expected=speechId;tts=new TextToSpeech(context,status->{if(tts==null)return;ready=status==TextToSpeech.SUCCESS;if(!ready){if(expected.equals(speechId))finishSpeech(false);return;}tts.setLanguage(Locale.SIMPLIFIED_CHINESE);listenSpeech();if(expected.equals(speechId))say(content);});}else if(ready)say(content);else finishSpeech(false);
    }
    private void listenSpeech(){tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){public void onStart(String id){}public void onDone(String id){new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{if(id.equals(speechId))finishSpeech(true);});}public void onError(String id){new android.os.Handler(android.os.Looper.getMainLooper()).post(()->{if(id.equals(speechId))finishSpeech(false);});}});}
    private void say(String text){if(tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,speechId)==TextToSpeech.ERROR)finishSpeech(false);}
    private void finishSpeech(boolean success){Consumer<JSONObject> callback=spoken;spoken=null;speechId=null;if(callback!=null)callback.accept(Json.obj("spoken",success));}
    void stopSpeaking(){if(tts!=null)tts.stop();finishSpeech(false);}
    void close(){cancel(null);stopSpeaking();if(tts!=null){tts.shutdown();tts=null;ready=false;}}
}
