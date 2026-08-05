package com.eisyglobal.depositlistener

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.eisyglobal.depositlistener.databinding.ActivityMainBinding
import com.google.android.material.card.MaterialCardView

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var adapter: TransactionAdapter

    private val updateReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            refreshUI()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        adapter = TransactionAdapter()
        binding.recyclerTransactions.layoutManager = LinearLayoutManager(this)
        binding.recyclerTransactions.adapter = adapter

        binding.btnEnableListener.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }

        binding.btnRefresh.setOnClickListener { refreshUI() }

        refreshUI()
    }

    override fun onResume() {
        super.onResume()
        val filter = IntentFilter().apply {
            addAction(PaymentNotificationListener.ACTION_LOG_UPDATED)
            addAction(PaymentNotificationListener.ACTION_SERVICE_STATUS)
        }
        ContextCompat.registerReceiver(this, updateReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        refreshUI()
    }

    override fun onPause() {
        super.onPause()
        unregisterReceiver(updateReceiver)
    }

    private fun refreshUI() {
        val isRunning = isNotificationListenerEnabled()
        binding.statusIndicator.setBackgroundColor(
            ContextCompat.getColor(this, if (isRunning) R.color.status_running else R.color.status_stopped)
        )
        binding.tvStatus.text = if (isRunning) "Running" else "Stopped"
        binding.tvStatus.setTextColor(
            ContextCompat.getColor(this, if (isRunning) R.color.status_running else R.color.status_stopped)
        )
        binding.tvServerUrl.text = "Server: ${BuildConfig.SERVER_URL}"

        val transactions = TransactionLog.getAll(this)
        adapter.submitList(transactions)
        binding.tvEmpty.visibility = if (transactions.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun isNotificationListenerEnabled(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners")
        if (TextUtils.isEmpty(flat)) return false
        return flat.contains(packageName)
    }
}

class TransactionAdapter : RecyclerView.Adapter<TransactionAdapter.VH>() {
    private var items: List<ParsedTransaction> = emptyList()

    fun submitList(list: List<ParsedTransaction>) {
        items = list
        notifyDataSetChanged()
    }

    class VH(val card: MaterialCardView) : RecyclerView.ViewHolder(card) {
        val tvRef: TextView = card.findViewById(R.id.tvRef)
        val tvAmount: TextView = card.findViewById(R.id.tvAmount)
        val tvSource: TextView = card.findViewById(R.id.tvSource)
        val tvStatus: TextView = card.findViewById(R.id.tvStatus)
        val tvTime: TextView = card.findViewById(R.id.tvTime)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_transaction, parent, false) as MaterialCardView
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val tx = items[position]
        holder.tvRef.text = tx.refCode
        holder.tvAmount.text = "${tx.amount.toLong()} MMK"
        holder.tvSource.text = tx.source
        holder.tvStatus.text = tx.verifyStatus
        holder.tvTime.text = TransactionLog.formatTime(tx.timestamp)

        val colorRes = when (tx.verifyStatus) {
            "VERIFIED" -> R.color.status_running
            "FAILED" -> R.color.status_stopped
            else -> R.color.status_pending
        }
        holder.tvStatus.setTextColor(ContextCompat.getColor(holder.itemView.context, colorRes))
    }

    override fun getItemCount() = items.size
}
