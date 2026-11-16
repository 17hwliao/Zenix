// Only Android platform calls are replaced; the lifecycle under test is production AssistantSpeech.
module.exports = {
 'android/content/Context.java': 'package android.content; public class Context {}',
 'android/content/Intent.java': 'package android.content; public class Intent { public Intent(String name){} public void putExtra(String key,Object value){} }',
 'android/os/Bundle.java': 'package android.os; public class Bundle {public java.util.ArrayList<String> getStringArrayList(String key){return null;}public float[] getFloatArray(String key){return null;}}',
 'android/os/Looper.java': 'package android.os; public class Looper {public static Looper getMainLooper(){return new Looper();}}',
 'android/os/Handler.java': 'package android.os; public class Handler {public Handler(Looper loop){}public void post(Runnable run){run.run();}}',
 'android/os/SystemClock.java': 'package android.os; public class SystemClock {public static long elapsedRealtime(){return 100000;}}',
 'org/json/JSONObject.java': 'package org.json; public class JSONObject extends java.util.HashMap<String,Object>{}',
 'com/zenix/musicplayer/Json.java': 'package com.zenix.musicplayer; final class Json {static org.json.JSONObject obj(Object... values){org.json.JSONObject object=new org.json.JSONObject();for(int i=0;i<values.length;i+=2)object.put((String)values[i],values[i+1]);return object;}}',
 'android/speech/RecognitionListener.java': `package android.speech; import android.os.Bundle; public interface RecognitionListener {
 void onReadyForSpeech(Bundle b);void onBeginningOfSpeech();void onRmsChanged(float f);void onBufferReceived(byte[] b);void onEndOfSpeech();void onEvent(int e,Bundle b);void onPartialResults(Bundle b);void onResults(Bundle b);void onError(int code);}`,
 'android/speech/SpeechRecognizer.java': `package android.speech; public class SpeechRecognizer {
 public static final String RESULTS_RECOGNITION="results",CONFIDENCE_SCORES="scores";
 public static final int ERROR_INSUFFICIENT_PERMISSIONS=1,ERROR_NO_MATCH=2,ERROR_SPEECH_TIMEOUT=3,ERROR_NETWORK=4,ERROR_NETWORK_TIMEOUT=5;
 public static boolean isRecognitionAvailable(android.content.Context c){return true;}public static SpeechRecognizer createSpeechRecognizer(android.content.Context c){return new SpeechRecognizer();}
 public void setRecognitionListener(RecognitionListener l){}public void startListening(android.content.Intent i){}public void cancel(){}public void destroy(){}public void stopListening(){} }`,
 'android/speech/RecognizerIntent.java': `package android.speech; public class RecognizerIntent {public static final String ACTION_RECOGNIZE_SPEECH="recognize",EXTRA_LANGUAGE_MODEL="model",LANGUAGE_MODEL_FREE_FORM="free",EXTRA_LANGUAGE="language",EXTRA_PARTIAL_RESULTS="partial",EXTRA_MAX_RESULTS="max";}`,
 'android/speech/tts/UtteranceProgressListener.java': 'package android.speech.tts; public abstract class UtteranceProgressListener {public abstract void onStart(String id);public abstract void onDone(String id);public abstract void onError(String id);}',
 'android/speech/tts/TextToSpeech.java': `package android.speech.tts; public class TextToSpeech {
 public interface OnInitListener{void onInit(int status);}public static final int SUCCESS=0,ERROR=-1,QUEUE_FLUSH=0,LANG_MISSING_DATA=-1,LANG_NOT_SUPPORTED=-2;
 public static final java.util.List<TextToSpeech> instances=new java.util.ArrayList<>();public static int languageStatus=0;public static boolean throwSpeak=false;
 public final OnInitListener init;public UtteranceProgressListener progress;public String lastText,lastId;public boolean shutdown;
 public TextToSpeech(android.content.Context c,OnInitListener callback){init=callback;instances.add(this);}public int setLanguage(java.util.Locale language){return languageStatus;}
 public void setOnUtteranceProgressListener(UtteranceProgressListener listener){progress=listener;}
 public int speak(String text,int queue,Object params,String id){if(throwSpeak)throw new IllegalStateException("TTS failed");lastText=text;lastId=id;return SUCCESS;}
 public void stop(){}public void shutdown(){shutdown=true;}}`,
 'android/media/AudioAttributes.java': 'package android.media; public class AudioAttributes {public static final int USAGE_ASSISTANCE_ACCESSIBILITY=1,CONTENT_TYPE_SPEECH=2;public static class Builder{public Builder setUsage(int v){return this;}public Builder setContentType(int v){return this;}public AudioAttributes build(){return new AudioAttributes();}}}',
 'android/media/MediaDataSource.java': 'package android.media; public abstract class MediaDataSource {public abstract int readAt(long p,byte[] b,int o,int s);public abstract long getSize();public abstract void close();}',
 'android/media/MediaPlayer.java': `package android.media; public class MediaPlayer {
 public interface OnPreparedListener{void onPrepared(MediaPlayer p);}public interface OnCompletionListener{void onCompletion(MediaPlayer p);}public interface OnErrorListener{boolean onError(MediaPlayer p,int w,int e);}
 public static final java.util.List<MediaPlayer> instances=new java.util.ArrayList<>();public boolean released,started;public OnPreparedListener prepared;public OnCompletionListener completed;public OnErrorListener error;
 public MediaPlayer(){instances.add(this);}public void setAudioAttributes(AudioAttributes a){}public void setDataSource(MediaDataSource data){}
 public void setOnPreparedListener(OnPreparedListener l){prepared=l;}public void setOnCompletionListener(OnCompletionListener l){completed=l;}public void setOnErrorListener(OnErrorListener l){error=l;}
 public void prepareAsync(){}public void start(){started=true;}public void release(){released=true;}}`,
 'com/zenix/musicplayer/AssistantOnlineVoice.java': `package com.zenix.musicplayer; final class AssistantOnlineVoice {
 static boolean fail=true;static int calls;static java.util.function.Consumer<byte[]> lastSuccess;static Runnable lastFailure;
 void synthesize(String text,java.util.function.Consumer<byte[]> success,Runnable failure){calls++;lastSuccess=success;lastFailure=failure;if(fail)failure.run();}
 void cancel(){}void close(){}}`,
};
