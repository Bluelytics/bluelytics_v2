/* The one dark palette of the social cards' "Editorial Bold" (packages/social/design/final/card.mjs
 * TOKENS), as on the website (apps/web/src/styles/global.css `:root`). */
package com.bluelytics.mobileapp.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object Bl {
    val ink = Color(0xFF040A14)
    val navy = Color(0xFF06203D)
    val surface = Color(0xFF061325)
    val surface2 = Color(0xFF0A1C34)

    /** Hairlines: brand-ink at 13 % and 30 %. */
    val line = Color(0x217DBEFF)
    val lineStrong = Color(0x4D7DBEFF)

    val text = Color(0xFFF4F8FC)
    val soft = Color(0xFFC3D6EA)
    val muted = Color(0xFFA9BDD3)
    val dim = Color(0xFF93A9C2)

    val brand = Color(0xFF1C7FD6)
    val brandDeep = Color(0xFF0069AC)
    val brandInk = Color(0xFF7DBEFF)

    val up = Color(0xFF2FD67B)
    val down = Color(0xFFFF5D5D)
    val warn = Color(0xFFFBBF24)
    val upBg = Color(0x242FD67B)
    val downBg = Color(0x24FF5D5D)
    val flatBg = Color(0x1AC3D6EA)

    val lineBlue = Color(0xFF4BA3F0)
    val lineOficial = Color(0xFF5CC46E)
    val lineGap = Color(0xFFFBBF24)

    val radius = 4.dp

    /** Side gutter of every screen, and the widest a column of content gets on tablets. */
    val gutter = 16.dp
    val maxWidth = 620.dp
}
