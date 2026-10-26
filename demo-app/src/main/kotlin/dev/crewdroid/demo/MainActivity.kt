package dev.crewdroid.demo

import android.content.res.ColorStateList
import android.graphics.drawable.GradientDrawable
import android.content.pm.ApplicationInfo
import android.os.Bundle
import android.util.Log
import android.text.format.DateUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.AnimationUtils
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.DefaultItemAnimator
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.ListAdapter
import androidx.recyclerview.widget.RecyclerView
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.chip.Chip
import com.google.android.material.chip.ChipGroup
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import java.text.SimpleDateFormat
import java.util.Locale

// Field Notes (T48): the demo app the intro clips show. Launch extras: --es server http://10.0.2.2:<port> (kept for later launches).
class MainActivity : AppCompatActivity() {
    private val adapter = NoteAdapter()
    private val poll = object : Runnable { override fun run() { Notes.refresh(); list.postDelayed(this, 2000) } }
    private lateinit var list: RecyclerView
    private lateinit var chip: Chip
    private lateinit var subtitle: TextView

    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        val prefs = getSharedPreferences("demo", MODE_PRIVATE)
        intent.getStringExtra("server")?.let { prefs.edit().putString("server", it).apply() }
        Notes.init(this)
        Notes.server = prefs.getString("server", null) ?: Notes.server
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)
        subtitle = findViewById(R.id.app_subtitle)
        chip = findViewById(R.id.sync)
        list = findViewById(R.id.list)
        // 2 columns once the window is tablet-wide (Fold main screen), 1 on phones and the cover screen.
        list.layoutManager = GridLayoutManager(this, if (resources.configuration.screenWidthDp >= 600) 2 else 1)
        list.adapter = adapter
        // AI NOTE: `input text` key events take the window out of touch mode; the focused list then drew Android's grey default focus highlight over every card.
        list.defaultFocusHighlightEnabled = false
        list.itemAnimator = DefaultItemAnimator().apply { addDuration = 300; supportsChangeAnimations = false } // the new card fades in after the others moved down
        if (b == null) list.layoutAnimation = AnimationUtils.loadLayoutAnimation(this, R.anim.list_in)
        val refresh = findViewById<SwipeRefreshLayout>(R.id.refresh)
        refresh.setColorSchemeColors(getColor(R.color.accent))
        refresh.setOnRefreshListener {
            val t0 = System.currentTimeMillis()
            Notes.refresh { refresh.postDelayed({ refresh.isRefreshing = false }, maxOf(0, 700 - (System.currentTimeMillis() - t0))) }
        }
        findViewById<View>(R.id.fab).setOnClickListener { editor() }
        Notes.listener = { render() }
        render()
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) logLayout()
    }

    // AI NOTE: debug builds only, read by scripts/check-layout.mjs (T51). The accessibility tree keeps the full text of an ellipsized
    // label, so the drawn truncation is logged here: dropped characters of the title/subtitle, and how many px the sync chip
    // is narrower than its own drawable wants (Chip draws its text itself, so it has no TextView layout to ask).
    private fun logLayout() {
        var last = ""
        val title = findViewById<TextView>(R.id.app_title)
        fun cut(t: TextView) = t.layout?.let { l -> (0 until l.lineCount).sumOf { l.getEllipsisCount(it) } } ?: -1
        window.decorView.viewTreeObserver.addOnGlobalLayoutListener {
            val now = "LAYOUT title=${cut(title)} subtitle=${cut(subtitle)} sync=${maxOf(0, chip.chipDrawable.intrinsicWidth - chip.width)}"
            if (now != last) { last = now; Log.i(Notes.TAG, now) }
        }
    }

    override fun onResume() { super.onResume(); list.post(poll) }
    override fun onPause() { super.onPause(); list.removeCallbacks(poll) }

    private fun render() {
        val before = adapter.currentList.firstOrNull()?.id
        adapter.submitList(Notes.all) { if (Notes.all.firstOrNull()?.id != before) list.scrollToPosition(0) }
        val n = Notes.pending
        val (text, bg, ink) = when {
            !Notes.online -> Triple(if (n > 0) "Offline · $n pending" else "Offline", R.color.warn_bg, R.color.warn_ink)
            n > 0 -> Triple("Syncing · $n", R.color.warn_bg, R.color.warn_ink)
            else -> Triple("Synced ✓", R.color.ok_bg, R.color.ok_ink)
        }
        chip.text = text
        chip.chipBackgroundColor = ColorStateList.valueOf(getColor(bg))
        chip.setTextColor(getColor(ink))
        subtitle.text = "Riverside depot · ${Notes.all.size} notes"
    }

    private fun editor() {
        val d = BottomSheetDialog(this)
        val v = layoutInflater.inflate(R.layout.sheet_editor, null)
        val sites = v.findViewById<ChipGroup>(R.id.sites)
        SITES.forEachIndexed { i, s ->
            sites.addView(Chip(this, null, com.google.android.material.R.attr.chipStyle).apply {
                id = View.generateViewId(); text = s; textSize = 15f; isCheckable = true; isChecked = i == 0
            })
        }
        val title = v.findViewById<TextInputEditText>(R.id.title)
        v.findViewById<View>(R.id.save).setOnClickListener {
            val t = title.text?.toString()?.trim().orEmpty()
            if (t.isEmpty()) { v.findViewById<TextInputLayout>(R.id.title_box).error = "Add a title"; return@setOnClickListener }
            Notes.add(t, v.findViewById<Chip>(sites.checkedChipId)?.text?.toString() ?: SITES[0])
            d.dismiss()
        }
        d.setContentView(v)
        d.behavior.state = BottomSheetBehavior.STATE_EXPANDED
        d.behavior.skipCollapsed = true
        d.show()
        title.requestFocus()
    }

    companion object { val SITES = listOf("Pump house", "North field", "Warehouse", "Workshop") }
}

// Generated colour thumbnails: one fixed colour per site, initials in white (contrast checked by clips.mjs).
private val THUMB = mapOf("Pump house" to 0xFF2F55A4.toInt(), "North field" to 0xFF0B6E4F.toInt(), "Warehouse" to 0xFFA1432C.toInt(), "Workshop" to 0xFF6E4A9E.toInt())
private val CLOCK = SimpleDateFormat("HH:mm", Locale.US)

class NoteAdapter : ListAdapter<Note, NoteAdapter.H>(object : DiffUtil.ItemCallback<Note>() {
    override fun areItemsTheSame(a: Note, b: Note) = a.id == b.id
    override fun areContentsTheSame(a: Note, b: Note) = a == b
}) {
    class H(v: View) : RecyclerView.ViewHolder(v) {
        val thumb: TextView = v.findViewById(R.id.thumb)
        val title: TextView = v.findViewById(R.id.note_title)
        val meta: TextView = v.findViewById(R.id.meta)
        val synced: ImageView = v.findViewById(R.id.synced)
        val pending: TextView = v.findViewById(R.id.pending)
    }

    override fun onCreateViewHolder(p: ViewGroup, type: Int) = H(LayoutInflater.from(p.context).inflate(R.layout.item_note, p, false))

    override fun onBindViewHolder(h: H, i: Int) {
        val n = getItem(i)
        h.thumb.text = n.site.split(" ").let { w -> if (w.size > 1) w.joinToString("") { it.take(1) } else w[0].take(2) }.uppercase()
        h.thumb.background = GradientDrawable().apply { cornerRadius = 12 * h.thumb.resources.displayMetrics.density; setColor(THUMB[n.site] ?: 0xFF3E4A44.toInt()) }
        h.title.text = n.title
        val day = if (DateUtils.isToday(n.at)) CLOCK.format(n.at) else "Yesterday"
        h.meta.text = "${n.site} · $day"
        h.synced.visibility = if (n.synced) View.VISIBLE else View.GONE
        h.pending.visibility = if (n.synced) View.GONE else View.VISIBLE
    }
}
