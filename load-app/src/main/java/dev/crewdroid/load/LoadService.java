package dev.crewdroid.load;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.SharedMemory;
import android.os.SystemClock;
import android.util.Log;
import java.io.BufferedReader;
import java.io.FileReader;
import java.nio.ByteBuffer;
import java.nio.LongBuffer;
import java.util.ArrayList;
import java.util.List;

// One load level for the whole device (src/load.ts force-stops the app before applying another level).
public class LoadService extends Service {
    static final String TAG = "CrewLoad";
    static final int CHUNK_MB = 8;
    final List<SharedMemory> regions = new ArrayList<>();
    final List<ByteBuffer> maps = new ArrayList<>(); // keeps the mappings (and so the pages) alive
    volatile boolean stop;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent in, int flags, int id) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("load", "load", NotificationManager.IMPORTANCE_MIN));
        Notification n = new Notification.Builder(this, "load").setContentTitle("crewdroid load").setSmallIcon(android.R.drawable.stat_notify_sync).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(1, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(1, n);
        if (in == null) return START_NOT_STICKY;
        final int procs = in.getIntExtra("procs", 0), cpu = in.getIntExtra("cpu", 0), alarms = in.getIntExtra("alarms", 0), jobs = in.getIntExtra("jobs", 0);
        final long availKb = in.getLongExtra("availKb", 0);
        final String token = String.valueOf(in.getStringExtra("token"));
        for (int p = 1; p <= procs; p++) startService(new Intent().setClassName(this, getPackageName() + ".Procs$P" + p));
        AlarmManager am = getSystemService(AlarmManager.class);
        for (int a = 0; a < alarms; a++) {
            PendingIntent pi = PendingIntent.getBroadcast(this, a, new Intent(this, Tick.class), PendingIntent.FLAG_IMMUTABLE);
            // inexact repeating wakeups (Android clamps the interval to >= 60 s), spread over the minute
            am.setRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 1000L * (a % 60), 60000L, pi);
        }
        for (int j = 0; j < jobs; j++) Churn.schedule(this, j);
        int cores = Runtime.getRuntime().availableProcessors();
        for (int c = 0; c < (cpu > 0 ? cores : 0); c++) {
            Thread t = new Thread(() -> burn(cpu), "load-cpu-" + c);
            t.setDaemon(true);
            t.start();
        }
        new Thread(() -> {
            // NOTE: the Procs$Pn processes take memory of their own; wait for them before topping up to the target.
            SystemClock.sleep(procs > 0 ? 6000 : 500);
            long seed = 0x9E3779B97F4A7C15L, t0 = SystemClock.uptimeMillis(), inBand = 0;
            boolean ready = false, failed = false;
            // NOTE: kswapd answers the ballast by moving other apps' pages to zram, so MemAvailable climbs back up after
            // each allocation. The loop keeps topping up for as long as the service runs; READY once it has held the target
            // for 5 s in a row (or after 120 s / when memory cannot be mapped any more, with what it got).
            while (!stop) {
                long avail = memAvailableKb();
                if (!failed && availKb > 0 && avail > availKb + CHUNK_MB * 512L) {
                    inBand = 0;
                    try {
                        SharedMemory sm = SharedMemory.create("crew-ballast", CHUNK_MB << 20);
                        ByteBuffer b = sm.mapReadWrite();
                        LongBuffer lb = b.asLongBuffer();
                        // NOTE: pseudo-random words so zram cannot compress the ballast away
                        while (lb.hasRemaining()) { seed ^= seed << 13; seed ^= seed >>> 7; seed ^= seed << 17; lb.put(seed); }
                        regions.add(sm);
                        maps.add(b);
                    } catch (Throwable e) {
                        Log.w(TAG, "ballast stopped: " + e);
                        failed = true;
                    }
                    continue;
                }
                inBand++;
                if (!ready && (inBand >= 5 || failed || SystemClock.uptimeMillis() - t0 > 120000)) {
                    ready = true;
                    Log.i(TAG, "READY " + token + " ballastMB=" + regions.size() * CHUNK_MB + " procs=" + procs + " cpu=" + cpu + "x" + cores + " alarms=" + alarms + " jobs=" + jobs + " availKb=" + avail);
                }
                SystemClock.sleep(1000);
            }
        }, "load-ballast").start();
        return START_NOT_STICKY;
    }

    // duty cycle of `pct` % per 100 ms on one core
    void burn(int pct) {
        long x = 1;
        while (!stop) {
            long end = SystemClock.uptimeMillis() + pct;
            while (SystemClock.uptimeMillis() < end) x = x * 6364136223846793005L + 1442695040888963407L;
            if (x == 42) Log.v(TAG, "never");
            SystemClock.sleep(100 - pct);
        }
    }

    static long memAvailableKb() {
        try (BufferedReader r = new BufferedReader(new FileReader("/proc/meminfo"))) {
            for (String l; (l = r.readLine()) != null; ) if (l.startsWith("MemAvailable:")) return Long.parseLong(l.replaceAll("\\D+", ""));
        } catch (Exception e) { Log.w(TAG, "meminfo: " + e); }
        return 0;
    }

    @Override public void onDestroy() { stop = true; }
}
