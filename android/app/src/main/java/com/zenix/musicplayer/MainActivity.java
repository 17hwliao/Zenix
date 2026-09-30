package com.zenix.musicplayer;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(ZenixNativePlugin.class); super.onCreate(state);
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content),(view,insets)->{androidx.core.graphics.Insets bars=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout()|WindowInsetsCompat.Type.ime());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        new WindowInsetsControllerCompat(getWindow(),getWindow().getDecorView()).setAppearanceLightStatusBars(false);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){if(bridge!=null)bridge.getWebView().evaluateJavascript("document.dispatchEvent(new Event('zenix-back'))",null);}});
    }
}
