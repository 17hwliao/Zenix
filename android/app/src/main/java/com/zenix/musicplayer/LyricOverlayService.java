package com.zenix.musicplayer;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.graphics.*;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import androidx.core.app.NotificationCompat;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

/** Small native windows; locked lyrics never intercept another application's taps. */
public final class LyricOverlayService extends Service {
    private static final String CHANNEL = "zenix-floating-lyrics";
    private static final int NOTIFICATION = 2102;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService loader = Executors.newSingleThreadExecutor();
    private ZenixRuntime runtime;
    private WindowManager windows;
    private WindowManager.LayoutParams frame, lockFrame;
    private LinearLayout root, controls, rows, footer;
    private TextView previous, current, next, jump, playButton;
    private SeekBar progress;
    private Icon lock;
    private boolean locked, expanded, compact, updatingSeek, previewing, destroyed;
    private int previewIndex, shown = Integer.MIN_VALUE, fontSize = 20;
    private int lyricColor = Color.rgb(197,233,255);
    private String font = "sans-serif-medium";
    private float dragX, dragY, lyricDragY;
    private int startX, startY;
    private String trackId = "", message = "等待播放音乐";
    private List<LyricTimeline.Line> timeline = Collections.emptyList();
    private JSONObject lastTrack;
    private long generation;
    private boolean screenActive = true;

    static boolean allowed(Context context) { return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context); }
    static void start(Context context) {
        Intent intent = new Intent(context, LyricOverlayService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent); else context.startService(intent);
    }
    @Override public void onCreate() {
        super.onCreate(); runtime = ZenixRuntime.get(this); windows = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (!allowed(this)) { stopSelf(); return; }
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "悬浮歌词", NotificationManager.IMPORTANCE_LOW);
            channel.setSound(null, null); ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        }
        Intent launch = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent home = PendingIntent.getActivity(this, 22, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent close = PendingIntent.getService(this, 23, new Intent(this, LyricOverlayService.class).setAction("close"), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(com.zenix.musicplayer.R.drawable.zenix_icon)
                .setContentTitle("Zenix 悬浮歌词").setContentText("点击返回音乐空间；可随时关闭悬浮歌词")
                .setContentIntent(home).setOngoing(true).setSilent(true).addAction(0,"关闭歌词",close).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); else startForeground(NOTIFICATION, notification);
        runtime.overlay = this; configure(runtime.store.object("overlay"));
        try { build(); } catch (SecurityException | WindowManager.BadTokenException failure) { stopSelf(); return; }
        IntentFilter events = new IntentFilter(); events.addAction(Intent.ACTION_SCREEN_OFF); events.addAction(Intent.ACTION_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(screenReceiver, events, Context.RECEIVER_NOT_EXPORTED); else registerReceiver(screenReceiver, events);
        main.post(tick); runtime.emit();
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent != null && "close".equals(intent.getAction())) stopSelf();
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }

    JSONObject status() { return Json.obj("enabled", !destroyed && root != null, "permitted", allowed(this), "locked", locked, "compact", compact, "fontSize", fontSize, "font",font,"color", String.format("#%06x", lyricColor & 0xffffff)); }
    void configure(JSONObject values) {
        if (values == null) return;
        locked = values.optBoolean("locked", locked); compact = values.optBoolean("compact", compact);
        fontSize = Math.max(14, Math.min(30, values.optInt("fontSize", fontSize)));
        String selectedFont=values.optString("font",font);if(Arrays.asList("sans-serif-medium","serif","monospace").contains(selectedFont))font=selectedFont;
        try { lyricColor = Color.parseColor(values.optString("color", "#c5e9ff")); } catch (Exception ignored) {}
        if (root != null) { resize(); shown = Integer.MIN_VALUE; render(); }
    }
    private int dp(float value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private GradientDrawable glass() {
        GradientDrawable background = new GradientDrawable(GradientDrawable.Orientation.TL_BR, new int[]{0x63212934,0x35202832});
        background.setCornerRadius(dp(24)); background.setStroke(dp(1),0x25ffffff); return background;
    }
    private LinearLayout column() { LinearLayout view = new LinearLayout(this); view.setOrientation(LinearLayout.VERTICAL); return view; }
    private TextView text(int size) { TextView view = new TextView(this); view.setTextSize(size); view.setTextColor(Color.WHITE); view.setGravity(Gravity.CENTER); view.setIncludeFontPadding(false); view.setMaxLines(2); return view; }
    private TextView button(String glyph, String description, Runnable action) {
        TextView view = text(18); view.setText(glyph); view.setContentDescription(description); view.setOnClickListener(v -> { action.run(); reveal(); }); return view;
    }
    private void build() {
        root = column(); root.setPadding(dp(10),dp(5),dp(10),dp(7)); root.setBackground(glass());
        controls = new LinearLayout(this); controls.setGravity(Gravity.CENTER_VERTICAL);
        Icon home = new Icon(this,false); home.setContentDescription("返回 Zenix 主窗口"); home.setOnClickListener(v -> startActivity(new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)));
        controls.addView(home,new LinearLayout.LayoutParams(dp(32),dp(32)));
        TextView grip = text(14); grip.setText("• • •"); grip.setTextColor(0x99ffffff); grip.setContentDescription("拖动悬浮歌词"); controls.addView(grip,new LinearLayout.LayoutParams(0,dp(32),1));
        grip.setOnTouchListener((view,event) -> {
            if (event.getActionMasked()==MotionEvent.ACTION_DOWN) { dragX=event.getRawX();dragY=event.getRawY();startX=frame.x;startY=frame.y;main.removeCallbacks(collapse); }
            else if(event.getActionMasked()==MotionEvent.ACTION_MOVE) { frame.x=startX+(int)(event.getRawX()-dragX);frame.y=startY+(int)(event.getRawY()-dragY);clamp();updateWindow(); }
            else if(event.getActionMasked()==MotionEvent.ACTION_UP) { save();reveal(); }
            return true;
        });
        controls.addView(button(compact?"☷":"≡","切换歌词布局",()->{compact=!compact;resize();save();}),new LinearLayout.LayoutParams(dp(32),dp(32)));
        controls.addView(button("×","关闭悬浮歌词",this::stopSelf),new LinearLayout.LayoutParams(dp(32),dp(32)));root.addView(controls);
        rows=column(); previous=text(fontSize-3);current=text(fontSize);next=text(fontSize-3);
        rows.addView(previous);rows.addView(current);rows.addView(next);root.addView(rows);
        rows.setOnTouchListener((view,event) -> {
            if(locked)return false;
            switch(event.getActionMasked()) {
                case MotionEvent.ACTION_DOWN: lyricDragY=event.getRawY();previewIndex=Math.max(0,LyricTimeline.active(timeline,position()));main.removeCallbacks(returnToCurrent);break;
                case MotionEvent.ACTION_MOVE: if(timeline.isEmpty())break;float distance=event.getRawY()-lyricDragY;if(Math.abs(distance)>dp(25)){previewing=true;previewIndex=Math.max(0,Math.min(timeline.size()-1,previewIndex+(distance<0?1:-1)));lyricDragY=event.getRawY();render();}break;
                case MotionEvent.ACTION_UP: reveal();main.removeCallbacks(returnToCurrent);main.postDelayed(returnToCurrent,3000);view.performClick();break;
                case MotionEvent.ACTION_CANCEL: main.postDelayed(returnToCurrent,3000);break;
            }return true;
        });
        rows.setOnClickListener(v->reveal());
        jump=text(12);jump.setTextColor(lyricColor);jump.setOnClickListener(v->{if(previewing&&previewIndex<timeline.size()&&runtime.service!=null)runtime.service.seek(timeline.get(previewIndex).time);previewing=false;main.removeCallbacks(returnToCurrent);render();reveal();});root.addView(jump);
        footer=column();progress=new SeekBar(this);progress.setMax(1000);progress.setProgressTintList(android.content.res.ColorStateList.valueOf(lyricColor));progress.setThumbTintList(android.content.res.ColorStateList.valueOf(lyricColor));
        progress.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){public void onStartTrackingTouch(SeekBar bar){updatingSeek=true;main.removeCallbacks(collapse);}public void onProgressChanged(SeekBar bar,int value,boolean user){}public void onStopTrackingTouch(SeekBar bar){if(runtime.service!=null)runtime.service.seek(bar.getProgress()/1000.0*runtime.service.progress().optDouble("duration"));updatingSeek=false;reveal();}});footer.addView(progress,new LinearLayout.LayoutParams(-1,dp(26)));
        LinearLayout playback=new LinearLayout(this);playback.setGravity(Gravity.CENTER);
        playback.addView(button("‹","上一首",()->{if(runtime.service!=null)runtime.service.advance(-1);}),new LinearLayout.LayoutParams(dp(40),dp(32)));
        playButton=button("▶","播放或暂停",()->{if(runtime.service!=null)runtime.service.toggle();});playback.addView(playButton,new LinearLayout.LayoutParams(dp(40),dp(32)));
        playback.addView(button("›","下一首",()->{if(runtime.service!=null)runtime.service.advance(1);}),new LinearLayout.LayoutParams(dp(40),dp(32)));
        playback.addView(button("♡","喜欢当前歌曲",()->saved("liked")),new LinearLayout.LayoutParams(dp(40),dp(32)));
        playback.addView(button("☆","收藏当前歌曲",()->saved("favorites")),new LinearLayout.LayoutParams(dp(40),dp(32)));footer.addView(playback);root.addView(footer);
        int type=Build.VERSION.SDK_INT>=26?WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY:WindowManager.LayoutParams.TYPE_PHONE;
        frame=new WindowManager.LayoutParams(dp(330),WindowManager.LayoutParams.WRAP_CONTENT,type,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT);
        frame.gravity=Gravity.TOP|Gravity.LEFT;frame.alpha=.78f;
        JSONObject settings=runtime.store.object("overlay");frame.x=settings==null?dp(15):dp(settings.optInt("x",15));frame.y=settings==null?dp(130):dp(settings.optInt("y",130));
        lock=new Icon(this,true);lock.setContentDescription("锁定或解锁悬浮歌词");lock.setOnClickListener(v->{locked=!locked;previewing=false;expanded=!locked;shown=Integer.MIN_VALUE;resize();render();save();reveal();});
        lockFrame=new WindowManager.LayoutParams(dp(30),dp(30),type,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,PixelFormat.TRANSLUCENT);lockFrame.gravity=Gravity.TOP|Gravity.LEFT;lock.setBackground(glass());
        windows.addView(root,frame);windows.addView(lock,lockFrame);resize();reveal();
        root.addOnLayoutChangeListener((v,a,b,c,d,e,f,g,h)->{if(c-a!=g-e||d-b!=h-f){clamp();updateWindow();}});
    }
    private void saved(String kind) { if(lastTrack==null)return;JSONObject track=Json.copy(lastTrack);runtime.work.execute(()->{try{runtime.store.personal("toggle",Json.obj("kind",kind,"track",track));runtime.emit();}catch(Exception ignored){}}); }
    private double position(){return runtime.service==null?0:runtime.service.progress().optDouble("position");}
    private final Runnable returnToCurrent=()->{previewing=false;shown=Integer.MIN_VALUE;render();};
    private final Runnable collapse=()->{if(!updatingSeek){expanded=false;resize();}};
    private void reveal(){if(locked)return;expanded=true;resize();main.removeCallbacks(collapse);main.postDelayed(collapse,3500);}
    private void resize(){
        if(root==null)return;
        controls.setVisibility(!locked&&expanded?View.VISIBLE:View.GONE);footer.setVisibility(!locked&&expanded?View.VISIBLE:View.GONE);
        if(frame!=null){frame.width=Math.min(dp(compact?255:330),getResources().getDisplayMetrics().widthPixels-dp(24));frame.flags=WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|(locked?WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE:0);}
        previous.setTextSize(fontSize-3);current.setTextSize(fontSize);next.setTextSize(fontSize-3);
        previous.setTextColor((lyricColor&0xffffff)|0x99_000000);next.setTextColor((lyricColor&0xffffff)|0x99_000000);current.setTextColor(lyricColor);
        for(TextView row:Arrays.asList(previous,current,next)){row.setTypeface(Typeface.create(font,Typeface.NORMAL));row.setMinHeight(dp(compact?26:34));row.setPadding(dp(3),dp(4),dp(3),dp(4));}
        lock.locked=locked;lock.invalidate();clamp();updateWindow();
    }
    private void clamp(){if(frame==null)return;int width=getResources().getDisplayMetrics().widthPixels,height=getResources().getDisplayMetrics().heightPixels;frame.x=Math.max(dp(4),Math.min(width-frame.width-dp(4),frame.x));frame.y=Math.max(dp(42),Math.min(height-Math.max(dp(135),root.getHeight())-dp(35),frame.y));}
    private void updateWindow(){if(frame==null||root.getParent()==null)return;try{windows.updateViewLayout(root,frame);lockFrame.x=frame.x+frame.width/2-dp(15);lockFrame.y=Math.max(dp(8),frame.y-dp(30));windows.updateViewLayout(lock,lockFrame);}catch(IllegalArgumentException ignored){}}
    private void save(){try{JSONObject saved=status();Json.put(saved,"x",Math.round(frame.x/getResources().getDisplayMetrics().density));Json.put(saved,"y",Math.round(frame.y/getResources().getDisplayMetrics().density));saved.remove("enabled");saved.remove("permitted");runtime.store.enqueue(Json.obj("overlay",saved));runtime.emit();}catch(Exception ignored){}}
    private void render(){
        int index=previewing?previewIndex:LyricTimeline.active(timeline,position());
        if(index==shown)return;shown=index;
        if(timeline.isEmpty()){previous.setText("");current.setText(message);next.setText(lastTrack==null?"":lastTrack.optString("title"));}
        else{previous.setText(index>0?timeline.get(index-1).text:"");current.setText(index>=0?timeline.get(index).text:timeline.get(0).text);next.setText(index+1<timeline.size()?timeline.get(index+1).text:"");for(TextView row:Arrays.asList(previous,current,next)){row.animate().cancel();row.setTranslationY(dp(6));row.setAlpha(.45f);row.animate().translationY(0).alpha(1).setDuration(230).start();}}
        jump.setVisibility(previewing&&!locked?View.VISIBLE:View.GONE);if(previewing&&previewIndex<timeline.size()){int seconds=(int)timeline.get(previewIndex).time;jump.setText("▶  "+seconds/60+":"+String.format("%02d",seconds%60));}
    }
    private final Runnable tick=new Runnable(){@Override public void run(){
        if(destroyed)return;
        if(!allowed(LyricOverlayService.this)){stopSelf();return;}
        if(screenActive&&runtime.service!=null){JSONObject player=runtime.service.state();JSONObject track=player.optJSONObject("track");String id=track==null?"":track.optString("id");
            if(!id.equals(trackId)){trackId=id;lastTrack=track==null?null:Json.copy(track);timeline=Collections.emptyList();previewing=false;shown=Integer.MIN_VALUE;message=id.isEmpty()?"等待播放音乐":"正在获取歌词";long token=++generation;render();
                if(track!=null){JSONObject song=Json.copy(track);loader.execute(()->{List<LyricTimeline.Line> value=Collections.emptyList();try{value=LyricTimeline.parse(runtime.sources.lyrics(song));}catch(Exception ignored){}List<LyricTimeline.Line> result=value;main.post(()->{if(!destroyed&&token==generation){timeline=result;message="暂未找到歌词";shown=Integer.MIN_VALUE;render();}});});}}
            render();if(!updatingSeek)progress.setProgress((int)(player.optDouble("position")/Math.max(1,player.optDouble("duration"))*1000));playButton.setText(player.optBoolean("playing")?"Ⅱ":"▶");
        }main.postDelayed(this,screenActive?350:2000);
    }};
    private final BroadcastReceiver screenReceiver=new BroadcastReceiver(){@Override public void onReceive(Context context,Intent intent){screenActive=!Intent.ACTION_SCREEN_OFF.equals(intent.getAction());if(root!=null){root.setVisibility(screenActive?View.VISIBLE:View.INVISIBLE);lock.setVisibility(screenActive?View.VISIBLE:View.INVISIBLE);}}};
    @Override public void onConfigurationChanged(android.content.res.Configuration configuration){super.onConfigurationChanged(configuration);resize();}
    @Override public void onDestroy(){destroyed=true;generation++;main.removeCallbacksAndMessages(null);loader.shutdownNow();try{unregisterReceiver(screenReceiver);}catch(Exception ignored){}if(windows!=null){if(root!=null&&root.getParent()!=null)windows.removeView(root);if(lock!=null&&lock.getParent()!=null)windows.removeView(lock);}if(runtime!=null){if(runtime.overlay==this)runtime.overlay=null;runtime.emit();}super.onDestroy();}

    private static final class Icon extends View {
        final boolean isLock;boolean locked;final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);
        Icon(Context context,boolean lock){super(context);isLock=lock;setMinimumWidth(30);setMinimumHeight(30);}
        @Override protected void onDraw(Canvas canvas){super.onDraw(canvas);float scale=Math.min(getWidth(),getHeight())/30f;canvas.save();canvas.scale(scale,scale);paint.setColor(Color.WHITE);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(1.6f);paint.setStrokeCap(Paint.Cap.ROUND);
            if(isLock){canvas.drawRoundRect(9,13,21,23,2,2,paint);canvas.drawArc(11,6,19,18,locked?180:205,locked?180:145,false,paint);canvas.drawLine(15,17,15,20,paint);}else{Path path=new Path();path.moveTo(7,14);path.lineTo(15,7);path.lineTo(23,14);path.moveTo(9,13);path.lineTo(9,23);path.lineTo(21,23);path.lineTo(21,13);path.moveTo(13,23);path.lineTo(13,17);path.lineTo(17,17);path.lineTo(17,23);canvas.drawPath(path,paint);}canvas.restore();}
    }
}
