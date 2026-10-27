package dev.crewdroid.agent

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Instrumentation
import android.app.UiAutomation
import android.graphics.Point
import android.graphics.Rect
import android.hardware.display.DisplayManager
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.view.Display
import android.view.InputDevice
import android.view.KeyCharacterMap
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException

// Started by the host with `am instrument -w -e port <p> -e serial <emulator-N> dev.crewdroid.agent/.Runner` (src/helper.ts).
// Keeps one UiAutomation connection and answers small HTTP requests on 127.0.0.1:<p>, one at a time, until killed.
class Runner : Instrumentation() {
    private var port = 6790
    private var serial = ""
    private var idleMs = 3000
    private var conn: UiAutomation? = null

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        port = arguments?.getString("port")?.toIntOrNull() ?: port
        serial = arguments?.getString("serial") ?: ""
        idleMs = arguments?.getString("idleMs")?.toIntOrNull() ?: idleMs
        start() // onStart() on the instrumentation thread; the main looper stays free for UiAutomation's callbacks
    }

    override fun onStart() {
        runCatching { ua() } // warm up; a failure here is retried on the first request
        ServerSocket(port, 8, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = idleMs
            Log.i(TAG, "listening on 127.0.0.1:$port for $serial")
            while (true) {
                try { server.accept().use { serve(it) } }
                catch (_: SocketTimeoutException) { release() }
                catch (e: Exception) { Log.w(TAG, "request failed", e) }
            }
        }
    }

    // AI NOTE: Android allows ONE UiAutomation client system-wide; while it is held, `uiautomator dump` (crewdroid's fallback,
    // mobile-mcp) and Maestro's driver die with "UiAutomationService ... already registered". So the connection is dropped
    // after idleMs without a request and taken again on the next one (ADR 0007). destroy() is hidden API, hence
    // `am instrument --no-hidden-api-checks`; after it Instrumentation.getUiAutomation() builds and connects a fresh one.
    private fun ua(): UiAutomation {
        conn?.let { return it }
        var last: RuntimeException? = null
        repeat(40) { // another client (a running dump) may hold it for ~1-2 s
            try {
                val u = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
                // same view set as `uiautomator dump` (not-important views included) plus resource ids
                u.serviceInfo = u.serviceInfo.apply {
                    flags = flags or AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                }
                conn = u
                return u
            } catch (e: RuntimeException) { last = e; SystemClock.sleep(50) }
        }
        throw IllegalStateException("UiAutomation is held by another tool (uiautomator dump, Maestro?): $last")
    }

    private fun release() {
        val u = conn ?: return
        conn = null
        try { UiAutomation::class.java.getMethod("destroy").invoke(u) } catch (e: Exception) { Log.w(TAG, "release failed", e) }
    }

    private fun serve(s: Socket) {
        s.soTimeout = 10000
        val inp = s.getInputStream()
        val lines = head(inp).split("\r\n")
        val (method, path) = lines[0].split(" ").let { it[0] to it.getOrElse(1) { "/" } }
        val headers = lines.drop(1).mapNotNull { l -> l.indexOf(':').takeIf { it > 0 }?.let { l.substring(0, it).trim().lowercase() to l.substring(it + 1).trim() } }.toMap()
        val len = headers["content-length"]?.toIntOrNull() ?: 0
        val body = ByteArray(len)
        var n = 0
        while (n < len) { val r = inp.read(body, n, len - n); if (r < 0) break; n += r }
        val (code, json) = try {
            // a host port forward can outlive its emulator and get reused for another one: refuse requests meant for another device
            if (headers["x-serial"] != serial) 421 to JSONObject().put("error", "this helper serves $serial, not ${headers["x-serial"]}")
            else route("$method $path", if (len > 0) JSONObject(String(body, Charsets.UTF_8)) else JSONObject())
        } catch (e: Exception) { 500 to JSONObject().put("error", e.toString()) }
        val b = json.toString().toByteArray(Charsets.UTF_8)
        s.getOutputStream().apply {
            write("HTTP/1.1 $code X\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${b.size}\r\nConnection: close\r\n\r\n".toByteArray())
            write(b)
            flush()
        }
    }

    private fun head(inp: InputStream): String {
        val sb = StringBuilder()
        while (!sb.endsWith("\r\n\r\n")) { val c = inp.read(); if (c < 0) break; sb.append(c.toChar()) }
        return sb.trim().toString()
    }

    private fun route(r: String, a: JSONObject): Pair<Int, JSONObject> = when (r) {
        "GET /health" -> 200 to JSONObject().put("ok", true).put("serial", serial).put("api", android.os.Build.VERSION.SDK_INT)
            .put("version", context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode)
        "GET /tree" -> 200 to tree()
        "GET /size" -> 200 to size(JSONObject())
        "POST /tap" -> { tap(a.getDouble("x").toFloat(), a.getDouble("y").toFloat()); 200 to ok() }
        "POST /swipe" -> { swipe(a.getDouble("x1").toFloat(), a.getDouble("y1").toFloat(), a.getDouble("x2").toFloat(), a.getDouble("y2").toFloat(), a.optLong("ms", 300)); 200 to ok() }
        "POST /key" -> {
            val code = KeyEvent.keyCodeFromString(a.getString("code"))
            if (code == KeyEvent.KEYCODE_UNKNOWN) 400 to JSONObject().put("error", "unknown key ${a.getString("code")}") else { key(code); 200 to ok() }
        }
        "POST /text" -> text(a.getString("text"))
        else -> 404 to JSONObject().put("error", "no route $r")
    }

    private fun ok() = JSONObject().put("ok", true)

    private fun root(): AccessibilityNodeInfo? {
        repeat(20) { ua().rootInActiveWindow?.let { return it }; SystemClock.sleep(25) }
        return null
    }

    private fun tree(): JSONObject {
        // a short quiet period so a screen that is still settling after a tap is read once it has drawn
        try { ua().waitForIdle(100, 1000) } catch (_: Exception) {}
        val root = root()
        val nodes = JSONArray()
        if (root != null) walk(root, 0, nodes)
        return size(JSONObject().put("pkg", root?.packageName?.toString() ?: "")).put("nodes", nodes)
    }

    // display size in the current rotation, `wm size` override included (what `input tap` coordinates refer to)
    private fun size(o: JSONObject): JSONObject {
        val p = Point()
        @Suppress("DEPRECATION") context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY).getRealSize(p)
        return o.put("width", p.x).put("height", p.y)
    }

    // Visible-to-user nodes only (as uiautomator dump); layout-only nodes (no text, desc, id, not clickable/editable/scrollable)
    // are dropped while their children keep their real depth.
    private fun walk(n: AccessibilityNodeInfo, depth: Int, out: JSONArray) {
        val text = n.text?.toString() ?: ""
        val desc = n.contentDescription?.toString() ?: ""
        val id = n.viewIdResourceName ?: ""
        if (text.isNotEmpty() || desc.isNotEmpty() || id.isNotEmpty() || n.isClickable || n.isEditable || n.isScrollable) {
            val b = Rect().also { n.getBoundsInScreen(it) }
            out.put(JSONObject().apply {
                put("cls", n.className?.toString()?.substringAfterLast('.') ?: "")
                put("text", text); put("desc", desc); put("id", id)
                put("bounds", JSONArray(listOf(b.left, b.top, b.right, b.bottom)))
                put("clickable", n.isClickable); put("depth", depth)
                if (n.isEditable) put("editable", true)
                if (n.isScrollable) put("scrollable", true)
                if (n.isCheckable) put("checked", n.isChecked)
            })
        }
        for (i in 0 until n.childCount) {
            val c = n.getChild(i) ?: continue
            if (c.isVisibleToUser) walk(c, depth + 1, out)
        }
    }

    private fun touch(action: Int, down: Long, x: Float, y: Float) {
        val e = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0)
        e.source = InputDevice.SOURCE_TOUCHSCREEN
        ua().injectInputEvent(e, true)
        e.recycle()
    }

    private fun tap(x: Float, y: Float) {
        val t = SystemClock.uptimeMillis()
        touch(MotionEvent.ACTION_DOWN, t, x, y)
        touch(MotionEvent.ACTION_UP, t, x, y)
    }

    // like `input swipe`: moves interpolated over ms, then up at the end point
    private fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long) {
        val t = SystemClock.uptimeMillis()
        touch(MotionEvent.ACTION_DOWN, t, x1, y1)
        var now = SystemClock.uptimeMillis()
        while (now < t + ms) {
            val f = (now - t).toFloat() / ms
            touch(MotionEvent.ACTION_MOVE, t, x1 + (x2 - x1) * f, y1 + (y2 - y1) * f)
            SystemClock.sleep(8)
            now = SystemClock.uptimeMillis()
        }
        touch(MotionEvent.ACTION_UP, t, x2, y2)
    }

    private fun key(code: Int) {
        val t = SystemClock.uptimeMillis()
        for (action in listOf(KeyEvent.ACTION_DOWN, KeyEvent.ACTION_UP)) {
            ua().injectInputEvent(KeyEvent(t, SystemClock.uptimeMillis(), action, code, 0, 0, KeyCharacterMap.VIRTUAL_KEYBOARD, 0, 0, InputDevice.SOURCE_KEYBOARD), true)
        }
    }

    // ACTION_SET_TEXT replaces the field's text, so the new text is appended to what is there (as typing at the end would)
    // and the cursor is moved to the end. Any Unicode works: no key map involved.
    // ponytail: a password field's text reads back masked, so appending to one corrupts it; set an empty field first.
    private fun text(t: String): Pair<Int, JSONObject> {
        val f = root()?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        if (f == null || !f.isEditable) return 409 to JSONObject().put("error", "no focused editable field (tap the field first)")
        val v = (if (f.isShowingHintText) "" else f.text?.toString() ?: "") + t
        val set = f.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, v) })
        if (!set) return 409 to JSONObject().put("error", "the focused field refused ACTION_SET_TEXT")
        f.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, v.length)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, v.length)
        })
        return 200 to ok().put("id", f.viewIdResourceName ?: "")
    }

    companion object { const val TAG = "CrewAgent" }
}
