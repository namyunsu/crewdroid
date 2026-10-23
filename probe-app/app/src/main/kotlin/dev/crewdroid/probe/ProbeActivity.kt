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

// Plain launch shows the sample app (Sample.kt). Probe checks are driven by: adb shell am start -n dev.crewdroid.probe/.ProbeActivity --es check camera|picker|upload|id [--es url URL] [--es file PATH]
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
            else -> { report(check.uppercase(), "fail unknown check"); finish() }
        }
    }

    // Plain launch (launcher / am start without extras) = the sample app screen; it stays open so the outbox thread keeps running.
    private fun sample() {
        Outbox.init(this)
        window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(android.widget.TextView(this).apply { text = "Crew sample app\noutbox: ${Outbox.size()} pending"; textSize = 20f; setPadding(48, 96, 48, 48) })
    }

    private fun report(name: String, result: String) { Log.i(tag, "$name $result") }

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
