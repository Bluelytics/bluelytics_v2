package com.bluelytics.mobileapp

import android.database.sqlite.SQLiteDatabase
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "bluelytics/legacy").setMethodCallHandler { call, result ->
            when (call.method) {
                "alertsEnabled" -> result.success(legacyAlertsEnabled())
                else -> result.notImplemented()
            }
        }
    }

    /**
     * Whether the React Native app (versions 1.x) had alerts on: it kept the switch in AsyncStorage,
     * an SQLite database named RKStorage, under the key `subState`. `null` when it left no trace.
     * Read once by lib/push/firebase_push.dart after an update, so the new switch starts where the
     * old one was.
     */
    private fun legacyAlertsEnabled(): Boolean? {
        val file = getDatabasePath("RKStorage")
        if (!file.exists()) return null
        return try {
            SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                database.rawQuery("SELECT value FROM catalystLocalStorage WHERE key = ?", arrayOf("subState")).use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) == "true" else null
                }
            }
        } catch (error: Exception) {
            null
        }
    }
}
