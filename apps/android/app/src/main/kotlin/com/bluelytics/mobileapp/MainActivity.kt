package com.bluelytics.mobileapp

import android.Manifest
import android.os.Build
import android.os.Bundle
import android.provider.Settings as SystemSettings
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import com.bluelytics.mobileapp.push.PermissionRequester
import com.bluelytics.mobileapp.ui.BluelyticsApp
import kotlinx.coroutines.CompletableDeferred

class MainActivity : ComponentActivity() {
    private var pendingPermission: CompletableDeferred<Boolean>? = null

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        pendingPermission?.complete(granted)
        pendingPermission = null
    }

    private val requester = PermissionRequester {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return@PermissionRequester true
        val result = CompletableDeferred<Boolean>()
        pendingPermission?.complete(false)
        pendingPermission = result
        notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        result.await()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val app = application as BluelyticsApplication
        // The mark on ink until the cached prices are loaded (a few milliseconds from disk).
        installSplashScreen().setKeepOnScreenCondition { !app.ready.value }
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        app.push.permissionRequester = requester
        // "Remove animations" in the system settings: no loops, no entrances.
        val reducedMotion = SystemSettings.Global.getFloat(contentResolver, SystemSettings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        setContent { BluelyticsApp(app.scope, reducedMotion) }
    }

    override fun onDestroy() {
        val app = application as BluelyticsApplication
        if (app.push.permissionRequester === requester) app.push.permissionRequester = null
        pendingPermission?.complete(false)
        super.onDestroy()
    }
}
