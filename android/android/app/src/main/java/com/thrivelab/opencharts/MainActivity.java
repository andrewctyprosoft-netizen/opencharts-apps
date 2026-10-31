package com.thrivelab.opencharts;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugin: native HTTPS, OANDA's price stream, Keystore secrets, external links.
        registerPlugin(OcNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
