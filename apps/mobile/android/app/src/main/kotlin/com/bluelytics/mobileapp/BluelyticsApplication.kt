package com.bluelytics.mobileapp

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build

class BluelyticsApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        createAlertsChannel()
    }

    /**
     * The channel the alert sender targets (`channel_id` in packages/core/src/alerts.ts). Created
     * whenever the process starts, including when it is woken to show a notification, so alerts
     * never fall back to the unnamed default channel.
     */
    private fun createAlertsChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(ALERTS_CHANNEL_ID, getString(R.string.alerts_channel_name), NotificationManager.IMPORTANCE_HIGH)
        channel.description = getString(R.string.alerts_channel_description)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val ALERTS_CHANNEL_ID = "Dolar Blue"
    }
}
