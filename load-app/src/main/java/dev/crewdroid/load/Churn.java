package dev.crewdroid.load;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

// A job that does a little work and schedules itself again ~10 s later: JobScheduler churn like sync/analytics jobs.
public class Churn extends JobService {
    static void schedule(Context c, int id) {
        c.getSystemService(JobScheduler.class).schedule(new JobInfo.Builder(1000 + id, new ComponentName(c, Churn.class))
            .setMinimumLatency(10000).setOverrideDeadline(30000).build());
    }

    @Override public boolean onStartJob(JobParameters p) {
        Tick.work();
        schedule(this, p.getJobId() - 1000);
        return false;
    }

    @Override public boolean onStopJob(JobParameters p) { return false; }
}
