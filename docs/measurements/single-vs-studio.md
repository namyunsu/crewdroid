# One device: crewdroid vs Android Studio's default emulator (T72, FR-48)

Date: 2026-11-01. Host: AMD Ryzen 7 5700X 8-Core Processor, 16 threads, 64 GB RAM, win32 10.0.26300, emulator 37.1.11.0. Median of 3 runs per side; nothing else emulating.

- Studio side: AVD made with avdmanager (`pixel_9`, `system-images;android-36;google_apis_playstore;x86_64`, {"hw.ramSize":"2G","hw.cpu.ncore":"4","hw.lcd.width":"1080","hw.lcd.height":"2424","hw.lcd.density":"420","hw.gpu.mode":"auto","image.sysdir.1":"system-images\\android-36\\google_apis_playstore\\x86_64\\","disk.dataPartition.size":"10G"}), visible window, -gpu auto, quickboot (snapshot saved on exit).
- crewdroid side: crewdroid up (no flags): headless, -gpu host, snapshot, 2 cores; base AVD `crew-android-36-google_atd` (android-36/google_atd).

| | Studio default AVD | crewdroid |
|---|---|---|
| Cold boot to sys.boot_completed | 25.1 s | 24.6 s |
| Cold boot to first screen read | 28 s | 30.1 s |
| Start from snapshot to sys.boot_completed | 5.3 s | 5.5 s |
| Start from snapshot to first screen read | 8.7 (adb uiautomator dump) s | 12.7 (`crewdroid up` CLI, then adb uiautomator dump) s |
| Start from snapshot to first screen read, crewdroid through its MCP server | 8.7 (adb uiautomator dump) s | 13.7 (MCP `up`, then MCP `screen`) s |
| Host RAM after ready (60 s idle) | 3388 MB | 1472 MB |
| Idle CPU over 60 s (100 % = 1 core) | 200.5 % | 213.3 % |
| Disk (AVD + system image) | 7.29 GiB | 2.09 GiB |
| Screen read, median of 10 | 2074.1 (adb uiautomator dump) ms | 370.7 (`crewdroid screen` CLI) ms |
| Screenshot, median of 10 | 723.7 (adb screencap) ms | 445.6 (`crewdroid shot` CLI) ms |

Extra crewdroid rows: stock `adb` calls on the crewdroid device 2199.8 ms (dump) and 251.4 ms (screencap); MCP `screen` / `shot` on the running server 175.2 ms and 286.3 ms; the same functions in-process 174.8 ms and 282.5 ms.

## Where crewdroid's start from snapshot goes (median)
- `crewdroid up` CLI wall 7.6 s = node start, input checks, emulator launch call and exit 0.5 s +`up` ready 7.1 s. `up` phases, seconds from launch: adbDevice 5.4, bootCompleted 5.5, hwui 5.6, root 5.6, identity 5.6, wm 6.9, helper 6.9.
- Then the first stock `adb uiautomator dump` 5.3 s; row 4 is the two added.
- MCP path: `up` 7.9 s, first `screen` 6.2 s (on-device helper, no uiautomator), 13.7 s in all.

System image on disk (already included in the Studio disk row above; it can stay installed): 2.28 GiB.

## Per run
Studio: [{"coldBoot":27.3,"coldReady":34.9,"snapBoot":5.3,"snapReady":9,"snapLoadMs":511,"ramMB":3601,"cpuPercent":383.1,"screenMs":2230.4,"shotMs":1046.2},{"coldBoot":25.1,"coldReady":28,"snapBoot":5.3,"snapReady":8.7,"snapLoadMs":519,"ramMB":3388,"cpuPercent":200.5,"screenMs":2072.1,"shotMs":723.7},{"coldBoot":23.1,"coldReady":26.1,"snapBoot":5.3,"snapReady":8.6,"snapLoadMs":506,"ramMB":2918,"cpuPercent":42.5,"screenMs":2074.1,"shotMs":719.2}]

crewdroid: [{"coldBoot":25.8,"coldReady":30.2,"snapBoot":5.5,"upReady":7.7,"upWall":8.1,"cliStart":0.4,"firstStockDump":6.6,"snapReady":14.7,"upPhases":{"adbDevice":5.4,"bootCompleted":5.5,"hwui":5.6,"root":5.7,"identity":5.7,"wm":7.1,"helper":7.1},"mcpUp":8.1,"mcpUpReady":7.8,"mcpUpPhases":{"adbDevice":5.4,"bootCompleted":5.5,"hwui":5.6,"root":5.7,"identity":5.7,"wm":7.5,"helper":7.5},"mcpScreenFirst":5.7,"mcpReady":13.7,"ramMB":1474,"cpuPercent":203.4,"stockScreenMs":2178.3,"stockShotMs":251.4,"screenMs":369.2,"shotMs":460.7,"inProcessScreenMs":175.7,"inProcessShotMs":286.1,"mcpScreenMs":175.2,"mcpShotMs":288.8},{"coldBoot":24.5,"coldReady":30.1,"snapBoot":5.5,"upReady":7,"upWall":7.5,"cliStart":0.5,"firstStockDump":5.3,"snapReady":12.7,"upPhases":{"adbDevice":5.4,"bootCompleted":5.5,"hwui":5.6,"root":5.6,"identity":5.6,"wm":6.8,"helper":6.8},"mcpUp":7,"mcpUpReady":6.7,"mcpUpPhases":{"adbDevice":5.4,"bootCompleted":5.5,"hwui":5.5,"root":5.6,"identity":5.6,"wm":6.4,"helper":6.4},"mcpScreenFirst":6.6,"mcpReady":13.5,"ramMB":1472,"cpuPercent":213.3,"stockScreenMs":2410.6,"stockShotMs":248.5,"screenMs":372.1,"shotMs":445.6,"inProcessScreenMs":174.8,"inProcessShotMs":279.4,"mcpScreenMs":177.4,"mcpShotMs":280.5},{"coldBoot":24.6,"coldReady":29.9,"snapBoot":5.4,"upReady":7.1,"upWall":7.6,"cliStart":0.5,"firstStockDump":5.1,"snapReady":12.7,"upPhases":{"adbDevice":5.4,"bootCompleted":5.4,"hwui":5.5,"root":5.6,"identity":5.6,"wm":6.9,"helper":6.9},"mcpUp":7.9,"mcpUpReady":7.7,"mcpUpPhases":{"adbDevice":5.4,"bootCompleted":5.5,"hwui":5.5,"root":5.6,"identity":5.6,"wm":7.4,"helper":7.4},"mcpScreenFirst":6.2,"mcpReady":14.1,"ramMB":1469,"cpuPercent":219,"stockScreenMs":2199.8,"stockShotMs":252.3,"screenMs":370.7,"shotMs":441.2,"inProcessScreenMs":172.8,"inProcessShotMs":282.5,"mcpScreenMs":174.7,"mcpShotMs":286.3}]

## Method
- boot: seconds from launch to sys.boot_completed=1 (adb getprop poll, 1 s)
- ready: seconds from launch to the first successful `adb exec-out uiautomator dump /dev/tty`; crewdroid snapshot start = wall time of `crewdroid up` (incl. node start) + that first dump
- mcpReady: crewdroid only: one `crewdroid mcp` server process kept running; seconds from sending the MCP `up` call (no args) until the MCP `screen` call on its device returns the outline
- cold: Studio: -no-snapshot-load. crewdroid: the `up` launch args plus -no-snapshot-load (up itself never cold boots)
- snapshot: Studio: quickboot snapshot saved on the previous exit. crewdroid: `crewdroid up` (default_boot of the base AVD)
- ram: WorkingSet64 (Get-Process), emulator + qemu processes of the instance, taken at the end of the 60 s idle window
- cpu: cumulative CPU seconds of those processes over 60 s idle, 100 % = 1 core
- calls: median of 10 calls per rep, then median of the 3 reps. Studio and crewdroid-stock: adb exec-out uiautomator dump /dev/tty and screencap -p. crewdroid: wall time of 'crewdroid screen|shot' as installed (node bin/crewdroid.mjs, a new node process per call), of the MCP screen/shot tools on the running server, and in-process
- disk: bytes actually allocated (NTFS compression and sparse holes excluded) of the AVD dir + its system image dir
