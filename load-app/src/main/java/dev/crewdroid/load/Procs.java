package dev.crewdroid.load;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

// Background app processes: each Pn runs in its own process (:pn, see the manifest) and holds a little heap, like an app
// that was used and sent to the background. START_STICKY: the system restarts it after a low-memory kill, as it does for apps.
public class Procs {
    public static class Proc extends Service {
        byte[] heap;
        @Override public int onStartCommand(Intent i, int f, int id) {
            if (heap == null) { heap = new byte[4 << 20]; for (int k = 0; k < heap.length; k += 4096) heap[k] = (byte) k; }
            return START_STICKY;
        }
        @Override public IBinder onBind(Intent i) { return null; }
    }
    public static class P1 extends Proc {}
    public static class P2 extends Proc {}
    public static class P3 extends Proc {}
    public static class P4 extends Proc {}
    public static class P5 extends Proc {}
    public static class P6 extends Proc {}
    public static class P7 extends Proc {}
    public static class P8 extends Proc {}
    public static class P9 extends Proc {}
    public static class P10 extends Proc {}
    public static class P11 extends Proc {}
    public static class P12 extends Proc {}
    public static class P13 extends Proc {}
    public static class P14 extends Proc {}
    public static class P15 extends Proc {}
    public static class P16 extends Proc {}
    public static class P17 extends Proc {}
    public static class P18 extends Proc {}
    public static class P19 extends Proc {}
    public static class P20 extends Proc {}
    public static class P21 extends Proc {}
    public static class P22 extends Proc {}
    public static class P23 extends Proc {}
    public static class P24 extends Proc {}
    public static class P25 extends Proc {}
    public static class P26 extends Proc {}
    public static class P27 extends Proc {}
    public static class P28 extends Proc {}
    public static class P29 extends Proc {}
    public static class P30 extends Proc {}
}
