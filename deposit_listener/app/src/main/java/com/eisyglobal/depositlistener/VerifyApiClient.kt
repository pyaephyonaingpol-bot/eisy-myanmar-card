package com.eisyglobal.depositlistener

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object VerifyApiClient {
    private const val TAG = "VerifyApiClient"
    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    suspend fun verifyDeposit(
        refCode: String,
        amount: Double,
        txnId: String?,
        senderPhone: String?
    ): Result<String> = withContext(Dispatchers.IO) {
        try {
            val url = "${BuildConfig.SERVER_URL}/api/deposit/verify"
            val body = JSONObject().apply {
                put("ref_code", refCode)
                put("amount", amount)
                put("txn_id", txnId ?: "")
                put("sender_phone", senderPhone ?: "")
            }.toString()

            val request = Request.Builder()
                .url(url)
                .post(body.toRequestBody("application/json".toMediaType()))
                .build()

            client.newCall(request).execute().use { response ->
                val responseBody = response.body?.string() ?: ""
                Log.d(TAG, "Verify response (${response.code}): $responseBody")
                if (response.isSuccessful) {
                    Result.success("VERIFIED")
                } else {
                    Result.failure(Exception("HTTP ${response.code}: $responseBody"))
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Verify failed", e)
            Result.failure(e)
        }
    }
}
