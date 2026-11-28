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
    fun `the first run after updating from version 1 carries its switch over, once`() = runTest {
        val push = FakePush(legacy = true)
        val alerts = controller(push)
        alerts.init()
        assertTrue(alerts.enabled)
        assertEquals(true, alerts.prefs.getBoolean("alerts_enabled"))
        assertEquals("asks for the notification permission version 1 never requested", listOf("enable"), push.calls)

        // The person turns alerts off: the old app's "on" must not come back.
        alerts.setEnabled(false)
        val again = AlertsController(FakePush(legacy = true), alerts.prefs)
        again.init()
        assertFalse(again.enabled)
    }

    @Test
    fun `carried over from version 1 but notifications refused - off, and unsubscribed`() = runTest {
        val push = FakePush(legacy = true, grant = false)
        val alerts = controller(push)
        alerts.init()
        assertFalse(alerts.enabled)
        assertEquals(false, alerts.prefs.getBoolean("alerts_enabled"))
        assertEquals(listOf("enable", "disable"), push.calls)
    }

    @Test
    fun `carried over from version 1 while offline - still on, as the device is still subscribed`() = runTest {
        val push = FakePush(legacy = true, fail = true)
        val alerts = controller(push)
        alerts.init()
        assertTrue(alerts.enabled)
        assertEquals(true, alerts.prefs.getBoolean("alerts_enabled"))
        assertNull(alerts.problem)
    }

    @Test
    fun `version 1 had alerts off, or left no trace - off, and Firebase is not touched`() = runTest {
        for (legacy in listOf(false, null)) {
            val push = FakePush(legacy = legacy)
            val alerts = controller(push)
            alerts.init()
            assertFalse(alerts.enabled)
            assertEquals(false, alerts.prefs.getBoolean("alerts_enabled"))
            assertTrue(push.calls.isEmpty())
        }
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
