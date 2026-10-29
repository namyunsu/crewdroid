# One device: crewdroid vs Android Studio's default emulator (T72, FR-48)

Date: 2026-10-28. Host: AMD Ryzen 7 5700X 8-Core Processor, 16 threads, 64 GB RAM, win32 10.0.26300, emulator 37.1.11.0. Median of 3 runs per side; nothing else emulating.

- Studio side: AVD made with avdmanager (`pixel_9`, `system-images;android-36;google_apis_playstore;x86_64`, {"hw.ramSize":"2G","hw.cpu.ncore":"4","hw.lcd.width":"1080","hw.lcd.height":"2424","hw.lcd.density":"420","hw.gpu.mode":"auto","image.sysdir.1":"system-images\\android-36\\google_apis_playstore\\x86_64\\","disk.dataPartition.size":"10G"}), visible window, -gpu auto, quickboot (snapshot saved on exit).
- crewdroid side: crewdroid up (no flags): headless, -gpu host, snapshot, 2 cores; base AVD `crew-android-36-google_atd` (android-36/google_atd).

| | Studio default AVD | crewdroid |
|---|---|---|
| Cold boot to sys.boot_completed | 39.3 s | 23.7 s |
| Cold boot to first screen read | 43 s | 29.7 s |
| Start from snapshot to sys.boot_completed | 5.4 s | 5.6 s |
| Start from snapshot to first screen read | 10 s | 14.4 s |
| Host RAM after ready (60 s idle) | 3479 MB | 1426 MB |
| Idle CPU over 60 s (100 % = 1 core) | 215.1 % | 170 % |
| Disk (AVD + system image) | 6.78 GiB | 2.09 GiB |
| Screen read, median of 10 | 2137.5 (adb uiautomator dump) ms | 947.1 (`crewdroid screen` CLI) ms |
| Screenshot, median of 10 | 814.1 (adb screencap) ms | 1041.4 (`crewdroid shot` CLI) ms |

Extra crewdroid rows: stock `adb` calls on the crewdroid device 2160.7 ms (dump) and 250 ms (screencap); the same `screen` / `shot` functions in-process (what the MCP server runs) 176.6 ms and 290.3 ms. `up` itself reports ready after 7.9 s.

System image on disk (already included in the Studio disk row above; it can stay installed): 2.28 GiB.

## Per run
Studio: [{"coldBoot":39.3,"coldReady":43,"snapBoot":12.9,"snapReady":16.6,"snapLoadMs":657,"ramMB":3508,"cpuPercent":362.2,"screenMs":2715.7,"shotMs":1128.4},{"coldBoot":41.2,"coldReady":43.9,"snapBoot":5.4,"snapReady":10,"snapLoadMs":544,"ramMB":3479,"cpuPercent":215.1,"screenMs":2137.5,"shotMs":814.1},{"coldBoot":24.4,"coldReady":27.1,"snapBoot":5.3,"snapReady":9.1,"snapLoadMs":534,"ramMB":2949,"cpuPercent":48.4,"screenMs":2071.9,"shotMs":719.6}]

crewdroid: [{"coldBoot":35.8,"coldReady":42.5,"snapBoot":51,"upReady":52.7,"upWall":53.7,"snapReady":59.1,"ramMB":1426,"cpuPercent":185,"stockScreenMs":2202.3,"stockShotMs":275.3,"screenMs":945,"shotMs":1045.1,"inProcessScreenMs":176.6,"inProcessShotMs":290.3},{"coldBoot":23.7,"coldReady":29,"snapBoot":5.6,"upReady":7.9,"upWall":8.9,"snapReady":14.4,"ramMB":1462,"cpuPercent":168.1,"stockScreenMs":2114,"stockShotMs":250,"screenMs":947.1,"shotMs":1038.7,"inProcessScreenMs":176.4,"inProcessShotMs":290.1},{"coldBoot":23.6,"coldReady":29.7,"snapBoot":5.5,"upReady":7.7,"upWall":8.6,"snapReady":14.2,"ramMB":1420,"cpuPercent":170,"stockScreenMs":2160.7,"stockShotMs":246.6,"screenMs":967.7,"shotMs":1041.4,"inProcessScreenMs":177.7,"inProcessShotMs":292.4}]

## Method
- boot: seconds from launch to sys.boot_completed=1 (adb getprop poll, 1 s)
- ready: seconds from launch to the first successful `adb exec-out uiautomator dump /dev/tty`; crewdroid snapshot start = wall time of `crewdroid up` (incl. node start) + that first dump
- cold: Studio: -no-snapshot-load. crewdroid: the `up` launch args plus -no-snapshot-load (up itself never cold boots)
- snapshot: Studio: quickboot snapshot saved on the previous exit. crewdroid: `crewdroid up` (default_boot of the base AVD)
- ram: WorkingSet64 (Get-Process), emulator + qemu processes of the instance, taken at the end of the 60 s idle window
- cpu: cumulative CPU seconds of those processes over 60 s idle, 100 % = 1 core
- calls: median of 10 calls per rep, then median of the 3 reps. Studio and crewdroid-stock: adb exec-out uiautomator dump /dev/tty and screencap -p. crewdroid: wall time of 'npx tsx src/cli.ts screen|shot' (incl. node start) and, in-process, of the same functions the MCP server calls
- disk: bytes actually allocated (NTFS compression and sparse holes excluded) of the AVD dir + its system image dir
