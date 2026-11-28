/* What the person chose and the app must remember. */
package com.bluelytics.mobileapp.data

import android.content.SharedPreferences
import androidx.core.content.edit
import com.bluelytics.mobileapp.domain.AppLocale
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** The few values the app keeps: a small seam over SharedPreferences, so tests need no device. */
interface Prefs {
    fun getString(key: String): String?

    fun putString(key: String, value: String)

    fun getBoolean(key: String): Boolean?

    fun putBoolean(key: String, value: Boolean)
}

class SharedPrefs(private val preferences: SharedPreferences) : Prefs {
    override fun getString(key: String): String? = preferences.getString(key, null)

    override fun putString(key: String, value: String) = preferences.edit { putString(key, value) }

    override fun getBoolean(key: String): Boolean? = if (preferences.contains(key)) preferences.getBoolean(key, false) else null

    override fun putBoolean(key: String, value: Boolean) = preferences.edit { putBoolean(key, value) }
}

class MemoryPrefs(initial: Map<String, Any> = emptyMap()) : Prefs {
    val values: MutableMap<String, Any> = HashMap(initial)

    override fun getString(key: String): String? = values[key] as? String

    override fun putString(key: String, value: String) {
        values[key] = value
    }

    override fun getBoolean(key: String): Boolean? = values[key] as? Boolean

    override fun putBoolean(key: String, value: Boolean) {
        values[key] = value
    }
}

/**
 * `deviceLocale` applies until a language is chosen: Spanish on a Spanish-language device, English
 * everywhere else.
 */
class Settings(val prefs: Prefs, deviceLocale: AppLocale) {
    private val _locale = MutableStateFlow(prefs.getString(LOCALE_KEY)?.let { saved -> AppLocale.entries.firstOrNull { it.name == saved } } ?: deviceLocale)
    val locale: StateFlow<AppLocale> = _locale.asStateFlow()

    fun setLocale(value: AppLocale) {
        if (value == _locale.value) return
        _locale.value = value
        prefs.putString(LOCALE_KEY, value.name)
    }

    fun toggleLocale() = setLocale(if (_locale.value == AppLocale.es) AppLocale.en else AppLocale.es)

    private companion object {
        const val LOCALE_KEY = "locale"
    }
}
