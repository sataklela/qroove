package com.sataklela.qroove;

import android.app.UiModeManager;
import android.content.res.Configuration;
import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // On Android TV / projectors the site switches to its 10-foot, remote-control layout. The web
        // code (apps/web/src/shared/native.ts isTv) looks for the LeanbackShell marker in the user agent.
        UiModeManager ui = (UiModeManager) getSystemService(UI_MODE_SERVICE);
        if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) {
            WebSettings s = getBridge().getWebView().getSettings();
            s.setUserAgentString(s.getUserAgentString() + " LeanbackShell");
        }
    }
}
