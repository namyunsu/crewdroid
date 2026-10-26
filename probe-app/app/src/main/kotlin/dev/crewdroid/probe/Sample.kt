package dev.crewdroid.probe

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.net.ConnectivityManager
import android.net.Network
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

// Sample app (T09): an offline-first outbox of photos/edits, every trigger is an adb broadcast:
//   am broadcast --include-stopped-packages -n dev.crewdroid.probe/.SampleReceiver -a dev.crewdroid.sample.<ACTION> [extras]
//   PHOTO --es id ID [--ei size N] [--es server URL]   save a photo (N bytes, default 65536) and queue POST /upload
//   EDIT  --es id REC --es value V [--es server URL]    queue PUT /records/REC based on the version last READ
//   READ  [--es server URL]                             GET /export, remember each record's version
//   SYNC                                                retry the outbox now
// server defaults to http://10.0.2.2:5599. Log lines (tag CrewProbe):
//   OUTBOX <n> (process start) | SAVED <id> <key> | RETRY <id> attempt=<n> <reason> | SYNCED <id> <key> http=<code>
//   | CONFLICT <id> base=<v> server=<v> | DROPPED <id> http=<code> | READ ok <n> | READ fail <reason> | CONFIG <w>x<h> (screen size changed)
class SampleReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        Outbox.init(ctx)
        val server = i.getStringExtra("server") ?: "http://10.0.2.2:5599"
        val id = i.getStringExtra("id") ?: ""
        when (val a = i.action?.removePrefix("dev.crewdroid.sample.")) {
            "PHOTO", "EDIT" -> {
                if (id.isEmpty()) { Log.i(Outbox.TAG, "$a fail id required"); return }
                val e = JSONObject().put("kind", a.lowercase()).put("id", id).put("server", server)
                if (a == "PHOTO") Outbox.add(e, ByteArray(i.getIntExtra("size", 65536)) { (it % 251).toByte() })
                else Outbox.add(e.put("value", i.getStringExtra("value") ?: "").put("base", Outbox.version(id)), null)
            }
            "READ" -> { val p = goAsync(); Thread { Outbox.read(server); p.finish() }.start() }
            "SYNC" -> Outbox.kick()
            else -> Log.i(Outbox.TAG, "SAMPLE fail unknown action $a")
        }
    }
}

// Files under filesDir/outbox survive force-stop: <time>-<key>.json (+ .bin photo bytes). One thread drains them in order.
object Outbox {
    const val TAG = "CrewProbe"
    private lateinit var dir: File
    private lateinit var prefs: SharedPreferences
    private lateinit var client: String
    private val lock = java.lang.Object()
    private var kicked = false
    private val attempts = HashMap<String, Int>()

    @Synchronized fun init(ctx: Context) {
        if (::dir.isInitialized) return
        val app = ctx.applicationContext
        dir = File(app.filesDir, "outbox").apply { mkdirs() }
        prefs = app.getSharedPreferences("sample", Context.MODE_PRIVATE)
        client = Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID) ?: "sample"
        Log.i(TAG, "OUTBOX ${pending().size}")
        app.getSystemService(ConnectivityManager::class.java)
            .registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() { override fun onAvailable(n: Network) = kick() })
        // T19: fold/unfold changes the screen size; log it so a check can see the app got the configuration change.
        // The outbox lives in this process (not the activity), so an upload in flight keeps going while the activity is recreated.
        app.registerComponentCallbacks(object : android.content.ComponentCallbacks {
            override fun onConfigurationChanged(c: android.content.res.Configuration) {
                val b = app.getSystemService(android.view.WindowManager::class.java).maximumWindowMetrics.bounds
                Log.i(TAG, "CONFIG ${b.width()}x${b.height()}")
            }
            @Deprecated("unused") override fun onLowMemory() {}
        })
        Thread(::loop, "outbox").start()
    }

    fun size() = pending().size
    // T32: only the default screen (ProbeActivity.sample) reads these; no log line or broadcast changes.
    @Volatile var synced = 0
    @Volatile var conflict = 0
    @Volatile var last = "-"
    fun version(id: String) = prefs.getInt("v:$id", 0)
    private fun pending() = (dir.listFiles { f -> f.name.endsWith(".json") } ?: emptyArray()).sortedBy { it.name }
    private fun bin(f: File) = File(f.path.removeSuffix(".json") + ".bin")

    fun add(e: JSONObject, photo: ByteArray?) {
        val key = UUID.randomUUID().toString()
        e.put("key", key)
        val name = "%013d-%s".format(System.currentTimeMillis(), key)
        photo?.let { File(dir, "$name.bin").writeBytes(it) }
        val tmp = File(dir, "$name.tmp")
        tmp.writeText(e.toString())
        tmp.renameTo(File(dir, "$name.json")) // .json appears last, complete
        Log.i(TAG, "SAVED ${e.getString("id")} $key")
        kick()
    }

    fun kick() = synchronized(lock) { kicked = true; lock.notifyAll() }

    private fun loop() {
        var backoff = 0L
        while (true) {
            val failed = try { drain() } catch (e: Exception) { Log.i(TAG, "OUTBOX error ${e.javaClass.simpleName}: ${e.message}"); true }
            synchronized(lock) {
                backoff = if (!failed) 0 else if (backoff == 0L) 1000 else minOf(backoff * 2, 30000)
                if (!kicked) lock.wait(backoff) // 0 = sleep until the next save or network change
                kicked = false
            }
        }
    }

    // true = stopped on a retryable failure (offline, cut, 5xx); the loop backs off and comes back.
    private fun drain(): Boolean {
        for (f in pending()) {
            val e = JSONObject(f.readText())
            val id = e.getString("id"); val key = e.getString("key")
            val (code, text) = try { send(f, e) } catch (x: Exception) { -1 to "${x.javaClass.simpleName}: ${x.message}" }
            when {
                code in 200..299 -> {
                    if (e.getString("kind") == "edit") prefs.edit().putInt("v:$id", JSONObject(text).getInt("version")).commit()
                    Log.i(TAG, "SYNCED $id $key http=$code"); synced++; last = "synced $id"
                }
                code == 409 -> {
                    Log.i(TAG, "CONFLICT $id base=${e.optInt("base")} server=${runCatching { JSONObject(text).getInt("version") }.getOrDefault(-1)}")
                    conflict++; last = "conflict $id"
                }
                code in 400..499 -> Log.i(TAG, "DROPPED $id http=$code")
                else -> {
                    // AI NOTE: the key was fixed at save time and is resent unchanged on every retry, so a retry after a lost ack
                    // (server stored it, response never arrived) is deduped by the server instead of becoming a second row.
                    val n = (attempts[key] ?: 0) + 1
                    attempts[key] = n
                    Log.i(TAG, "RETRY $id attempt=$n ${if (code < 0) text else "http=$code"}".replace('\n', ' '))
                    return true
                }
            }
            f.delete(); bin(f).delete() // only after the server answered: a crash before this just resends the same key
        }
        return false
    }

    private fun send(f: File, e: JSONObject): Pair<Int, String> {
        val server = e.getString("server"); val id = e.getString("id"); val key = e.getString("key")
        val h = mapOf("x-client-id" to client, "idempotency-key" to key)
        if (e.getString("kind") == "photo") {
            val (type, body) = multipart("$id.jpg", bin(f).readBytes())
            return http("POST", "$server/upload", h + ("Content-Type" to type), body)
        }
        val body = JSONObject().put("version", e.getInt("base")).put("value", e.getString("value")).put("clientId", client)
        return http("PUT", "$server/records/${URLEncoder.encode(id, "UTF-8")}", h + ("Content-Type" to "application/json"), body.toString().toByteArray())
    }

    fun read(server: String) {
        try {
            val (code, text) = http("GET", "$server/export", emptyMap())
            if (code != 200) { Log.i(TAG, "READ fail http=$code"); return }
            val recs = JSONObject(text).getJSONArray("records")
            val ed = prefs.edit()
            for (k in 0 until recs.length()) recs.getJSONObject(k).let { ed.putInt("v:" + it.getString("id"), it.getInt("version")) }
            ed.commit()
            Log.i(TAG, "READ ok ${recs.length()}")
        } catch (e: Exception) { Log.i(TAG, "READ fail ${e.javaClass.simpleName}: ${e.message}".replace('\n', ' ')) }
    }
}

fun multipart(name: String, payload: ByteArray): Pair<String, ByteArray> {
    val boundary = "----crew${System.nanoTime()}"
    val head = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$name\"\r\nContent-Type: image/jpeg\r\n\r\n".toByteArray()
    return "multipart/form-data; boundary=$boundary" to head + payload + "\r\n--$boundary--\r\n".toByteArray()
}

// (status, body); throws when the connection fails or stalls.
fun http(method: String, url: String, headers: Map<String, String>, body: ByteArray? = null): Pair<Int, String> {
    val c = URL(url).openConnection() as HttpURLConnection
    c.requestMethod = method; c.connectTimeout = 10000; c.readTimeout = 20000 + maxOf(0, (body?.size ?: 0) - 1048576) / 12
    headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
    // AI NOTE: a stalled socket (net nodata mid-transfer) never errors by itself and HttpURLConnection has no write timeout,
    // so a watchdog drops the connection when no write returned for 10 s + 1 s per 64 KB of body. write() returns once bytes fit the kernel
    // send buffer (~1.4 MB on API 36) and then wakes in bursts; at net slow the peer's small receive window gives ~230 kbit/s, so a 2 MB body
    // stalls ~25 s between wakes and a flat 10 s killed every attempt (ADR 0006).
    // After the last write the buffered tail (up to ~50 s) still drains while we wait for the response: the watchdog stops and readTimeout
    // (20 s, plus 1 s per 12 KB of body beyond 1 MB so a 1 MB body keeps its 20 s) guards that wait.
    val idleMs = 10000L + (body?.size ?: 0) / 64
    val last = AtomicLong(System.currentTimeMillis())
    val done = AtomicBoolean(false)
    Thread { while (!done.get()) { Thread.sleep(1000); if (System.currentTimeMillis() - last.get() > idleMs) { c.disconnect(); break } } }.start()
    try {
        if (body != null) {
            c.doOutput = true
            c.setFixedLengthStreamingMode(body.size)
            c.outputStream.use { o ->
                var i = 0
                while (i < body.size) { val n = minOf(16384, body.size - i); o.write(body, i, n); i += n; last.set(System.currentTimeMillis()) }
            }
            done.set(true)
        }
        last.set(System.currentTimeMillis())
        val code = c.responseCode
        val text = (if (code >= 400) c.errorStream else c.inputStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        return code to text
    } finally { done.set(true); c.disconnect() }
}
