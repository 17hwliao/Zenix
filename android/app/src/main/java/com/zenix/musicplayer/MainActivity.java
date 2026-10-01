package com.zenix.musicplayer;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowCompat;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(ZenixNativePlugin.class); super.onCreate(state);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setBackgroundDrawable(new ColorDrawable(Color.rgb(16,17,23)));
        View content = findViewById(android.R.id.content);
        content.setBackgroundColor(Color.rgb(16,17,23));
        bridge.getWebView().setBackgroundColor(Color.rgb(16,17,23));
        bridge.getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            int safe = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
            Insets bars = insets.getInsets(safe);
            // Before Android 11 adjustResize already shrinks the native root for IME.
            int keyboard = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard));
            // Native owns these insets; forwarding them would pad the WebView twice.
            return new WindowInsetsCompat.Builder(insets).setInsets(safe | WindowInsetsCompat.Type.ime(), Insets.NONE).build();
        });
        ViewCompat.requestApplyInsets(content);
        new WindowInsetsControllerCompat(getWindow(),getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){if(bridge!=null)bridge.getWebView().evaluateJavascript("document.dispatchEvent(new Event('zenix-back'))",null);}});
    }
}
