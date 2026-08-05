package com.eisyglobal.depositlistener

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class ParsedTransaction(
    val refCode: String,
    val amount: Double,
    val txnId: String?,
    val senderPhone: String?,
    val source: String,
    val rawText: String,
    val timestamp: Long = System.currentTimeMillis(),
    var verifyStatus: String = "PENDING"
)

object TransactionLog {
    private const val PREFS = "deposit_listener_prefs"
    private const val KEY_LOG = "transaction_log"
    private const val MAX_ENTRIES = 50

    private fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun add(context: Context, tx: ParsedTransaction) {
        val list = getAll(context).toMutableList()
        list.add(0, tx)
        save(context, list.take(MAX_ENTRIES))
    }

    fun updateStatus(context: Context, refCode: String, status: String) {
        val list = getAll(context).map {
            if (it.refCode == refCode) it.copy(verifyStatus = status) else it
        }
        save(context, list)
    }

    fun getAll(context: Context): List<ParsedTransaction> {
        val json = prefs(context).getString(KEY_LOG, "[]") ?: "[]"
        val arr = JSONArray(json)
        return (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            ParsedTransaction(
                refCode = obj.getString("refCode"),
                amount = obj.getDouble("amount"),
                txnId = obj.optString("txnId").ifEmpty { null },
                senderPhone = obj.optString("senderPhone").ifEmpty { null },
                source = obj.getString("source"),
                rawText = obj.getString("rawText"),
                timestamp = obj.getLong("timestamp"),
                verifyStatus = obj.optString("verifyStatus", "PENDING")
            )
        }
    }

    private fun save(context: Context, list: List<ParsedTransaction>) {
        val arr = JSONArray()
        list.forEach { tx ->
            arr.put(JSONObject().apply {
                put("refCode", tx.refCode)
                put("amount", tx.amount)
                put("txnId", tx.txnId ?: "")
                put("senderPhone", tx.senderPhone ?: "")
                put("source", tx.source)
                put("rawText", tx.rawText)
                put("timestamp", tx.timestamp)
                put("verifyStatus", tx.verifyStatus)
            })
        }
        prefs(context).edit().putString(KEY_LOG, arr.toString()).apply()
    }

    fun formatTime(ts: Long): String {
        return SimpleDateFormat("HH:mm:ss", Locale.getDefault()).format(Date(ts))
    }
}
