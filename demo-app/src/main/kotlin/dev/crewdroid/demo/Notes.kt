package dev.crewdroid.demo

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

data class Note(val id: String, val title: String, val site: String, val at: Long, val synced: Boolean)

// Offline-first store, same outbox idea as the probe (probe-app Sample.kt): a note is saved locally first, then
// PUT /records/<id> (version 0, idempotency-key = id) to the sample server until it answers. GET /export pulls the
// other devices' notes. Log tag FieldNotes: SAVED <id> | SYNCED <id> http=<code> | RETRY <id> <reason> | PULLED <n>
object Notes {
    const val TAG = "FieldNotes"
    private lateinit var file: File
    private lateinit var client: String
    private val io = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    var server = "http://10.0.2.2:5599"
    @Volatile var online = true
        private set
    @Volatile var all: List<Note> = emptyList()
        private set
    var listener: (() -> Unit)? = null

    fun init(ctx: Context) {
        if (::file.isInitialized) return
        val app = ctx.applicationContext
        file = File(app.filesDir, "notes.json")
        client = Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID) ?: "demo"
        all = if (file.exists()) load() else seed()
        val cm = app.getSystemService(ConnectivityManager::class.java)
        online = cm.activeNetwork != null
        cm.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(n: Network) { online = true; changed(); sync() }
            override fun onLost(n: Network) { online = false; changed() }
        })
    }

    val pending get() = all.count { !it.synced }

    fun add(title: String, site: String) {
        val n = Note(UUID.randomUUID().toString(), title, site, System.currentTimeMillis(), false)
        all = listOf(n) + all
        save()
        Log.i(TAG, "SAVED ${n.id}")
        changed()
        sync()
    }

    // Sends every pending note in order; stops at the first retryable failure (the next sync, refresh or network change retries).
    fun sync() = io.execute {
        for (n in all.filter { !it.synced }.reversed()) {
            val body = JSONObject().put("version", 0).put("clientId", client)
                .put("value", JSONObject().put("title", n.title).put("site", n.site).put("at", n.at))
            val code = try { http("PUT", "$server/records/${n.id}", body.toString()).first } catch (e: Exception) {
                Log.i(TAG, "RETRY ${n.id} ${e.javaClass.simpleName}"); return@execute
            }
            if (code >= 500) { Log.i(TAG, "RETRY ${n.id} http=$code"); return@execute }
            // 2xx = stored (a replay of the same key also answers 200); 409 = the record already exists, i.e. stored earlier.
            main.post { all = all.map { if (it.id == n.id) it.copy(synced = true) else it }; save(); changed() }
            Log.i(TAG, "SYNCED ${n.id} http=$code")
        }
    }

    // Pulls notes saved on other devices; done() runs on the main thread either way.
    fun refresh(done: () -> Unit = {}) = io.execute {
        val got = try {
            val (code, text) = http("GET", "$server/export", null)
            if (code == 200) JSONObject(text).getJSONArray("records") else null
        } catch (e: Exception) { null }
        main.post {
            if (got != null) {
                val have = all.map { it.id }.toSet()
                val new = (0 until got.length()).map { got.getJSONObject(it) }.filter { it.getString("id") !in have }.mapNotNull { r ->
                    val v = r.optJSONObject("value") ?: return@mapNotNull null
                    Note(r.getString("id"), v.optString("title"), v.optString("site"), v.optLong("at"), true)
                }
                if (new.isNotEmpty()) {
                    all = (all + new).sortedByDescending { it.at }
                    save()
                    Log.i(TAG, "PULLED ${new.size}")
                    changed()
                }
            }
            done()
        }
        sync()
    }

    private fun changed() = main.post { listener?.invoke() }

    private fun save() {
        val a = JSONArray()
        all.forEach { a.put(JSONObject().put("id", it.id).put("title", it.title).put("site", it.site).put("at", it.at).put("synced", it.synced)) }
        File(file.path + ".tmp").apply { writeText(a.toString()) }.renameTo(file)
    }

    private fun load(): List<Note> {
        val a = JSONArray(file.readText())
        return (0 until a.length()).map { a.getJSONObject(it) }.map {
            Note(it.getString("id"), it.getString("title"), it.getString("site"), it.getLong("at"), it.getBoolean("synced"))
        }
    }

    // First launch: a realistic morning's worth of notes, already synced (same ids on every device).
    private fun seed(): List<Note> {
        val now = System.currentTimeMillis()
        val m = 60_000L
        return listOf(
            Note("seed-1", "Replace filter on intake line", "North field", now - 38 * m, true),
            Note("seed-2", "Pressure gauge on valve 7 reads low", "Pump house", now - 115 * m, true),
            Note("seed-3", "Cracked floor tile by loading dock", "Warehouse", now - 190 * m, true),
            Note("seed-4", "Order 2 m of 25 mm hose", "Workshop", now - 290 * m, true),
            Note("seed-5", "Calibrate soil sensor S-12", "North field", now - 26 * 60 * m, true),
            Note("seed-6", "Restock first-aid kit in van 2", "Workshop", now - 29 * 60 * m, true),
            Note("seed-7", "Forklift battery at 20 %", "Warehouse", now - 31 * 60 * m, true),
            Note("seed-8", "Fence post down near gate B", "North field", now - 33 * 60 * m, true),
        ).also { all = it; save() }
    }

    private fun http(method: String, url: String, body: String?): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 5000; c.readTimeout = 8000
        c.setRequestProperty("x-client-id", client)
        try {
            if (body != null) {
                val b = body.toByteArray()
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.setRequestProperty("idempotency-key", url.substringAfterLast('/'))
                c.setFixedLengthStreamingMode(b.size)
                c.outputStream.use { it.write(b) }
            }
            val code = c.responseCode
            val text = (if (code >= 400) c.errorStream else c.inputStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            return code to text
        } finally { c.disconnect() }
    }
}
