package com.posturecoach.app;

// 웹(JS)에서 쓰는 SlimeVR 트래커 수신 플러그인
//   const SlimeVR = registerPlugin("SlimeVR");
//   await SlimeVR.start();  SlimeVR.addListener("state", (s) => ...)  // 초당 약 50번
//   await SlimeVR.stop();

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.HandlerThread;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

@CapacitorPlugin(name = "SlimeVR")
public class SlimeVRPlugin extends Plugin {
    private SlimeServer server;
    private WifiManager.MulticastLock lock;
    private HandlerThread thread;
    private Handler handler;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            SlimeServer s = server;
            if (s == null) return;
            try { notifyListeners("state", state(s)); } catch (Exception ignored) { }
            if (handler != null) handler.postDelayed(this, 20);
        }
    };

    @PluginMethod
    public void start(PluginCall call) {
        try {
            if (server == null) {
                // 브로드캐스트(트래커가 서버를 찾는 신호)를 받으려면 필요 — 안 하면 일부 폰이 걸러버림
                WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    lock = wifi.createMulticastLock("posture-coach-slimevr");
                    lock.setReferenceCounted(false);
                    lock.acquire();
                }
                server = new SlimeServer();
                server.start();
                thread = new HandlerThread("slimevr-notify");
                thread.start();
                handler = new Handler(thread.getLooper());
                handler.post(tick);
            }
            call.resolve(state(server));
        } catch (Exception e) {
            stopAll();
            // 포트 6969를 다른 앱(공식 SlimeVR 앱 등)이 쓰고 있으면 여기서 실패
            call.reject("트래커 수신을 시작하지 못했어요: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopAll();
        call.resolve();
    }

    @PluginMethod
    public void getState(PluginCall call) {
        try {
            call.resolve(server == null ? idle() : state(server));
        } catch (Exception e) {
            call.reject(e.getMessage(), e);
        }
    }

    private JSObject idle() {
        JSObject o = new JSObject();
        o.put("running", false);
        o.put("trackers", new JSArray());
        o.put("ips", ips());
        return o;
    }

    private JSObject state(SlimeServer s) throws Exception {
        JSObject o = new JSObject(s.toJson());
        o.put("ips", ips());
        JSArray log = new JSArray();
        for (String l : s.takeLog()) log.put(l);
        o.put("log", log);
        return o;
    }

    /** 폰의 와이파이(또는 핫스팟) IP — 화면에 보여주기용 */
    private static JSArray ips() {
        JSArray out = new JSArray();
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) out.put(ni.getName() + " " + a.getHostAddress());
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    private void stopAll() {
        if (handler != null) handler.removeCallbacksAndMessages(null);
        if (thread != null) thread.quitSafely();
        handler = null;
        thread = null;
        if (server != null) server.stop();
        server = null;
        if (lock != null && lock.isHeld()) lock.release();
        lock = null;
    }

    @Override
    protected void handleOnDestroy() {
        stopAll();
        super.handleOnDestroy();
    }
}
