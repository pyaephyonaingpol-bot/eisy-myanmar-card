package com.eisyglobal.depositlistener

import android.util.Log
import java.util.regex.Pattern

object PaymentParser {
    private const val TAG = "PaymentParser"

    private val REF_PATTERN = Pattern.compile("REF-\\d{4}", Pattern.CASE_INSENSITIVE)
    private val AMOUNT_PATTERNS = listOf(
        Pattern.compile("(?:received|sent|transfer(?:red)?|paid|amount)[:\\s]*([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:MMK|Ks|Kyats)?", Pattern.CASE_INSENSITIVE),
        Pattern.compile("([\\d,]+(?:\\.\\d{1,2})?)\\s*(?:MMK|Ks|Kyats)", Pattern.CASE_INSENSITIVE),
        Pattern.compile("(?:MMK|Ks|Kyats)\\s*([\\d,]+(?:\\.\\d{1,2})?)", Pattern.CASE_INSENSITIVE),
    )
    private val TXN_PATTERN = Pattern.compile("(?:txn|transaction|trans|ref)[:\\s#]*([A-Z0-9-]{6,})", Pattern.CASE_INSENSITIVE)
    private val PHONE_PATTERN = Pattern.compile("(?:from|sender|phone)[:\\s]*([\\d+\\-\\s]{8,15})", Pattern.CASE_INSENSITIVE)

    data class ParseResult(
        val refCode: String,
        val amount: Double,
        val txnId: String?,
        val senderPhone: String?
    )

    fun parse(fullText: String): ParseResult? {
        val refMatcher = REF_PATTERN.matcher(fullText)
        if (!refMatcher.find()) {
            Log.d(TAG, "No REF code found in: $fullText")
            return null
        }
        val refCode = refMatcher.group().uppercase()

        var amount: Double? = null
        for (pattern in AMOUNT_PATTERNS) {
            val m = pattern.matcher(fullText)
            if (m.find()) {
                amount = m.group(1)?.replace(",", "")?.toDoubleOrNull()
                if (amount != null) break
            }
        }
        if (amount == null) {
            Log.d(TAG, "No amount found for ref $refCode")
            return null
        }

        val txnMatcher = TXN_PATTERN.matcher(fullText)
        val txnId = if (txnMatcher.find()) txnMatcher.group(1) else null

        val phoneMatcher = PHONE_PATTERN.matcher(fullText)
        val senderPhone = if (phoneMatcher.find()) phoneMatcher.group(1)?.trim() else null

        return ParseResult(refCode, amount, txnId, senderPhone)
    }
}
