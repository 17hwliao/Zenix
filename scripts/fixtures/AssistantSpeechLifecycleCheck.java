package com.zenix.musicplayer;

import java.util.*;
import org.json.JSONObject;
import android.speech.tts.TextToSpeech;
import android.media.MediaPlayer;

public class AssistantSpeechLifecycleCheck {
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    public static void main(String[] args){
        AssistantSpeech service=new AssistantSpeech(new android.content.Context());
        List<JSONObject> first=new ArrayList<>(),second=new ArrayList<>();
        service.speak("旧消息",first::add);
        TextToSpeech engine=TextToSpeech.instances.get(0);
        service.stopSpeaking();
        service.speak("新消息",second::add);
        check(first.size()==1&&Boolean.FALSE.equals(first.get(0).get("spoken")),"cancel settles prior callback");
        check(second.isEmpty(),"new system fallback must wait for an initializing engine, not fail prematurely");
        engine.init.onInit(TextToSpeech.SUCCESS);
        check("新消息".equals(engine.lastText),"initialization must speak the live target, never the cancelled text");
        engine.progress.onDone(engine.lastId);
        check(second.size()==1&&Boolean.TRUE.equals(second.get(0).get("spoken")),"live system playback completes once");
        check("system".equals(second.get(0).get("voice")),"actual fallback identity");
        List<JSONObject> thrown=new ArrayList<>();TextToSpeech.throwSpeak=true;
        service.speak("引擎异常",thrown::add);
        check(thrown.size()==1&&Boolean.FALSE.equals(thrown.get(0).get("spoken")),"engine exceptions settle failure");
        TextToSpeech.throwSpeak=false;service.close();

        AssistantSpeech missing=new AssistantSpeech(new android.content.Context());List<JSONObject> absent=new ArrayList<>();
        TextToSpeech.languageStatus=TextToSpeech.LANG_MISSING_DATA;
        missing.speak("中文数据缺失",absent::add);TextToSpeech.instances.get(1).init.onInit(TextToSpeech.SUCCESS);
        check(absent.size()==1&&Boolean.FALSE.equals(absent.get(0).get("spoken")),"missing Chinese data is not successful speech");missing.close();TextToSpeech.languageStatus=0;

        AssistantOnlineVoice.fail=false;AssistantSpeech online=new AssistantSpeech(new android.content.Context());List<JSONObject> response=new ArrayList<>();
        online.speak("在线消息",response::add);java.util.function.Consumer<byte[]> late=AssistantOnlineVoice.lastSuccess;
        late.accept(new byte[200]);MediaPlayer player=MediaPlayer.instances.get(0);
        MediaPlayer.OnPreparedListener oldPrepared=player.prepared;MediaPlayer.OnCompletionListener oldComplete=player.completed;
        online.stopSpeaking();oldPrepared.onPrepared(player);oldComplete.onCompletion(player);
        check(player.released&&!player.started,"cancelled player is released and late prepare cannot start");
        check(response.size()==1&&Boolean.FALSE.equals(response.get(0).get("spoken")),"late completion cannot turn cancel into success");
        late.accept(new byte[200]);check(MediaPlayer.instances.size()==1,"cancelled network completion cannot allocate another player");online.close();

        AssistantOnlineVoice.fail=false;AssistantSpeech playerFailure=new AssistantSpeech(new android.content.Context());List<JSONObject> fallbackFirst=new ArrayList<>(),fallbackSecond=new ArrayList<>();
        playerFailure.speak("在线播放器失败",fallbackFirst::add);java.util.function.Consumer<byte[]> failedAudio=AssistantOnlineVoice.lastSuccess;
        int calls=AssistantOnlineVoice.calls;failedAudio.accept(new byte[200]);MediaPlayer failedPlayer=MediaPlayer.instances.get(1);MediaPlayer.OnErrorListener failedListener=failedPlayer.error;
        failedListener.onError(failedPlayer,1,1);check(fallbackFirst.isEmpty()&&playerFailure!=null,"player failure waits for the system fallback rather than claiming success");
        TextToSpeech fallbackEngine=TextToSpeech.instances.get(TextToSpeech.instances.size()-1);fallbackEngine.init.onInit(TextToSpeech.SUCCESS);fallbackEngine.progress.onDone(fallbackEngine.lastId);
        check(fallbackFirst.size()==1&&Boolean.TRUE.equals(fallbackFirst.get(0).get("spoken"))&&"system".equals(fallbackFirst.get(0).get("voice")),"decoder failure speaks through the system voice");
        playerFailure.speak("退避中的第二段",fallbackSecond::add);check(AssistantOnlineVoice.calls==calls,"player failure does not retry the online service for the next segment");
        fallbackEngine.progress.onDone(fallbackEngine.lastId);check(fallbackSecond.size()==1&&Boolean.TRUE.equals(fallbackSecond.get(0).get("spoken")),"fallback backoff preserves the next reply");playerFailure.close();
        System.out.println("ASSISTANT_SPEECH_LIFECYCLE_PASS");
    }
}
