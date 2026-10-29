package dev.crewdroid.load;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

// `am start -n dev.crewdroid.load/.Start --ei procs N --el availKb K --ei cpu P --ei alarms A --ei jobs J --es token T`
// An app may start a foreground service only while it is in front, so this invisible activity does it and finishes.
public class Start extends Activity {
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        Intent i = new Intent(this, LoadService.class);
        if (getIntent().getExtras() != null) i.putExtras(getIntent().getExtras());
        startForegroundService(i);
        finish();
    }
}
