package com.thrivelab.opencharts;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.Reader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;

/**
 * The app's native side of the bridge (bridge/net.js, bridge/secure.js), standing in for what
 * the desktop app's Electron main process did:
 *
 * <ul>
 *   <li>{@code request}: HTTPS without the WebView's CORS limits, for the exchanges, OANDA,
 *       GeckoTerminal, Swissquote, Yahoo Finance, CoinGecko and the wallet nodes;</li>
 *   <li>{@code streamOpen} / {@code streamCancel}: OANDA's chunked price stream, as events;</li>
 *   <li>{@code dataKey}: a 256-bit key wrapped by an Android Keystore key, which seals the API
 *       keys and the OANDA token (the desktop app used Windows DPAPI);</li>
 *   <li>{@code notify}: price alert notifications, posted at once (a tap charts the pair);
 *       nothing is scheduled, so the app needs no exact-alarm permission;</li>
 *   <li>{@code openExternal}: links open in the phone's browser.</li>
 * </ul>
 *
 * Only HTTPS hosts the app talks to are reachable.
 */
@CapacitorPlugin(
    name = "OcNative",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class OcNativePlugin extends Plugin {

    private static final Set<String> HOSTS = new HashSet<>(
        Arrays.asList(
            // Exchanges: market data and signed trading requests
            "api.binance.com",
            "testnet.binance.vision",
            "www.okx.com",
            "api.bybit.com",
            "api-testnet.bybit.com",
            "api.kucoin.com",
            "api.exchange.coinbase.com",
            "api.coinbase.com",
            "api.mexc.com",
            // Exchanges read for the portfolio only
            "api.huobi.pro",
            "whitebit.com",
            "api.gateio.ws",
            "api.hitbtc.com",
            "api.poloniex.com",
            // This device's public IPv4 address, shown when an exchange refuses a key
            "api.ipify.org",
            // DEX pools, forex and metals, the market overview, wallets
            "api.geckoterminal.com",
            "forex-data-feed.swissquote.com",
            "query1.finance.yahoo.com",
            "api.coingecko.com",
            "api.ethplorer.io",
            "mempool.space",
            "api.dexscreener.com",
            "lite-api.jup.ag",
            "ethereum-rpc.publicnode.com",
            "bsc-rpc.publicnode.com",
            "base-rpc.publicnode.com",
            "arbitrum-one-rpc.publicnode.com",
            "polygon-bor-rpc.publicnode.com",
            "optimism-rpc.publicnode.com",
            "avalanche-c-chain-rpc.publicnode.com",
            "api.mainnet-beta.solana.com",
            // OANDA v20
            "api-fxpractice.oanda.com",
            "stream-fxpractice.oanda.com",
            "api-fxtrade.oanda.com",
            "stream-fxtrade.oanda.com"
        )
    );

    private static final String UA = "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) OpenChartsAndroid";
    private static final String KEY_ALIAS = "oc_master";
    private static final String PREFS = "oc_secure";
    private static final String CHANNEL = "alerts";
    private static final String EXTRA_SYMBOL = "com.thrivelab.opencharts.SYMBOL";

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> streams = new ConcurrentHashMap<>();

    // ── HTTP ────────────────────────────────────────────────

    private HttpURLConnection open(PluginCall call, int readTimeoutMs) throws IOException {
        String url = call.getString("url", "");
        URL u = new URL(url);
        if (!"https".equals(u.getProtocol()) || !HOSTS.contains(u.getHost()) || u.getUserInfo() != null) {
            throw new IOException("Host not allowed: " + u.getHost());
        }
        HttpsURLConnection c = (HttpsURLConnection) u.openConnection();
        String method = call.getString("method", "GET").toUpperCase();
        c.setRequestMethod(method);
        c.setConnectTimeout(15_000);
        c.setReadTimeout(readTimeoutMs);
        c.setInstanceFollowRedirects(true);
        c.setUseCaches(false);
        c.setRequestProperty("User-Agent", UA);
        JSObject headers = call.getObject("headers", new JSObject());
        for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
            String k = it.next();
            String v = headers.optString(k, null);
            if (v != null) c.setRequestProperty(k, v);
        }
        String body = call.getString("body");
        if (body != null && !body.isEmpty() && !"GET".equals(method)) {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            c.setDoOutput(true);
            c.setFixedLengthStreamingMode(bytes.length);
            try (OutputStream out = c.getOutputStream()) {
                out.write(bytes);
            }
        }
        return c;
    }

    private static JSObject headersOf(HttpURLConnection c) {
        JSObject h = new JSObject();
        for (Map.Entry<String, List<String>> e : c.getHeaderFields().entrySet()) {
            if (e.getKey() == null || e.getValue() == null || e.getValue().isEmpty()) continue;
            h.put(e.getKey().toLowerCase(), e.getValue().get(0));
        }
        return h;
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream s = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16_384];
            int n;
            while ((n = s.read(buf)) != -1) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    private static InputStream bodyOf(HttpURLConnection c, int status) throws IOException {
        return status >= 400 ? c.getErrorStream() : c.getInputStream();
    }

    @PluginMethod
    public void request(PluginCall call) {
        int timeout = call.getInt("timeoutMs", 30_000);
        pool.execute(() -> {
            HttpURLConnection c = null;
            try {
                c = open(call, timeout);
                int status = c.getResponseCode();
                JSObject res = new JSObject();
                res.put("status", status);
                res.put("statusText", c.getResponseMessage() == null ? "" : c.getResponseMessage());
                res.put("headers", headersOf(c));
                res.put("body", readAll(bodyOf(c, status)));
                call.resolve(res);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        });
    }

    @PluginMethod
    public void streamOpen(PluginCall call) {
        String id = call.getString("id", "");
        pool.execute(() -> {
            HttpURLConnection c = null;
            boolean resolved = false;
            try {
                // OANDA sends a heartbeat every 5 s; 30 s of silence means the stream is dead.
                c = open(call, 30_000);
                int status = c.getResponseCode();
                JSObject head = new JSObject();
                head.put("status", status);
                head.put("statusText", c.getResponseMessage() == null ? "" : c.getResponseMessage());
                head.put("headers", headersOf(c));
                if (status >= 400) {
                    head.put("body", readAll(c.getErrorStream()));
                    resolved = true;
                    call.resolve(head);
                    return;
                }
                streams.put(id, c);
                resolved = true;
                call.resolve(head);
                try (Reader r = new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8)) {
                    char[] buf = new char[8_192];
                    int n;
                    while ((n = r.read(buf)) != -1) {
                        if (!streams.containsKey(id)) return;
                        JSObject ev = new JSObject();
                        ev.put("id", id);
                        ev.put("chunk", new String(buf, 0, n));
                        notifyListeners("streamData", ev);
                    }
                }
                end(id, null);
            } catch (Exception e) {
                String why = e.getMessage() == null ? e.toString() : e.getMessage();
                if (!resolved) call.reject(why);
                else end(id, why);
            } finally {
                streams.remove(id);
                if (c != null) c.disconnect();
            }
        });
    }

    private void end(String id, String error) {
        if (streams.remove(id) == null) return; // cancelled from the page
        JSObject ev = new JSObject();
        ev.put("id", id);
        if (error != null) ev.put("error", error);
        notifyListeners("streamEnd", ev);
    }

    @PluginMethod
    public void streamCancel(PluginCall call) {
        HttpURLConnection c = streams.remove(call.getString("id", ""));
        if (c != null) pool.execute(c::disconnect);
        call.resolve();
    }

    // ── Secret storage ──────────────────────────────────────

    private SecretKey masterKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return gen.generateKey();
    }

    /** The data key, created on first use; a key the Keystore can no longer open is replaced. */
    @PluginMethod
    public void dataKey(PluginCall call) {
        pool.execute(() -> {
            try {
                SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                SecretKey master = masterKey();
                String sealed = prefs.getString("dataKey", null);
                byte[] key = null;
                if (sealed != null) {
                    try {
                        byte[] blob = Base64.decode(sealed, Base64.NO_WRAP);
                        Cipher dec = Cipher.getInstance("AES/GCM/NoPadding");
                        dec.init(Cipher.DECRYPT_MODE, master, new GCMParameterSpec(128, blob, 0, 12));
                        key = dec.doFinal(blob, 12, blob.length - 12);
                    } catch (Exception e) {
                        key = null; // Keystore key changed (reinstall, restore): start a new one
                    }
                }
                if (key == null) {
                    key = new byte[32];
                    new SecureRandom().nextBytes(key);
                    Cipher enc = Cipher.getInstance("AES/GCM/NoPadding");
                    enc.init(Cipher.ENCRYPT_MODE, master);
                    byte[] iv = enc.getIV();
                    byte[] ct = enc.doFinal(key);
                    byte[] blob = new byte[iv.length + ct.length];
                    System.arraycopy(iv, 0, blob, 0, iv.length);
                    System.arraycopy(ct, 0, blob, iv.length, ct.length);
                    prefs.edit().putString("dataKey", Base64.encodeToString(blob, Base64.NO_WRAP)).apply();
                }
                JSObject res = new JSObject();
                res.put("key", Base64.encodeToString(key, Base64.NO_WRAP));
                Arrays.fill(key, (byte) 0);
                call.resolve(res);
            } catch (Exception e) {
                call.reject("Android Keystore unavailable: " + e.getMessage());
            }
        });
    }

    // ── Alert notifications ─────────────────────────────────

    @Override
    public void load() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Price alerts", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("A price crossed one of your alerts");
            ch.enableVibration(true);
            getContext().getSystemService(NotificationManager.class).createNotificationChannel(ch);
        }
        handleTap(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        handleTap(intent);
    }

    /** A tapped alert notification opens the app with its symbol; the page charts it. */
    private void handleTap(Intent intent) {
        if (intent == null) return;
        String symbol = intent.getStringExtra(EXTRA_SYMBOL);
        if (symbol == null) return;
        intent.removeExtra(EXTRA_SYMBOL);
        JSObject ev = new JSObject();
        ev.put("symbol", symbol);
        notifyListeners("notificationTap", ev, true);
    }

    private String notificationState() {
        if (!NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) return "denied";
        if (Build.VERSION.SDK_INT < 33) return "granted";
        PermissionState st = getPermissionState("notifications");
        return st == PermissionState.GRANTED ? "granted" : st == PermissionState.DENIED ? "denied" : "prompt";
    }

    /** {request: true} asks for the permission (Android 13+) when it has not been answered yet. */
    @PluginMethod
    public void notificationPermission(PluginCall call) {
        String state = notificationState();
        if ("prompt".equals(state) && call.getBoolean("request", false)) {
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
            return;
        }
        JSObject res = new JSObject();
        res.put("state", state);
        call.resolve(res);
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        JSObject res = new JSObject();
        res.put("state", notificationState());
        call.resolve(res);
    }

    @PluginMethod
    public void notify(PluginCall call) {
        if (!"granted".equals(notificationState())) {
            call.reject("Notifications are not allowed.");
            return;
        }
        int id = call.getInt("id", (int) (System.currentTimeMillis() & 0x7fffffff));
        String symbol = call.getString("symbol", "");
        Intent open = new Intent(getContext(), MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (!symbol.isEmpty()) open.putExtra(EXTRA_SYMBOL, symbol);
        PendingIntent tap = PendingIntent.getActivity(
            getContext(),
            id,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder n = new NotificationCompat.Builder(getContext(), CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_alert)
            .setColor(0xFF14B8A6)
            .setContentTitle(call.getString("title", "Price alert"))
            .setContentText(call.getString("body", ""))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(call.getString("body", "")))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setAutoCancel(true)
            .setContentIntent(tap);
        try {
            NotificationManagerCompat.from(getContext()).notify(id, n.build());
            call.resolve();
        } catch (SecurityException e) {
            call.reject("Notifications are not allowed.");
        }
    }

    // ── Links ───────────────────────────────────────────────

    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url", "");
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            call.reject("Only web links open outside the app.");
            return;
        }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (ActivityNotFoundException e) {
            call.reject("No browser to open the link.");
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (HttpURLConnection c : streams.values()) c.disconnect();
        streams.clear();
        pool.shutdownNow();
    }
}
