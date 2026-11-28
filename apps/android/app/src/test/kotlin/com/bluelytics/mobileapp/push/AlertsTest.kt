package com.bluelytics.mobileapp.push

import com.bluelytics.mobileapp.data.MemoryPrefs
import com.bluelytics.mobileapp.support.FakePush
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AlertsTest {
    private fun controller(backend: PushBackend, saved: Map<String, Any> = emptyMap()) = AlertsController(backend, MemoryPrefs(saved))

    private val AlertsController.enabled get() = state.value.enabled
    private val AlertsController.problem get() = state.value.problem

    @Test
    fun `off by default, and Firebase is left alone until someone turns alerts on`() = runTest {
        val push = FakePush()
        val alerts = controller(push)
        alerts.init()
        assertFalse(alerts.enabled)
        assertTrue(push.calls.isEmpty())
    }

    @Test
    fun `turning on subscribes and remembers, turning off unsubscribes`() = runTest {
        val push = FakePush()
        val alerts = controller(push)
        alerts.init()
        alerts.setEnabled(true)
        assertTrue(alerts.enabled)
        assertNull(alerts.problem)
        assertEquals(true, alerts.prefs.getBoolean("alerts_enabled"))
        alerts.setEnabled(false)
        assertFalse(alerts.enabled)
        assertEquals(false, alerts.prefs.getBoolean("alerts_enabled"))
        assertEquals(listOf("enable", "disable"), push.calls)
    }

    @Test
    fun `a refused permission leaves alerts off and says why`() = runTest {
        val alerts = controller(FakePush(grant = false))
        alerts.init()
        alerts.setEnabled(true)
        assertFalse(alerts.enabled)
        assertEquals(AlertsProblem.denied, alerts.problem)
    }

    @Test
    fun `a network failure keeps the previous state`() = runTest {
        val push = FakePush(fail = true)
        val alerts = controller(push, mapOf("alerts_enabled" to true))
        alerts.init()
        assertTrue(alerts.enabled)
        alerts.setEnabled(false)
        assertTrue("still subscribed: the unsubscribe did not go through", alerts.enabled)
        assertEquals(AlertsProblem.failed, alerts.problem)
        push.fail = false
        alerts.setEnabled(false)
        assertFalse(alerts.enabled)
        assertNull(alerts.problem)
    }

    @Test
    fun `a saved on resumes listening at start`() = runTest {
        val push = FakePush()
        val alerts = controller(push, mapOf("alerts_enabled" to true))
        alerts.init()
        assertTrue(alerts.enabled)
        assertEquals(listOf("resume"), push.calls)
    }

    @Test
    fun `where push does not exist the switch does nothing`() = runTest {
        val alerts = controller(NoPush)
        alerts.init()
        alerts.setEnabled(true)
        assertFalse(alerts.supported)
        assertFalse(alerts.enabled)
        assertNull(alerts.prefs.getBoolean("alerts_enabled"))
    }
}
