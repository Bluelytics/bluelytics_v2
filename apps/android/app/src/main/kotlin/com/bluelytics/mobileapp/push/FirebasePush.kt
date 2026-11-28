/*
 * Alerts over Firebase Cloud Messaging. Automatic initialisation is off in the manifest, so no push
 * token exists, and FCM never talks to Google, until someone turns alerts on.
 */
package com.bluelytics.mobileapp.push

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.database.sqlite.SQLiteDatabase
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.bluelytics.mobileapp.ALERTS_TOPIC
import com.google.android.gms.tasks.Task
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** Asks the person for the notification permission (Android 13+); set by the visible activity. */
fun interface PermissionRequester {
    suspend fun request(): Boolean
}

class FirebasePush(private val context: Context) : PushBackend {
    /** The activity on screen, which can show the system permission dialog. */
    @Volatile
    var permissionRequester: PermissionRequester? = null

    override val supported = true

    override val messages: Flow<AlertMessage> = Incoming.messages

    private val messaging: FirebaseMessaging get() = FirebaseMessaging.getInstance()

    override suspend fun enable(): Boolean {
        if (!askPermission()) return false
        messaging.isAutoInitEnabled = true
        messaging.subscribeToTopic(ALERTS_TOPIC).await()
        return true
    }

    override suspend fun disable() {
        messaging.unsubscribeFromTopic(ALERTS_TOPIC).await()
        messaging.isAutoInitEnabled = false
    }

    override suspend fun resume() {
        // Keeps the token fresh for devices that carried their subscription over from version 1.
        messaging.isAutoInitEnabled = true
    }

    private suspend fun askPermission(): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            val requester = permissionRequester ?: return false
            if (!requester.request()) return false
        }
        // Below Android 13 there is no dialog, but notifications can still be off for the app.
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /**
     * Whether the React Native app (versions 1.x) had alerts on: it kept the switch in AsyncStorage,
     * an SQLite database named RKStorage, under the key `subState`. `null` when it left no trace.
     */
    override suspend fun legacyEnabled(): Boolean? {
        val file = context.getDatabasePath("RKStorage")
        if (!file.exists()) return null
        return try {
            SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
                database.rawQuery("SELECT value FROM catalystLocalStorage WHERE key = ?", arrayOf("subState")).use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) == "true" else null
                }
            }
        } catch (_: Exception) {
            null
        }
    }
}

/** Alerts handed over by [AlertsMessagingService] while the app is open. */
object Incoming {
    private val flow = MutableSharedFlow<AlertMessage>(extraBufferCapacity = 4, onBufferOverflow = BufferOverflow.DROP_OLDEST)
    val messages: Flow<AlertMessage> = flow.asSharedFlow()

    fun deliver(message: AlertMessage) {
        flow.tryEmit(message)
    }
}

/**
 * FCM hands a notification to the app instead of showing it when the app is in the foreground: the
 * shell shows it as a banner. In the background the system shows it and this is not called.
 */
// Topic subscriptions follow the token by themselves: there is no server of ours to tell about a new
// one, so onNewToken has nothing to do.
@SuppressLint("MissingFirebaseInstanceTokenRefresh")
class AlertsMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val notification = message.notification ?: return
        Incoming.deliver(AlertMessage(notification.title.orEmpty(), notification.body.orEmpty()))
    }
}

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { continuation ->
    addOnCompleteListener { task ->
        val error = task.exception
        when {
            error != null -> continuation.resumeWithException(error)
            task.isCanceled -> continuation.cancel()
            else -> continuation.resume(task.result)
        }
    }
}
