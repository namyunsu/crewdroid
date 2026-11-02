package dev.crewdroid.daeri

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

data class Call(val id: String, val from: String, val to: String, val fare: Int, val version: Int)

class MainActivity : Activity() {
    private val server = "http://10.0.2.2:5599"
    private val main = Handler(Looper.getMainLooper())
    private val reads = Executors.newSingleThreadExecutor()
    private val writes = Executors.newSingleThreadExecutor()
    private var name = ""
    private var driverId = ""
    private var calls = emptyList<Call>()
    private var trip: Call? = null
    private var busy = false
    private var earned = 0
    private var notice = ""
    private lateinit var root: LinearLayout
    private val poll = object : Runnable { override fun run() { if (name.isNotEmpty() && trip == null) fetch(); main.postDelayed(this, 2000) } }

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val p = getSharedPreferences("d", MODE_PRIVATE)
        driverId = p.getString("id", null) ?: UUID.randomUUID().toString().take(8).also { p.edit().putString("id", it).apply() }
        name = p.getString("name", "") ?: ""
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(32, 72, 32, 32); setBackgroundColor(Color.WHITE) }
        setContentView(root)
        render()
    }
    override fun onResume() { super.onResume(); main.post(poll) }
    override fun onPause() { super.onPause(); main.removeCallbacks(poll) }

    private fun render() {
        root.removeAllViews()
        if (name.isEmpty()) return renderLogin()
        root.addView(text("대리콜 · $name", 24f))
        root.addView(text("오늘 수입 ${"%,d".format(earned)}원", 18f))
        if (notice.isNotEmpty()) root.addView(text(notice, 16f).apply { setTextColor(Color.RED) })
        val t = trip
        if (t != null) {
            root.addView(text("운행중", 22f))
            root.addView(text("${t.from} → ${t.to}", 18f))
            root.addView(text("${"%,d".format(t.fare)}원", 18f))
            root.addView(button("운행 완료") { complete(t) })
            return
        }
        if (busy) { root.addView(text("수락 중…", 18f)); return }
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        for (c in calls) {
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, 24, 0, 24) }
            row.addView(text("${c.from} → ${c.to}\n${"%,d".format(c.fare)}원", 16f).apply { maxLines = 2 }, LinearLayout.LayoutParams(0, 120, 1f))
            row.addView(button("수락") { accept(c) }, LinearLayout.LayoutParams(150, 96))
            list.addView(row)
        }
        if (calls.isEmpty()) list.addView(text("대기중인 콜 없음", 16f))
        root.addView(ScrollView(this).apply { addView(list) })
    }

    private fun renderLogin() {
        root.addView(text("대리콜 기사 로그인", 24f))
        val e = EditText(this).apply { hint = "기사 이름"; isSingleLine = true }
        root.addView(e)
        root.addView(button("근무 시작") {
            val n = e.text.toString().trim()
            if (n.isNotEmpty()) { name = n; getSharedPreferences("d", MODE_PRIVATE).edit().putString("name", n).apply(); render() }
        })
    }

    private fun fetch() = reads.execute {
        val got = try {
            val (code, t) = http("GET", "$server/calls", null, null)
            if (code == 200) JSONObject(t).getJSONArray("calls") else null
        } catch (e: Exception) { null } ?: return@execute
        val next = list(got)
        main.post { if (next != calls) { calls = next; render() } }
    }

    private fun list(a: JSONArray) = (0 until a.length()).map { a.getJSONObject(it) }.map { Call(it.getString("id"), it.getString("from"), it.getString("to"), it.getInt("fare"), it.getInt("version")) }

    // Retried until the server gives a definite answer; same body and key each time, so a lost answer is safe to resend.
    private fun send(method: String, url: String, body: String, key: String, done: (Int, String) -> Unit) = writes.execute {
        while (true) {
            try {
                val (code, t) = http(method, url, body, key)
                if (code < 500) { Log.i(TAG, "SENT $url http=$code"); main.post { done(code, t) }; break }
            } catch (e: Exception) { Log.i(TAG, "RETRY $url ${e.javaClass.simpleName}") }
            Thread.sleep(2000)
        }
    }

    private fun accept(c: Call) {
        busy = true; notice = ""; render()
        val body = JSONObject().put("version", c.version).put("driverId", driverId).put("name", name).toString()
        send("PUT", "$server/calls/${c.id}/driver", body, "accept-${c.id}-$driverId") { code, _ ->
            busy = false
            if (code in 200..299) trip = c else notice = "이미 배차된 콜입니다"
            render()
        }
    }

    private fun complete(c: Call) {
        val body = JSONObject().put("driverId", driverId).put("fare", c.fare).toString()
        send("POST", "$server/trips/${c.id}/complete", body, "complete-${c.id}-$driverId") { code, t ->
            if (code in 200..299) earned = JSONObject(t).optInt("earned", earned + c.fare)
            trip = null
            render()
        }
    }

    private fun text(s: String, sp: Float) = TextView(this).apply { text = s; textSize = sp; setTextColor(Color.BLACK) }
    private fun button(s: String, f: () -> Unit) = Button(this).apply { text = s; setOnClickListener { f() } }

    private fun http(method: String, url: String, body: String?, key: String?): Pair<Int, String> {
        val c = URL(url).openConnection() as HttpURLConnection
        c.requestMethod = method; c.connectTimeout = 5000; c.readTimeout = 8000
        try {
            if (body != null) {
                val b = body.toByteArray()
                c.doOutput = true
                c.setRequestProperty("Content-Type", "application/json")
                c.setRequestProperty("idempotency-key", key)
                c.setFixedLengthStreamingMode(b.size)
                c.outputStream.use { it.write(b) }
            }
            val code = c.responseCode
            val t = (if (code >= 400) c.errorStream else c.inputStream)?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            return code to t
        } finally { c.disconnect() }
    }

    companion object { const val TAG = "Daeri" }
}
