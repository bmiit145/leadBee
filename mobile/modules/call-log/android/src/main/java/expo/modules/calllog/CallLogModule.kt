package expo.modules.calllog

import android.Manifest
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Reads the phone's call log so LeadBee can record calls with customers.
 *
 * It only reads. Deciding which calls belong to a customer — and discarding
 * every other call — happens in JavaScript before anything is sent anywhere
 * (docs/adr/0005-call-tracking.md).
 */
class CallLogModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LeadBeeCallLog")

    Function("hasPermission") {
      val context = appContext.reactContext ?: return@Function false
      ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) ==
        PackageManager.PERMISSION_GRANTED
    }

    /**
     * Calls that started after `sinceEpochMs`, newest first, capped so a phone
     * with years of history cannot stall the sync.
     */
    AsyncFunction("getCallsSince") { sinceEpochMs: Double, limit: Int ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()

      if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CALL_LOG) !=
        PackageManager.PERMISSION_GRANTED
      ) {
        throw SecurityException("READ_CALL_LOG has not been granted")
      }

      val projection = arrayOf(
        CallLog.Calls._ID,
        CallLog.Calls.NUMBER,
        CallLog.Calls.TYPE,
        CallLog.Calls.DATE,
        CallLog.Calls.DURATION
      )
      val capped = limit.coerceIn(1, 2000)
      val calls = mutableListOf<Map<String, Any?>>()

      context.contentResolver.query(
        CallLog.Calls.CONTENT_URI,
        projection,
        "${CallLog.Calls.DATE} > ?",
        arrayOf(sinceEpochMs.toLong().toString()),
        "${CallLog.Calls.DATE} DESC LIMIT $capped"
      )?.use { cursor ->
        val idColumn = cursor.getColumnIndexOrThrow(CallLog.Calls._ID)
        val numberColumn = cursor.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
        val typeColumn = cursor.getColumnIndexOrThrow(CallLog.Calls.TYPE)
        val dateColumn = cursor.getColumnIndexOrThrow(CallLog.Calls.DATE)
        val durationColumn = cursor.getColumnIndexOrThrow(CallLog.Calls.DURATION)

        while (cursor.moveToNext()) {
          calls.add(
            mapOf(
              "id" to cursor.getString(idColumn),
              "number" to (cursor.getString(numberColumn) ?: ""),
              "type" to cursor.getInt(typeColumn),
              // Milliseconds since the epoch, as the platform stores it.
              "timestamp" to cursor.getLong(dateColumn).toDouble(),
              "durationSeconds" to cursor.getLong(durationColumn).toInt()
            )
          )
        }
      }

      calls
    }
  }
}
