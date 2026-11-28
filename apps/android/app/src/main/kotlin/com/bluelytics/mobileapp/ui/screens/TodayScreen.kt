/* Today: the tape, the blue dollar hero, the other rates and a quick dollars-to-pesos table. */
package com.bluelytics.mobileapp.ui.screens

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import com.bluelytics.mobileapp.ui.theme.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bluelytics.mobileapp.data.AppStore
import com.bluelytics.mobileapp.data.StoreState
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.domain.ChartMode
import com.bluelytics.mobileapp.domain.DayRates
import com.bluelytics.mobileapp.domain.Direction
import com.bluelytics.mobileapp.domain.LineKey
import com.bluelytics.mobileapp.domain.Move
import com.bluelytics.mobileapp.domain.NBSP
import com.bluelytics.mobileapp.domain.Quote
import com.bluelytics.mobileapp.domain.RangePreset
import com.bluelytics.mobileapp.domain.Snapshot
import com.bluelytics.mobileapp.domain.formatAmount
import com.bluelytics.mobileapp.domain.formatDateTime
import com.bluelytics.mobileapp.domain.formatDay
import com.bluelytics.mobileapp.domain.formatInteger
import com.bluelytics.mobileapp.domain.formatPercent
import com.bluelytics.mobileapp.domain.formatPesos
import com.bluelytics.mobileapp.domain.formatPesosCents
import com.bluelytics.mobileapp.domain.formatSignedPercent
import com.bluelytics.mobileapp.domain.rangeOf
import com.bluelytics.mobileapp.i18n.Strings
import com.bluelytics.mobileapp.ui.LocalApp
import com.bluelytics.mobileapp.ui.theme.Bl
import com.bluelytics.mobileapp.ui.theme.BlType
import com.bluelytics.mobileapp.ui.theme.mono
import com.bluelytics.mobileapp.ui.theme.sans
import com.bluelytics.mobileapp.ui.widgets.ContentWidth
import com.bluelytics.mobileapp.ui.widgets.EaseOut
import com.bluelytics.mobileapp.ui.widgets.FitText
import com.bluelytics.mobileapp.ui.widgets.Glyph
import com.bluelytics.mobileapp.ui.widgets.GlyphIcon
import com.bluelytics.mobileapp.ui.widgets.Hairline
import com.bluelytics.mobileapp.ui.widgets.LiveDot
import com.bluelytics.mobileapp.ui.widgets.LocalReducedMotion
import com.bluelytics.mobileapp.ui.widgets.MoveChip
import com.bluelytics.mobileapp.ui.widgets.MoveSlab
import com.bluelytics.mobileapp.ui.widgets.RateChart
import com.bluelytics.mobileapp.ui.widgets.Rise
import com.bluelytics.mobileapp.ui.widgets.ScaleDown
import com.bluelytics.mobileapp.ui.widgets.SectionHead
import com.bluelytics.mobileapp.ui.widgets.TapeItem
import com.bluelytics.mobileapp.ui.widgets.TickerTape
import com.bluelytics.mobileapp.ui.widgets.VerticalHairline
import com.bluelytics.mobileapp.ui.widgets.Wordmark
import com.bluelytics.mobileapp.ui.widgets.bladeShape
import com.bluelytics.mobileapp.ui.widgets.drawBlade
import com.bluelytics.mobileapp.ui.widgets.edges
import com.bluelytics.mobileapp.ui.widgets.pressable
import kotlinx.coroutines.launch

/** Opens the History tab in the given mode (from the official and gap tiles). */
@Composable
fun TodayScreen(strings: Strings, onOpenHistory: (ChartMode) -> Unit) {
    val store = LocalApp.current.store
    val state by store.state.collectAsStateWithLifecycle()
    val snapshot = remember(state.latest, state.series) { state.snapshot }
    if (snapshot?.latest?.blue == null) {
        Empty(state, store, strings)
        return
    }
    Content(state, store, snapshot, strings, onOpenHistory)
}

/** Nothing to show yet: the first load is running, or it failed with an empty cache. */
@Composable
private fun Empty(state: StoreState, store: AppStore, strings: Strings) {
    val scope = rememberCoroutineScope()
    val failed = state.offline && !state.loading
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        if (failed) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(strings.firstLoadFailed, textAlign = TextAlign.Center, style = BlType.h2())
                Spacer(Modifier.height(8.dp))
                Text(strings.firstLoadHint, textAlign = TextAlign.Center, style = BlType.body())
                Spacer(Modifier.height(24.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(2.dp))
                        .background(Bl.brand)
                        .pressable({ scope.launch { store.refresh(force = true) } }),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(strings.retry.uppercase(), Modifier.padding(horizontal = 22.dp, vertical = 14.dp), style = mono(12.5f, weight = 600, tracking = 0.12f, height = 1f))
                }
            }
        } else {
            Text(strings.loading.uppercase(), style = BlType.label())
        }
    }
}

private val extraOrder = listOf("mep", "ccl", "cripto", "tarjeta", "mayorista")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Content(state: StoreState, store: AppStore, snapshot: Snapshot, strings: Strings, onOpenHistory: (ChartMode) -> Unit) {
    val locale = strings.locale
    val latest = snapshot.latest
    val blue = latest.blue!!
    val oficial = latest.oficial
    val extras = extraOrder.flatMap { code -> state.extras.filter { it.code == code } }
    fun changeOf(move: Move?) = move?.let { formatSignedPercent(it.ratio, locale, 2) }
    val tape = buildList {
        add(TapeItem(strings.blue, formatPesos(blue.sell, locale), snapshot.blueMove?.direction, changeOf(snapshot.blueMove)))
        if (oficial != null) add(TapeItem(strings.oficial, formatPesos(oficial.sell, locale), snapshot.oficialMove?.direction, changeOf(snapshot.oficialMove)))
        latest.blueEuro?.let { add(TapeItem(strings.euroBlue, formatPesos(it.sell, locale))) }
        snapshot.gap?.let { add(TapeItem(strings.gap, formatPercent(it, locale))) }
        for (rate in extras) add(TapeItem(strings.extraName(rate.code), formatPesosCents(rate.sell, locale)))
    }
    val tiles = buildList<TileData> {
        if (oficial != null) {
            add(TileData(strings.oficial, formatPesos(oficial.sell, locale), snapshot.oficialMove, "${strings.buy} ${formatPesos(oficial.buy, locale)}") { onOpenHistory(ChartMode.rates) })
        }
        snapshot.gap?.let { add(TileData(strings.gapLong, formatPercent(it, locale), null, strings.gapFoot) { onOpenHistory(ChartMode.gap) }) }
        latest.blueEuro?.let { add(TileData(strings.euroBlue, formatPesos(it.sell, locale), null, "${strings.buy} ${formatPesos(it.buy, locale)}")) }
        latest.oficialEuro?.let { add(TileData(strings.euroOficial, formatPesos(it.sell, locale), null, "${strings.buy} ${formatPesos(it.buy, locale)}")) }
    }
    val chartDays = remember(state.recent) { rangeOf(state.recent, RangePreset.m1) }

    val scope = rememberCoroutineScope()
    var pulling by remember { mutableStateOf(false) }
    val pull = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = pulling,
        onRefresh = {
            pulling = true
            scope.launch {
                try {
                    store.refresh(force = true)
                } finally {
                    pulling = false
                }
            }
        },
        state = pull,
        modifier = Modifier.fillMaxSize(),
        indicator = {
            PullToRefreshDefaults.Indicator(state = pull, isRefreshing = pulling, modifier = Modifier.align(Alignment.TopCenter), containerColor = Bl.surface2, color = Bl.brandInk)
        },
    ) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 8.dp)) {
            TickerTape(tape, strings.allRates)
            Spacer(Modifier.height(20.dp))
            ContentWidth { Hero(strings, blue, snapshot, state.offline, chartDays) }
            if (tiles.isNotEmpty()) {
                Spacer(Modifier.height(28.dp))
                ContentWidth { TileGrid(tiles, locale) }
            }
            if (extras.isNotEmpty()) {
                Spacer(Modifier.height(36.dp))
                ContentWidth {
                    Column {
                        SectionHead(strings.otherRates, note = strings.otherRatesNote)
                        Spacer(Modifier.height(16.dp))
                        MiniGrid(extras.map { strings.extraName(it.code) to formatPesosCents(it.sell, locale) })
                    }
                }
            }
            Spacer(Modifier.height(36.dp))
            ContentWidth { QuickTable(blue, strings) }
            Spacer(Modifier.height(28.dp))
            ContentWidth { Text(strings.disclaimer, style = BlType.small()) }
            Spacer(Modifier.height(28.dp))
            Wordmark()
        }
    }
}

/**
 * The page's main quote in the social cards' language: the blade sweeps behind a very large sell
 * price, the move sits in a diagonal-cut slab, buy and average follow on a ruled ledger.
 */
@Composable
private fun Hero(strings: Strings, blue: Quote, snapshot: Snapshot, offline: Boolean, chartDays: List<DayRates>) {
    val locale = strings.locale
    val move = snapshot.blueMove
    val direction = move?.direction ?: Direction.flat
    val updatedAt = snapshot.latest.updatedAt
    val width = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp().value }.coerceAtMost(Bl.maxWidth.value)
    // The site's `clamp(4.6rem, 2.2rem + 12vw, 10.5rem)`.
    val figureSize = (35.2f + 0.12f * width).coerceIn(73.6f, 132f)
    val price = formatAmount(blue.sell, locale)
    val shape = RoundedCornerShape(Bl.radius)

    Box(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(HeroGradient)
            .border(1.dp, Bl.line, shape),
    ) {
        Sweep(direction, Modifier.matchParentSize())
        Column(Modifier.padding(start = 20.dp, top = 22.dp, end = 20.dp, bottom = 20.dp)) {
            Rise {
                Column {
                    Text(strings.todayTitle, Modifier.semantics { heading() }, style = sans(19f, weight = 700, color = Bl.soft, tracking = -0.02f, height = 1.15f))
                    if (updatedAt != null) {
                        Spacer(Modifier.height(8.dp))
                        Stamp(strings, formatDateTime(updatedAt, locale), offline)
                    }
                }
            }
            Spacer(Modifier.height(22.dp))
            Rise(delayMillis = 80) {
                Column {
                    Text(strings.sell.uppercase(), style = BlType.label())
                    Spacer(Modifier.height(6.dp))
                    ScaleDown(Modifier.clearAndSetSemantics { contentDescription = "${strings.sell} ${formatPesos(blue.sell, locale)}" }) {
                        Row {
                            Text(
                                "$",
                                Modifier.padding(top = (figureSize * 0.1f).dp, end = (figureSize * 0.1f).dp),
                                style = sans(figureSize * 0.36f, weight = 600, color = Bl.soft, height = 1f),
                            )
                            Text(
                                price,
                                maxLines = 1,
                                softWrap = false,
                                style = sans(figureSize, weight = 800, tracking = -0.065f, height = 0.9f, tabular = true)
                                    .copy(shadow = Shadow(Bl.ink.copy(alpha = 0.55f), Offset(0f, 2f), blurRadius = 30f)),
                            )
                        }
                    }
                    if (move != null) {
                        Spacer(Modifier.height(16.dp))
                        @OptIn(ExperimentalLayoutApi::class)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                            MoveSlab(move, locale)
                            snapshot.previousDay?.let { Text(strings.vsPrevious(formatDay(it, locale, short = true)), style = BlType.note()) }
                        }
                    }
                }
            }
            Spacer(Modifier.height(22.dp))
            Rise(delayMillis = 160) {
                Ledger(listOf(strings.buy to formatPesos(blue.buy, locale), strings.average to formatPesosCents(blue.average, locale)))
            }
            if (chartDays.size > 1) {
                Spacer(Modifier.height(22.dp))
                Rise(delayMillis = 240) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .background(Bl.ink.copy(alpha = 0.78f))
                            .border(1.dp, Bl.line)
                            .padding(start = 14.dp, top = 14.dp, end = 14.dp),
                    ) {
                        RateChart(
                            days = chartDays,
                            mode = ChartMode.rates,
                            locale = locale,
                            lineNames = mapOf(LineKey.blue to strings.blueShort, LineKey.oficial to strings.oficialShort),
                            emptyText = strings.noData,
                            height = 150.dp,
                            xTickCount = 3,
                        )
                    }
                }
            }
        }
    }
}

/** Flutter's `LinearGradient(begin: Alignment(-0.6, -1), end: Alignment(0.6, 1))`, navy to ink. */
private val HeroGradient: Brush = object : androidx.compose.ui.graphics.ShaderBrush() {
    override fun createShader(size: androidx.compose.ui.geometry.Size): androidx.compose.ui.graphics.Shader {
        val start = Offset(size.width * 0.2f, 0f)
        val end = Offset(size.width * 0.8f, size.height)
        return androidx.compose.ui.graphics.LinearGradientShader(start, end, listOf(Bl.navy, Bl.ink), listOf(0f, 0.78f))
    }
}

/** The blade, sweeping in once from the left. */
@Composable
private fun Sweep(direction: Direction, modifier: Modifier) {
    val still = LocalReducedMotion.current
    val progress = remember { Animatable(if (still) 1f else 0f) }
    LaunchedEffect(Unit) { if (progress.value < 1f) progress.animateTo(1f, tween(1100, easing = EaseOut)) }
    val shape = remember(direction) { bladeShape(direction) }
    Canvas(modifier) { drawBlade(shape, direction, progress.value) }
}

@Composable
private fun Stamp(strings: Strings, whenText: String, offline: Boolean) {
    val text = if (offline) "${strings.offline} · $whenText" else "${strings.updated} $whenText"
    Row(Modifier.background(Bl.ink.copy(alpha = 0.72f)).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        LiveDot(live = !offline)
        Spacer(Modifier.width(8.dp))
        Text(
            text.uppercase(),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = mono(11f, weight = 500, color = if (offline) Bl.warn else Bl.dim, tracking = 0.08f, height = 1.3f),
        )
    }
}

/** Two figures side by side under a strong rule, split by a hairline. */
@Composable
private fun Ledger(entries: List<Pair<String, String>>) {
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).edges(Bl.lineStrong, top = 1.dp)) {
        entries.forEachIndexed { i, (label, value) ->
            if (i > 0) VerticalHairline(Modifier.fillMaxHeight())
            Column(Modifier.weight(1f).padding(top = 12.dp, start = if (i > 0) 18.dp else 0.dp).semantics(mergeDescendants = true) {}) {
                Text(label.uppercase(), style = BlType.label())
                Spacer(Modifier.height(4.dp))
                FitText(value, sans(25f, weight = 700, tracking = -0.04f, height = 1.15f, tabular = true))
            }
        }
    }
}

private class TileData(val label: String, val value: String, val move: Move?, val foot: String?, val onTap: (() -> Unit)? = null)

/** A ruled ledger entry for one rate. */
@Composable
private fun Tile(tile: TileData, locale: AppLocale, modifier: Modifier) {
    val base = if (tile.onTap != null) modifier.pressable(tile.onTap) else modifier.semantics(mergeDescendants = true) {}
    Column(base) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(tile.label.uppercase(), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = BlType.label())
            if (tile.onTap != null) GlyphIcon(Glyph.arrowRight, 14.dp, Bl.dim, stroke = 1.4f)
        }
        Spacer(Modifier.height(8.dp))
        FitText(tile.value, sans(30f, weight = 750, tracking = -0.045f, height = 1.1f, tabular = true))
        if (tile.move != null) {
            Spacer(Modifier.height(8.dp))
            MoveChip(tile.move, locale)
        }
        if (tile.foot != null) {
            Spacer(Modifier.height(8.dp))
            Text(tile.foot, style = mono(12f, weight = 500, color = Bl.dim, height = 1.3f))
        }
    }
}

/** Tiles two to a row, ruled like a ledger page. */
@Composable
private fun TileGrid(tiles: List<TileData>, locale: AppLocale) {
    Column(Modifier.fillMaxWidth().edges(Bl.lineStrong, top = 1.dp)) {
        for (pair in tiles.chunked(2)) {
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).edges(Bl.line, bottom = 1.dp)) {
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    Tile(pair[0], locale, Modifier.fillMaxSize().padding(start = 0.dp, top = 18.dp, end = 14.dp, bottom = 18.dp))
                }
                VerticalHairline(Modifier.fillMaxHeight())
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    if (pair.size > 1) Tile(pair[1], locale, Modifier.fillMaxSize().padding(start = 16.dp, top = 18.dp, end = 0.dp, bottom = 18.dp))
                }
            }
        }
    }
}

/** Small reference rates two to a row: a brand rule on the left and a wash fading right. */
@Composable
private fun MiniGrid(items: List<Pair<String, String>>) {
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val gap = 10.dp
        val cell = (maxWidth - gap) / 2
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(gap), verticalArrangement = Arrangement.spacedBy(gap)) {
            for ((label, value) in items) {
                Column(
                    Modifier
                        .width(cell)
                        .semantics(mergeDescendants = true) {}
                        .background(Brush.horizontalGradient(listOf(Bl.brandDeep.copy(alpha = 0.12f), Bl.brandDeep.copy(alpha = 0f))))
                        .edges(Bl.brandDeep, left = 2.dp)
                        .padding(start = 12.dp, top = 10.dp, end = 8.dp, bottom = 10.dp),
                ) {
                    Text(label.uppercase(), maxLines = 1, overflow = TextOverflow.Ellipsis, style = BlType.label())
                    Spacer(Modifier.height(4.dp))
                    FitText(value, sans(20f, weight = 700, tracking = -0.03f, height = 1.2f, tabular = true))
                }
            }
        }
    }
}

/** What 1 to 1,000 dollars come to at the blue rate. */
@Composable
private fun QuickTable(blue: Quote, strings: Strings) {
    val locale = strings.locale
    @Composable
    fun row(a: String, b: String, c: String, head: Boolean) {
        val style = if (head) BlType.label() else mono(13.5f, weight = 500, color = Bl.text, height = 1.3f)
        Row(
            Modifier
                .fillMaxWidth()
                .edges(if (head) Bl.lineStrong else Bl.line, bottom = 1.dp)
                .padding(vertical = 11.dp)
                .semantics(mergeDescendants = true) {},
        ) {
            Text(a, Modifier.weight(3f), style = if (head) style else mono(13.5f, weight = 500, color = Bl.soft, height = 1.3f))
            Text(b, Modifier.weight(4f), textAlign = TextAlign.End, style = style)
            Text(c, Modifier.weight(4f), textAlign = TextAlign.End, style = style)
        }
    }
    Column(Modifier.fillMaxWidth()) {
        SectionHead(strings.quickTitle)
        Spacer(Modifier.height(14.dp))
        Hairline(strong = true)
        row("USD", strings.ifYouBuy.uppercase(), strings.ifYouSell.uppercase(), head = true)
        for (amount in listOf(1L, 10L, 100L, 500L, 1000L)) {
            row(
                "US$${if (locale == AppLocale.es) NBSP else ""}${formatInteger(amount, locale)}",
                formatPesos(amount * blue.sell, locale),
                formatPesos(amount * blue.buy, locale),
                head = false,
            )
        }
        Spacer(Modifier.height(12.dp))
        Text(strings.quickNote, style = BlType.small())
    }
}
