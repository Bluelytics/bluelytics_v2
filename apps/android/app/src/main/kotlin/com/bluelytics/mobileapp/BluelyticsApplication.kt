package com.bluelytics.mobileapp

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.bluelytics.mobileapp.data.AppStore
import com.bluelytics.mobileapp.data.FileCacheStore
import com.bluelytics.mobileapp.data.HttpFetcher
import com.bluelytics.mobileapp.data.Settings
import com.bluelytics.mobileapp.data.SharedPrefs
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.push.AlertsController
import com.bluelytics.mobileapp.push.FirebasePush
import com.bluelytics.mobileapp.ui.AppScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.util.Locale

class BluelyticsApplication : Application() {
    /** Lives as long as the process: refreshes and cache writes outlive any one screen. */
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    lateinit var push: FirebasePush
        private set
    lateinit var scope: AppScope
        private set

    private val _ready = MutableStateFlow(false)

    /** The cached bodies are loaded: the first frame can show what was on screen last time. */
    val ready: StateFlow<Boolean> = _ready

    override fun onCreate() {
        super.onCreate()
        createAlertsChannel()
        val prefs = SharedPrefs(getSharedPreferences("bluelytics", Context.MODE_PRIVATE))
        val deviceLanguage = Locale.getDefault().language
        val settings = Settings(prefs, if (deviceLanguage == "es") AppLocale.es else AppLocale.en)
        val store = AppStore(HttpFetcher(), FileCacheStore { cacheDir }, appScope)
        push = FirebasePush(this)
        val alerts = AlertsController(push, prefs)
        scope = AppScope(store, settings, alerts)
        appScope.launch {
            store.restore()
            _ready.value = true
            launch { store.refresh() }
            alerts.init()
        }
    }

    /**
     * The channel the alert sender targets (`channel_id` in packages/core/src/alerts.ts). Created
     * whenever the process starts, including when it is woken to show a notification, so alerts
     * never fall back to the unnamed default channel.
     */
    private fun createAlertsChannel() {
        val channel = NotificationChannel(ALERTS_CHANNEL_ID, getString(R.string.alerts_channel_name), NotificationManager.IMPORTANCE_HIGH)
        channel.description = getString(R.string.alerts_channel_description)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }
}
