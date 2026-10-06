package com.zenix.musicplayer;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Color;
import android.graphics.Rect;
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
        // Compare screen coordinates, rather than subtracting two unrelated
        // heights. OEM adjustResize can already end content above the IME.
        int[] contentPosition = new int[2];
        content.getLocationOnScreen(contentPosition);
        int keyboardTop;
        if (Build.VERSION.SDK_INT >= 30) {
            keyboardTop = getWindowManager().getCurrentWindowMetrics().getBounds().bottom - imeBottom;
        } else {
            Rect visible = new Rect();
            content.getWindowVisibleDisplayFrame(visible);
            keyboardTop = visible.bottom;
        }
        int overlap = imeOpen ? Math.max(0, contentPosition[1] + content.getHeight() - keyboardTop) : 0;
        int bottom = Math.max(safeBars.bottom, overlap);
        if (content.getPaddingLeft() != safeBars.left || content.getPaddingTop() != safeBars.top || content.getPaddingRight() != safeBars.right || content.getPaddingBottom() != bottom)
            content.setPadding(safeBars.left, safeBars.top, safeBars.right, bottom);
        bridge.getWebView().post(this::notifyKeyboardViewport);
    }

    private void notifyKeyboardViewport() {
        float height = bridge.getWebView().getHeight() / getResources().getDisplayMetrics().density;
        String state = "{open:" + imeOpen + ",height:" + height + "}";
        if (height > 0 && !state.equals(lastKeyboardState)) {
            lastKeyboardState = state;
            bridge.getWebView().evaluateJavascript("window.dispatchEvent(new CustomEvent('zenix-keyboard',{detail:" + state + "}))", null);
        }
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
            imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            applyKeyboardInsets(view);
            // Native owns these insets; forwarding them would pad the WebView twice.
            return new WindowInsetsCompat.Builder(insets).setInsets(safe | WindowInsetsCompat.Type.ime(), Insets.NONE).build();
        });
        content.addOnLayoutChangeListener((view,l,t,r,b,ol,ot,or,ob) -> {
            if (b - t != ob - ot) applyKeyboardInsets(view);
        });
        // Padding changes resize the child without changing content's bounds.
        bridge.getWebView().addOnLayoutChangeListener((view,l,t,r,b,ol,ot,or,ob) -> {
            if (b - t != ob - ot) notifyKeyboardViewport();
        });
        ViewCompat.requestApplyInsets(content);
        new WindowInsetsControllerCompat(getWindow(),getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){if(bridge!=null)bridge.getWebView().evaluateJavascript("document.dispatchEvent(new Event('zenix-back'))",null);}});
    }
}
