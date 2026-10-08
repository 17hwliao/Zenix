package com.zenix.musicplayer;

import android.app.PendingIntent;
import android.appwidget.*;
import android.content.*;
import android.os.*;
import android.widget.RemoteViews;
import android.view.View;
import androidx.media3.session.*;
import org.json.*;

/** One responsive visual family with three launcher picker sizes. */
public class MusicWidget extends AppWidgetProvider {
    public static class Square extends MusicWidget {}
    public static class Wide extends MusicWidget {}
    public static class Bar extends MusicWidget {}
    static final Class<?>[] PROVIDERS={Square.class,Wide.class,Bar.class};
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){for(int id:ids)update(context,manager,id,getClass());}
    @Override public void onAppWidgetOptionsChanged(Context context,AppWidgetManager manager,int id,Bundle options){update(context,manager,id,getClass());}
    @Override public void onReceive(Context context,Intent intent){
        super.onReceive(context,intent);String action=intent.getAction();if(action==null||!action.startsWith("com.zenix.widget."))return;
        String command=action.substring("com.zenix.widget.".length());if(!java.util.Set.of("toggle","previous","next").contains(command))return;
        PendingResult pending=goAsync();ZenixRuntime runtime=ZenixRuntime.get(context);runtime.main.post(()->{
            if(runtime.service!=null){if(command.equals("toggle"))runtime.service.toggle();else runtime.service.advance(command.equals("next")?1:-1);pending.finish();return;}
            // MediaSession binding starts the service safely; no Activity/WebView is needed.
            var future=new MediaController.Builder(context,new SessionToken(context,new ComponentName(context,PlaybackService.class))).buildAsync();
            future.addListener(()->{try{MediaController controller=future.get();if(command.equals("toggle")){if(controller.getPlayWhenReady())controller.pause();else controller.play();}else if(command.equals("next"))controller.seekToNext();else controller.seekToPrevious();runtime.main.postDelayed(controller::release,15000);}catch(Exception ignored){}finally{pending.finish();}},task->runtime.main.post(task));
        });
    }
    static boolean requestPin(Context context,String size)throws Exception {Class<?> provider=size.equals("3x3")?Square.class:size.equals("4x2")?Wide.class:size.equals("4x1")?Bar.class:null;if(provider==null)throw new Exception("无效组件尺寸");AppWidgetManager manager=AppWidgetManager.getInstance(context);if(Build.VERSION.SDK_INT<26||!manager.isRequestPinAppWidgetSupported())return false;return manager.requestPinAppWidget(new ComponentName(context,provider),null,null);}
    static void updateAll(Context context){AppWidgetManager manager=AppWidgetManager.getInstance(context);for(Class<?> provider:PROVIDERS)for(int id:manager.getAppWidgetIds(new ComponentName(context,provider)))update(context,manager,id,provider);}
    private static void update(Context context,AppWidgetManager manager,int id,Class<?> provider){
        ZenixRuntime runtime=ZenixRuntime.get(context);JSONObject state=runtime.service==null?new JSONObject():runtime.service.state();JSONObject track=state.optJSONObject("track");
        int height=manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,provider==Square.class?220:provider==Wide.class?140:70);
        RemoteViews views=new RemoteViews(context.getPackageName(),height<100?R.layout.music_widget_bar:R.layout.music_widget);
        views.setTextViewText(R.id.widget_title,track==null?"你的音乐，自成宇宙。":track.optString("title"));views.setTextViewText(R.id.widget_artist,track==null?"打开 Zenix 开始播放":track.optString("artist"));views.setTextViewText(R.id.widget_toggle,state.optBoolean("playWhenReady",state.optBoolean("playing"))?"Ⅱ":"▶");
        if(height>=100){views.setViewVisibility(R.id.widget_art,height>=190?View.VISIBLE:View.GONE);views.setImageViewResource(R.id.widget_art,R.drawable.zenix_icon);if(track!=null){java.io.File file=artworkFile(context,track.optString("coverUrl"));if(file!=null){String cover=file.getAbsolutePath();android.graphics.BitmapFactory.Options options=new android.graphics.BitmapFactory.Options();options.inJustDecodeBounds=true;android.graphics.BitmapFactory.decodeFile(cover,options);if(options.outWidth>0&&options.outHeight>0){options.inSampleSize=Math.max(1,Math.max(options.outWidth,options.outHeight)/160);options.inJustDecodeBounds=false;android.graphics.Bitmap bitmap=android.graphics.BitmapFactory.decodeFile(cover,options);if(bitmap!=null)views.setImageViewBitmap(R.id.widget_art,bitmap);}}}}
        Intent open=new Intent(context,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);views.setOnClickPendingIntent(R.id.widget_root,PendingIntent.getActivity(context,id,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
        int[] buttons={R.id.widget_previous,R.id.widget_toggle,R.id.widget_next};String[] commands={"previous","toggle","next"};for(int i=0;i<buttons.length;i++){Intent command=new Intent(context,provider).setAction("com.zenix.widget."+commands[i]);views.setOnClickPendingIntent(buttons[i],PendingIntent.getBroadcast(context,id*4+i,command,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));}
        manager.updateAppWidget(id,views);
    }
    private static java.io.File artworkFile(Context context,String cover){
        try{java.io.File file=new java.io.File(cover).getCanonicalFile();String path=file.getPath();
            String files=context.getFilesDir().getCanonicalPath()+java.io.File.separator;
            String artwork=new java.io.File(context.getCacheDir(),"source-artwork").getCanonicalPath()+java.io.File.separator;
            return file.isFile()&&file.length()<=2*1024*1024&&(path.startsWith(files)||path.startsWith(artwork))?file:null;
        }catch(java.io.IOException ignored){return null;}
    }
}
