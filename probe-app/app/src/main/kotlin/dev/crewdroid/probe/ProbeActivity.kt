package dev.crewdroid.probe

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.ImageFormat
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.media.ImageReader
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.provider.MediaStore
import android.util.Log
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

// Plain launch shows the sample app (Sample.kt). Probe checks are driven by: adb shell am start -n dev.crewdroid.probe/.ProbeActivity --es check camera|picker|upload|id|crash|anr|jank|surface|env [--es url URL] [--es file PATH]
// upload extras: --ei size N (N zero-ish bytes instead of a file), --es key IDEMPOTENCY_KEY, --es client X_CLIENT_ID
// Each check logs exactly one result line to logcat tag CrewProbe: "<CHECK> ok|fail <detail>".
class ProbeActivity : Activity() {
    private val tag = "CrewProbe"
    private val bg = HandlerThread("probe").also { it.start() }
    private val handler = Handler(bg.looper)
    private val cameraJpeg get() = File(cacheDir, "camera.jpg")
    private var pickerName = ""

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        intent.data?.let { report("LINK", it.toString()) } // T21: deep link / App Link opened by `crewdroid app open`
        val check = intent.getStringExtra("check") ?: return sample()
        when (check) {
            "camera" -> Thread { report("CAMERA", camera()); runOnUiThread { finish() } }.start()
            "picker" -> picker()
            "id" -> { report("ID", "ok " + android.provider.Settings.Secure.getString(contentResolver, android.provider.Settings.Secure.ANDROID_ID)); finish() }
            "upload" -> Thread {
                val t0 = System.currentTimeMillis()
                val r = upload(intent.getStringExtra("url") ?: "http://10.0.2.2:5599/upload", intent.getStringExtra("file"), intent.getIntExtra("size", 0), intent.getStringExtra("key"), intent.getStringExtra("client"))
                val ms = System.currentTimeMillis() - t0
                report("UPLOAD", "$r ms=$ms")
                // timing broadcast (T05): same result for anything that wants it without parsing logcat
                sendBroadcast(Intent("dev.crewdroid.probe.UPLOAD").setPackage(packageName).putExtra("ok", r.startsWith("ok")).putExtra("ms", ms))
                runOnUiThread { finish() }
            }.start()
            // T22 triage/perf targets. crash: posted so the trace is not wrapped in "Unable to start activity" (top frame = ProbeActivity).
            "crash" -> { report("CRASH", "throwing"); window.decorView.post { throw IllegalStateException("crewdroid probe crash (check=crash)") } }
            // anr: the first tap on the button blocks the main thread 10 s; further taps time out input dispatch (5 s) -> ANR.
            "anr" -> setContentView(android.widget.Button(this).apply {
                text = "Probe button"; contentDescription = "probe-button"
                setOnClickListener { report("ANR", "blocking main thread 10 s"); Thread.sleep(10_000); report("ANR", "unblocked") }
            })
            // jank: every frame spends ~50 ms in onDraw (3 missed vsyncs at 60 Hz) and asks for the next one.
            "jank" -> setContentView(object : android.view.View(this) {
                override fun onDraw(c: android.graphics.Canvas) {
                    val t = System.nanoTime()
                    while (System.nanoTime() - t < 50_000_000L) { }
                    c.drawColor(if ((t / 50_000_000L) % 2 == 0L) android.graphics.Color.RED else android.graphics.Color.BLUE)
                    invalidate()
                }
            })
            // surface (T28): a SurfaceView filled green with a moving white square; logs its on-screen bounds once laid out:
            // "SURFACE <l>,<t>,<r>,<b>". Extras: see surface().
            "surface" -> surface()
            // env (T20): "ENV dark=<bool> font=<scale> rot=<n> battery=<pct> loc=<lat>,<lon>|none"; loc needs ACCESS_FINE_LOCATION (pm grant), else none.
            "env" -> android.os.Handler(mainLooper).postDelayed({ env() }, 1000) // AI NOTE: the display rotation only follows user_rotation once an activity is on top, so read it after a beat; a rotation change recreates the activity and logs a second (correct) line
            else -> { report(check.uppercase(), "fail unknown check"); finish() }
        }
    }

    // Plain launch (launcher / am start without extras) = the sample app screen; it stays open so the outbox thread keeps running.
    private fun sample() {
        Outbox.init(this)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(android.widget.TextView(this).apply { text = "Crew sample app\noutbox: ${Outbox.size()} pending"; textSize = 20f; setPadding(48, 96, 48, 48) })
    }

    private fun env() {
        fun head(): String {
            val c = resources.configuration
            val b = registerReceiver(null, android.content.IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val pct = (b?.getIntExtra("level", -1) ?: -1) * 100 / (b?.getIntExtra("scale", 100) ?: 100)
            return "dark=${(c.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES} font=${c.fontScale} rot=${display?.rotation} battery=$pct"
        }
        val lm = getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
        val done = java.util.concurrent.atomic.AtomicBoolean(false)
        var listener: android.location.LocationListener? = null
        fun fin(l: android.location.Location?) {
            if (!done.compareAndSet(false, true)) return
            listener?.let { lm.removeUpdates(it) }
            report("ENV", "${head()} loc=" + (l?.let { String.format(java.util.Locale.US, "%.5f,%.5f", it.latitude, it.longitude) } ?: "none"))
            finish()
        }
        if (checkSelfPermission(android.Manifest.permission.ACCESS_FINE_LOCATION) != android.content.pm.PackageManager.PERMISSION_GRANTED) return fin(null)
        // AI NOTE: the emulator GNSS only reports a `geo fix` to an active requester (dumpsys location stays last location=null otherwise).
        // getCurrentLocation() answers from Android's cache for ~30 s, so a newer fix would be missed; a fresh updates request gets the current one.
        val l = android.location.LocationListener { fin(it) }.also { listener = it }
        lm.requestLocationUpdates(android.location.LocationManager.GPS_PROVIDER, 0L, 0f, l, mainLooper)
        android.os.Handler(mainLooper).postDelayed({ fin(null) }, 8000)
    }

    // T21: `crewdroid app trim` is confirmed by this line ("TRIM 80" = TRIM_MEMORY_COMPLETE)
    override fun onTrimMemory(level: Int) { super.onTrimMemory(level); report("TRIM", level.toString()) }

    private fun report(name: String, result: String) { Log.i(tag, "$name $result") }

    // --es mode canvas (lockCanvas, CPU) | gl (GLSurfaceView, GLES2 clear + scissor); --ez pip true adds a second small
    // SurfaceView with setZOrderMediaOverlay (the private-app call screen layout). SURFACE bounds are the main view's.
    private fun surface() {
        val gl = intent.getStringExtra("mode") == "gl"
        val sv = if (gl) android.opengl.GLSurfaceView(this).apply {
            setEGLContextClientVersion(2)
            setRenderer(object : android.opengl.GLSurfaceView.Renderer {
                var w = 1; var h = 1; var x = 0
                override fun onSurfaceCreated(u: javax.microedition.khronos.opengles.GL10?, c: javax.microedition.khronos.egl.EGLConfig?) {}
                override fun onSurfaceChanged(u: javax.microedition.khronos.opengles.GL10?, ww: Int, hh: Int) { w = ww; h = hh }
                override fun onDrawFrame(u: javax.microedition.khronos.opengles.GL10?) {
                    android.opengl.GLES20.glDisable(android.opengl.GLES20.GL_SCISSOR_TEST)
                    android.opengl.GLES20.glClearColor(0f, 0.63f, 0.31f, 1f)
                    android.opengl.GLES20.glClear(android.opengl.GLES20.GL_COLOR_BUFFER_BIT)
                    val s = w / 4
                    android.opengl.GLES20.glEnable(android.opengl.GLES20.GL_SCISSOR_TEST)
                    android.opengl.GLES20.glScissor(x, h / 2 - s / 2, s, s)
                    android.opengl.GLES20.glClearColor(1f, 1f, 1f, 1f)
                    android.opengl.GLES20.glClear(android.opengl.GLES20.GL_COLOR_BUFFER_BIT)
                    x = (x + 8) % (w - s)
                }
            })
        } else android.view.SurfaceView(this).also { canvasLoop(it, android.graphics.Color.rgb(0, 160, 80)) }
        sv.holder.addCallback(object : android.view.SurfaceHolder.Callback {
            override fun surfaceCreated(h: android.view.SurfaceHolder) {
                val xy = IntArray(2).also { sv.getLocationOnScreen(it) }
                report("SURFACE", "${xy[0]},${xy[1]},${xy[0] + sv.width},${xy[1] + sv.height}")
            }
            override fun surfaceChanged(h: android.view.SurfaceHolder, f: Int, w: Int, hh: Int) {}
            override fun surfaceDestroyed(h: android.view.SurfaceHolder) {}
        })
        if (!intent.getBooleanExtra("pip", false)) return setContentView(sv)
        val pip = android.view.SurfaceView(this).also { it.setZOrderMediaOverlay(true); canvasLoop(it, android.graphics.Color.BLUE) }
        setContentView(android.widget.FrameLayout(this).apply {
            addView(sv)
            addView(pip, android.widget.FrameLayout.LayoutParams(300, 400, android.view.Gravity.TOP or android.view.Gravity.END))
        })
    }

    // fills a SurfaceView with bg and a moving white square via lockCanvas until the surface goes away
    private fun canvasLoop(sv: android.view.SurfaceView, bg: Int) {
        val running = java.util.concurrent.atomic.AtomicBoolean(true)
        sv.holder.addCallback(object : android.view.SurfaceHolder.Callback {
            override fun surfaceCreated(h: android.view.SurfaceHolder) {
                Thread {
                    val p = android.graphics.Paint().apply { color = android.graphics.Color.WHITE }
                    var x = 0f
                    while (running.get()) {
                        val c = try { h.lockCanvas() } catch (e: Exception) { null } ?: break
                        c.drawColor(bg)
                        val s = c.width / 4f
                        c.drawRect(x, c.height / 2f - s / 2, x + s, c.height / 2f + s / 2, p)
                        h.unlockCanvasAndPost(c)
                        x = (x + 8) % (c.width - s)
                        Thread.sleep(33)
                    }
                }.start()
            }
            override fun surfaceChanged(h: android.view.SurfaceHolder, f: Int, w: Int, hh: Int) {}
            override fun surfaceDestroyed(h: android.view.SurfaceHolder) { running.set(false) }
        })
    }

    private fun camera(): String {
        val mgr = getSystemService(Context.CAMERA_SERVICE) as CameraManager
        val id = mgr.cameraIdList.firstOrNull { mgr.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == CameraCharacteristics.LENS_FACING_BACK }
            ?: return "fail no back camera (ids=${mgr.cameraIdList.toList()})"
        val reader = ImageReader.newInstance(640, 480, ImageFormat.JPEG, 1)
        val done = CountDownLatch(1)
        var result = "fail timeout"
        reader.setOnImageAvailableListener({ r ->
            r.acquireLatestImage()?.use { img ->
                val buf = img.planes[0].buffer
                val bytes = ByteArray(buf.remaining()).also { buf.get(it) }
                cameraJpeg.writeBytes(bytes)
                result = "ok ${bytes.size} bytes"
            }
            done.countDown()
        }, handler)
        var cam: CameraDevice? = null
        try {
            val opened = CountDownLatch(1)
            var openErr: String? = null
            mgr.openCamera(id, object : CameraDevice.StateCallback() {
                override fun onOpened(c: CameraDevice) { cam = c; opened.countDown() }
                override fun onDisconnected(c: CameraDevice) { openErr = "disconnected"; c.close(); opened.countDown() }
                override fun onError(c: CameraDevice, e: Int) { openErr = "open error $e"; c.close(); opened.countDown() }
            }, handler)
            if (!opened.await(15, TimeUnit.SECONDS)) return "fail open timeout"
            val c = cam ?: return "fail ${openErr ?: "open failed"}"
            val sessionReady = CountDownLatch(1)
            var session: CameraCaptureSession? = null
            @Suppress("DEPRECATION")
            c.createCaptureSession(listOf(reader.surface), object : CameraCaptureSession.StateCallback() {
                override fun onConfigured(s: CameraCaptureSession) { session = s; sessionReady.countDown() }
                override fun onConfigureFailed(s: CameraCaptureSession) { result = "fail session configure failed"; done.countDown(); sessionReady.countDown() }
            }, handler)
            if (!sessionReady.await(15, TimeUnit.SECONDS)) return "fail session timeout"
            val s = session ?: return result
            s.capture(c.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply { addTarget(reader.surface) }.build(), null, handler)
            done.await(20, TimeUnit.SECONDS)
            return result
        } catch (e: Exception) {
            return "fail ${e.javaClass.simpleName}: ${e.message}".replace('\n', ' ')
        } finally {
            cam?.close()
            reader.close()
        }
    }

    // AI NOTE: ACTION_PICK_IMAGES needs the MediaProvider picker; some images ship only GET_CONTENT (DocumentsUI) or neither. We try both and report which resolved.
    private fun picker() {
        val pick = Intent(MediaStore.ACTION_PICK_IMAGES)
        val get = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
        val which = when {
            pick.resolveActivity(packageManager) != null -> "PICK_IMAGES" to pick
            get.resolveActivity(packageManager) != null -> "GET_CONTENT" to get
            else -> { report("PICKER", "fail neither ACTION_PICK_IMAGES nor ACTION_GET_CONTENT resolves"); finish(); return }
        }
        pickerName = which.first
        Log.i(tag, "picker intent resolved: $pickerName")
        @Suppress("DEPRECATION")
        startActivityForResult(which.second, 7)
    }

    @Deprecated("probe only")
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        super.onActivityResult(req, res, data)
        val uri = data?.data
        if (res == RESULT_OK && uri != null) {
            val n = try { contentResolver.openInputStream(uri)?.use { it.readBytes().size } } catch (e: Exception) { -1 }
            report("PICKER", if ((n ?: -1) > 0) "ok $pickerName $uri $n bytes" else "fail $pickerName could not read $uri")
        } else report("PICKER", "fail $pickerName resultCode=$res")
        finish()
    }

    private fun upload(url: String, path: String?, size: Int, key: String?, client: String?): String {
        val file = path?.let { File(it) } ?: cameraJpeg
        val payload = if (size > 0) ByteArray(size) { (it % 251).toByte() } else if (file.exists()) file.readBytes() else ByteArray(4096) { (it % 251).toByte() }
        return try {
            val (type, body) = multipart(file.name, payload)
            // sample server (sample/server/app.ts) requires both headers
            val (code, _) = http("POST", url, mapOf(
                "x-client-id" to (client ?: android.provider.Settings.Secure.getString(contentResolver, android.provider.Settings.Secure.ANDROID_ID) ?: "probe"),
                "idempotency-key" to (key ?: java.util.UUID.randomUUID().toString()),
                "Content-Type" to type), body)
            if (code in 200..299) "ok ${payload.size}" else "fail http $code"
        } catch (e: Exception) { "fail ${e.javaClass.simpleName}: ${e.message}".replace('\n', ' ') }
    }
}
