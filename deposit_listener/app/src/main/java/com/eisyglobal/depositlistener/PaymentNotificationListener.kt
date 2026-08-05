package com.eisyglobal.depositlistener

import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class PaymentNotificationListener : NotificationListenerService() {

    companion object {
        const val ACTION_LOG_UPDATED = "com.eisyglobal.depositlistener.LOG_UPDATED"
        const val ACTION_SERVICE_STATUS = "com.eisyglobal.depositlistener.SERVICE_STATUS"
        private const val TAG = "PaymentListener"

        private val TARGET_PACKAGES = setOf(
            "com.kbzbank.kpay",           // KBZPay
            "mm.com.wavemoney.wavepay"    // WavePay
        )
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.i(TAG, "Notification listener connected")
        sendBroadcast(Intent(ACTION_SERVICE_STATUS).putExtra("running", true))
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.i(TAG, "Notification listener disconnected")
        sendBroadcast(Intent(ACTION_SERVICE_STATUS).putExtra("running", false))
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        val pkg = sbn.packageName
        if (pkg !in TARGET_PACKAGES) return

        val notification = sbn.notification ?: return
        val extras = notification.extras

        val title = extras.getCharSequence("android.title")?.toString() ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""
        val bigText = extras.getCharSequence("android.bigText")?.toString() ?: ""
        val fullText = "$title $text $bigText".trim()

        Log.d(TAG, "[$pkg] Notification: $fullText")

        val parsed = PaymentParser.parse(fullText) ?: return
        val source = if (pkg.contains("kbz")) "KBZPay" else "WavePay"

        val tx = ParsedTransaction(
            refCode = parsed.refCode,
            amount = parsed.amount,
            txnId = parsed.txnId,
            senderPhone = parsed.senderPhone,
            source = source,
            rawText = fullText
        )

        TransactionLog.add(applicationContext, tx)
        sendBroadcast(Intent(ACTION_LOG_UPDATED))

        scope.launch {
            val result = VerifyApiClient.verifyDeposit(
                refCode = parsed.refCode,
                amount = parsed.amount,
                txnId = parsed.txnId,
                senderPhone = parsed.senderPhone
            )
            val status = if (result.isSuccess) "VERIFIED" else "FAILED"
            TransactionLog.updateStatus(applicationContext, parsed.refCode, status)
            sendBroadcast(Intent(ACTION_LOG_UPDATED))
        }
    }
}
