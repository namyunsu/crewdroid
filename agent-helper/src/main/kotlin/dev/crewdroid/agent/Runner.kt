package dev.crewdroid.agent

import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Instrumentation
import android.app.UiAutomation
import android.graphics.Point
import android.graphics.Rect
import android.graphics.RectF
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
// Answers small HTTP requests on 127.0.0.1:<p>, one at a time, until killed; holds UiAutomation only while serving one.
class Runner : Instrumentation() {
    private var port = 6790
    private var serial = ""
    private var idleMs = 0 // > 0: keep UiAutomation that long after a request (faster bursts, blocks other tools meanwhile)
    private var conn: UiAutomation? = null
    private var exitNow = false

    class Busy(message: String) : Exception(message)

    override fun onCreate(arguments: Bundle?) {
        super.onCreate(arguments)
        port = arguments?.getString("port")?.toIntOrNull() ?: port
        serial = arguments?.getString("serial") ?: ""
        idleMs = arguments?.getString("idleMs")?.toIntOrNull() ?: idleMs
        start() // onStart() on the instrumentation thread; the main looper stays free for UiAutomation's callbacks
    }

    // AI NOTE: no UiAutomation at start (T66): `up` starts the helper in the background, and a connection taken then blocked
    // mobile-mcp's `uiautomator dump` right after `up`. With idleMs 0 it is released after every request.
    override fun onStart() {
        ServerSocket(port, 8, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = idleMs
            Log.i(TAG, "listening on 127.0.0.1:$port for $serial")
            while (true) {
                try { server.accept().use { serve(it) }; if (idleMs > 0) continue }
                catch (_: SocketTimeoutException) {}
                catch (e: Exception) { Log.w(TAG, "request failed", e) }
                release()
                if (exitNow) { Log.i(TAG, "exiting after a failed UiAutomation connect; the host starts a fresh helper"); android.os.Process.killProcess(android.os.Process.myPid()) }
            }
        }
    }

    // AI NOTE: Android allows ONE UiAutomation client system-wide; while it is held, `uiautomator dump` (crewdroid's fallback,
    // mobile-mcp) and Maestro's driver die with "UiAutomationService ... already registered" (ADR 0007). So it is taken per
    // request and released right after; while another tool holds it (a Maestro flow holds it for the whole flow) the request
    // gets 503 and the host uses its shell fallback. destroy() is hidden API, hence `am instrument --no-hidden-api-checks`.
    // After a failed connect this process can stay unable to connect ("Already connected", seen when Maestro's driver went
    // away mid-attempt, T66) or even keep a stale registration that blocks the other tools, so it answers 503 and exits;
    // the host's fallback path starts a fresh helper (src/helper.ts orFallback).
    private fun ua(): UiAutomation {
        conn?.let { return it }
        var last: RuntimeException? = null
        repeat(10) { // a `uiautomator dump` holds it for ~1-2 s; Maestro for its whole flow
            try {
                val u = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
                // same view set as `uiautomator dump` (not-important views included) plus resource ids
                u.serviceInfo = u.serviceInfo.apply {
                    flags = flags or AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS
                }
                conn = u
                Log.i(TAG, "UiAutomation taken")
                return u
            } catch (e: RuntimeException) { last = e; forget(); SystemClock.sleep(100) }
        }
        throw Busy("UiAutomation is held by another automation client (a Maestro flow, uiautomator dump, mobile-mcp): ${last?.message}")
    }

    // AI NOTE: a failed connect leaves Instrumentation with a half-connected UiAutomation that getUiAutomation() hands out
    // again (never connected); drop it so the next try builds a fresh one.
    private fun forget() {
        runCatching {
            val f = Instrumentation::class.java.getDeclaredField("mUiAutomation").apply { isAccessible = true }
            (f.get(this) as? UiAutomation)?.let { runCatching { UiAutomation::class.java.getMethod("destroy").invoke(it) } }
            f.set(this, null)
        }.onFailure { Log.w(TAG, "forget failed", it) }
    }

    private fun release() {
        val u = conn ?: return
        conn = null
        try { UiAutomation::class.java.getMethod("destroy").invoke(u); Log.i(TAG, "UiAutomation released") } catch (e: Exception) { Log.w(TAG, "release failed", e) }
    }

    private fun serve(s: Socket) {
        s.soTimeout = 10000
        val inp = s.getInputStream()
        val lines = head(inp).split("\r\n")
        val (method, target) = lines[0].split(" ").let { it[0] to it.getOrElse(1) { "/" } }
        val path = target.substringBefore('?')
        val query = target.substringAfter('?', "").split('&').mapNotNull { kv -> kv.indexOf('=').takeIf { it > 0 }?.let { kv.substring(0, it) to kv.substring(it + 1) } }.toMap()
        val headers = lines.drop(1).mapNotNull { l -> l.indexOf(':').takeIf { it > 0 }?.let { l.substring(0, it).trim().lowercase() to l.substring(it + 1).trim() } }.toMap()
        val len = headers["content-length"]?.toIntOrNull() ?: 0
        val body = ByteArray(len)
        var n = 0
        while (n < len) { val r = inp.read(body, n, len - n); if (r < 0) break; n += r }
        val (code, json) = try {
            // a host port forward can outlive its emulator and get reused for another one: refuse requests meant for another device
            if (headers["x-serial"] != serial) 421 to JSONObject().put("error", "this helper serves $serial, not ${headers["x-serial"]}")
            else route("$method $path", if (len > 0) JSONObject(String(body, Charsets.UTF_8)) else JSONObject(), query)
        } catch (e: Busy) { exitNow = true; 503 to JSONObject().put("error", e.message) }
        catch (e: Exception) { 500 to JSONObject().put("error", e.toString()) }
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

    // settle:true on an action = answer with the screen after it (settled()), so the host needs no further request
    private fun route(r: String, a: JSONObject, q: Map<String, String>): Pair<Int, JSONObject> = when (r) {
        "GET /health" -> 200 to JSONObject().put("ok", true).put("serial", serial).put("api", android.os.Build.VERSION.SDK_INT)
            .put("version", context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode)
        // layout=1 (crewdroid layout, T67): every node, also not visible to the user (hidden:true) and per-character text boxes (chars)
        "GET /tree" -> 200 to tree(q["idle"]?.toLongOrNull() ?: 100, q["layout"] == "1")
        "GET /size" -> 200 to size(JSONObject())
        "POST /tap" -> { tap(a.getDouble("x").toFloat(), a.getDouble("y").toFloat()); 200 to after(a, ok()) }
        "POST /swipe" -> { swipe(a.getDouble("x1").toFloat(), a.getDouble("y1").toFloat(), a.getDouble("x2").toFloat(), a.getDouble("y2").toFloat(), a.optLong("ms", 300)); 200 to after(a, ok()) }
        "POST /key" -> {
            val code = KeyEvent.keyCodeFromString(a.getString("code"))
            if (code == KeyEvent.KEYCODE_UNKNOWN) 400 to JSONObject().put("error", "unknown key ${a.getString("code")}") else { key(code); 200 to after(a, ok()) }
        }
        "POST /text" -> text(a.getString("text"), a.optLong("waitMs", 0), a.optJSONArray("at")).let { (c, j) -> c to if (c == 200) after(a, j) else j }
        else -> 404 to JSONObject().put("error", "no route $r")
    }

    private fun ok() = JSONObject().put("ok", true)

    private fun root(): AccessibilityNodeInfo? {
        repeat(20) { ua().rootInActiveWindow?.let { return it }; SystemClock.sleep(25) }
        return null
    }

    private fun tree(idleMs: Long, layout: Boolean = false): JSONObject {
        // a short quiet period so a screen that is still settling after a tap is read once it has drawn (0 = read now: tap's
        // lookup, which follows a settled screen)
        if (idleMs > 0) try { ua().waitForIdle(idleMs, 1000) } catch (_: Exception) {}
        val root = root()
        val nodes = JSONArray()
        if (root != null) walk(root, 0, nodes, layout)
        return size(JSONObject().put("pkg", root?.packageName?.toString() ?: "")).put("nodes", nodes)
    }

    private fun after(a: JSONObject, o: JSONObject) = if (a.optBoolean("settle")) o.put("tree", settled()) else o

    // AI NOTE (T54): the screen after an action, read inside the same request (one UiAutomation connection; host-side polling
    // cost ~175 ms per read: adb forward, connect, the forced idle wait). Settled = no accessibility event for 150 ms, then the
    // same tree again 50 ms later. An empty tree (old window gone, new one not attached yet: Field Notes' editor sheet) never
    // counts. Cap: 1 s after the first non-empty read, 3 s overall (an endless animation returns its latest frame).
    private fun settled(): JSONObject {
        val t0 = SystemClock.uptimeMillis()
        var first = 0L
        var last = ""
        while (true) {
            try { ua().waitForIdle(150, 1000) } catch (_: Exception) {}
            val t = tree(0)
            val s = t.getJSONArray("nodes").toString()
            val now = SystemClock.uptimeMillis()
            if (t.getJSONArray("nodes").length() > 0) { if (s == last) return t; if (first == 0L) first = now; last = s }
            if ((first > 0 && now - first >= 1000) || now - t0 >= 3000) return t
            SystemClock.sleep(50)
        }
    }

    // display size in the current rotation, `wm size` override included (what `input tap` coordinates refer to)
    private fun size(o: JSONObject): JSONObject {
        val p = Point()
        @Suppress("DEPRECATION") context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY).getRealSize(p)
        return o.put("width", p.x).put("height", p.y)
    }

    // Visible-to-user nodes only (as uiautomator dump); layout-only nodes (no text, desc, id, not clickable/editable/scrollable)
    // are dropped while their children keep their real depth.
    private fun walk(n: AccessibilityNodeInfo, depth: Int, out: JSONArray, layout: Boolean = false) {
        val text = n.text?.toString() ?: ""
        val desc = n.contentDescription?.toString() ?: ""
        val id = n.viewIdResourceName ?: ""
        // layout mode keeps every node, so a node's parent is the nearest earlier node with a smaller depth
        if (layout || text.isNotEmpty() || desc.isNotEmpty() || id.isNotEmpty() || n.isClickable || n.isEditable || n.isScrollable) {
            val b = Rect().also { n.getBoundsInScreen(it) }
            out.put(JSONObject().apply {
                put("cls", n.className?.toString()?.substringAfterLast('.') ?: "")
                put("text", text); put("desc", desc); put("id", id)
                put("bounds", JSONArray(listOf(b.left, b.top, b.right, b.bottom)))
                put("clickable", n.isClickable); put("depth", depth)
                if (n.isEditable) put("editable", true)
                if (n.isScrollable) put("scrollable", true)
                if (n.isCheckable) put("checked", n.isChecked)
                if (n.isFocused) put("focused", true)
                if (!n.isEnabled) put("disabled", true)
                if (layout) {
                    if (!n.isVisibleToUser) put("hidden", true)
                    if (text.isNotEmpty()) chars(n, text.length)?.let { put("chars", it) }
                }
            })
        }
        for (i in 0 until n.childCount) {
            val c = n.getChild(i) ?: continue
            if (layout || c.isVisibleToUser) walk(c, depth + 1, out, layout)
        }
    }

    // Screen box [l,t,r,b] of each of the first 200 characters, null = no visible part (cut off by a parent or the screen).
    // The view draws what it reports: an ellipsized TextView gives the hidden tail zero-width boxes. Views that do not offer
    // the extra (custom drawing, WebView) give no "chars" at all.
    private fun chars(n: AccessibilityNodeInfo, len: Int): JSONArray? {
        val key = AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY
        if (!n.availableExtraData.contains(key)) return null
        val count = minOf(len, 200)
        val args = Bundle().apply {
            putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_START_INDEX, 0)
            putInt(AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_LENGTH, count)
        }
        if (!n.refreshWithExtraData(key, args)) return null
        @Suppress("DEPRECATION") val rs = n.extras.getParcelableArray(key) ?: return null
        return JSONArray().apply { for (r in rs) put(if (r is RectF) JSONArray(listOf(Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom))) else JSONObject.NULL) }
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
    // waitMs > 0 (type --into): the field was just tapped; wait up to that long for input focus to land on it (an editable
    // whose bounds meet `at`, the tapped node), then use whatever editable has focus (as the old fixed 500 ms pause did)
    private fun text(t: String, waitMs: Long, at: JSONArray?): Pair<Int, JSONObject> {
        val want = at?.let { Rect(it.getInt(0), it.getInt(1), it.getInt(2), it.getInt(3)) }
        val until = SystemClock.uptimeMillis() + waitMs
        fun focused() = root()?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }
        var f = focused()
        while (SystemClock.uptimeMillis() < until && (f == null || (want != null && !Rect.intersects(want, Rect().also { r -> f!!.getBoundsInScreen(r) })))) { SystemClock.sleep(25); f = focused() }
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
