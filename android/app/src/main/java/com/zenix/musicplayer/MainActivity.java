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
    private Insets safeBars = Insets.NONE;
    private int imeBottom;
    private boolean imeOpen;
    private String lastKeyboardState = "";

    private void applyKeyboardInsets(View content) {
        // adjustResize may already consume the keyboard's height on some OEMs.
        int consumed = Build.VERSION.SDK_INT >= 30
            ? Math.max(0, getWindowManager().getCurrentWindowMetrics().getBounds().height() - content.getHeight()) : 0;
        int bottom = Math.max(safeBars.bottom, Math.max(0, imeBottom - consumed));
        if (content.getPaddingLeft() != safeBars.left || content.getPaddingTop() != safeBars.top || content.getPaddingRight() != safeBars.right || content.getPaddingBottom() != bottom)
            content.setPadding(safeBars.left, safeBars.top, safeBars.right, bottom);
        bridge.getWebView().post(() -> {
            float height = bridge.getWebView().getHeight() / getResources().getDisplayMetrics().density;
            String state = "{open:" + imeOpen + ",height:" + height + "}";
            if (height > 0 && !state.equals(lastKeyboardState)) {
                lastKeyboardState = state;
                bridge.getWebView().evaluateJavascript("window.dispatchEvent(new CustomEvent('zenix-keyboard',{detail:" + state + "}))", null);
            }
        });
    }
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
            safeBars = insets.getInsets(safe);
            imeOpen = insets.isVisible(WindowInsetsCompat.Type.ime());
            imeBottom = Build.VERSION.SDK_INT >= 30 ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom : 0;
            applyKeyboardInsets(view);
            // Native owns these insets; forwarding them would pad the WebView twice.
            return new WindowInsetsCompat.Builder(insets).setInsets(safe | WindowInsetsCompat.Type.ime(), Insets.NONE).build();
        });
        content.addOnLayoutChangeListener((view,l,t,r,b,ol,ot,or,ob) -> {
            if (b - t != ob - ot) applyKeyboardInsets(view);
        });
        ViewCompat.requestApplyInsets(content);
        new WindowInsetsControllerCompat(getWindow(),getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){if(bridge!=null)bridge.getWebView().evaluateJavascript("document.dispatchEvent(new Event('zenix-back'))",null);}});
    }
}
