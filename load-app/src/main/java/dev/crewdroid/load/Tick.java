package dev.crewdroid.load;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// AlarmManager wakeup target: a few ms of work, like an app checking for new messages.
public class Tick extends BroadcastReceiver {
    static volatile long sink;
    static void work() { long x = 7; for (int i = 0; i < 2_000_000; i++) x = x * 31 + i; sink = x; }
    @Override public void onReceive(Context c, Intent i) { work(); }
}
