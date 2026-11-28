/*
 * Blue dollar alerts: a push notification whenever the sell price moves significantly. The device
 * subscribes to an FCM topic; the sender is the jobs Worker (apps/jobs/src/alerts.ts).
 */
package com.bluelytics.mobileapp.push

import com.bluelytics.mobileapp.data.Prefs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.update

/** A notification that arrived while the app was open (the system shows it otherwise). */
data class AlertMessage(val title: String, val body: String)

/** The platform side of alerts. `FirebasePush` on phones; `NoPush` where push does not exist and in tests. */
interface PushBackend {
    /** Whether this build can receive push notifications at all. */
    val supported: Boolean

    /** Asks for permission and subscribes. `false` when the person refuses notifications. */
    suspend fun enable(): Boolean

    suspend fun disable()

    /** Called at start when alerts are on: keeps the token fresh for subscribed devices. */
    suspend fun resume()

    /** Whether the React Native app (versions 1.x) had alerts on, or `null` when it left no trace. */
    suspend fun legacyEnabled(): Boolean?

    val messages: Flow<AlertMessage>
}

object NoPush : PushBackend {
    override val supported = false

    override suspend fun enable() = false

    override suspend fun disable() {}

    override suspend fun resume() {}

    override suspend fun legacyEnabled(): Boolean? = null

    override val messages: Flow<AlertMessage> = emptyFlow()
}

enum class AlertsProblem { denied, failed }

data class AlertsState(val enabled: Boolean = false, val busy: Boolean = false, val problem: AlertsProblem? = null)

class AlertsController(val backend: PushBackend, val prefs: Prefs) {
    private val _state = MutableStateFlow(AlertsState())
    val state: StateFlow<AlertsState> = _state.asStateFlow()

    val supported: Boolean get() = backend.supported

    val messages: Flow<AlertMessage> get() = backend.messages

    /**
     * Reads the saved choice. On the first run after an update from the React Native app it carries
     * over that app's choice: a device that was subscribed stays subscribed, and the switch must say so.
     */
    suspend fun init() {
        if (!supported) return
        val saved = prefs.getBoolean(KEY) ?: return firstRun()
        _state.update { it.copy(enabled = saved) }
        if (saved) {
            try {
                backend.resume()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // Notifications still arrive through the system; only the in-app banner is lost.
            }
        }
    }

    private suspend fun firstRun() {
        val legacy = try {
            backend.legacyEnabled() ?: false
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            false
        }
        _state.update { it.copy(enabled = legacy) }
        prefs.putBoolean(KEY, legacy)
        if (!legacy) return
        // Version 1 never asked Android 13+ for the notification permission, so a device can be
        // subscribed and still show nothing. Turning alerts on again asks for it; the subscription
        // itself is already there.
        try {
            if (backend.enable()) return
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Offline, for instance: the device is still subscribed from before.
            return
        }
        // Refused: off, and no point in receiving what cannot be shown.
        _state.update { it.copy(enabled = false) }
        prefs.putBoolean(KEY, false)
        try {
            backend.disable()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // The switch is off either way.
        }
    }

    suspend fun setEnabled(value: Boolean) {
        val current = _state.value
        if (current.busy || !supported || value == current.enabled) return
        _state.value = current.copy(busy = true, problem = null)
        var enabled = current.enabled
        var problem: AlertsProblem? = null
        try {
            if (value) {
                if (backend.enable()) enabled = true else problem = AlertsProblem.denied
            } else {
                backend.disable()
                enabled = false
            }
            prefs.putBoolean(KEY, enabled)
        } catch (error: CancellationException) {
            _state.value = AlertsState(enabled = enabled)
            throw error
        } catch (_: Exception) {
            problem = AlertsProblem.failed
        }
        _state.value = AlertsState(enabled = enabled, busy = false, problem = problem)
    }

    private companion object {
        const val KEY = "alerts_enabled"
    }
}
