/*
 * Calculator: an amount of any currency in pesos (or pesos in that currency) at the blue and the
 * official rate, buy and sell at once.
 */
package com.bluelytics.mobileapp.ui.screens

import android.content.ClipData
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.InputTransformation
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import com.bluelytics.mobileapp.ui.theme.Text
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.bluelytics.mobileapp.domain.AppLocale
import com.bluelytics.mobileapp.domain.CalcCurrency
import com.bluelytics.mobileapp.domain.CurrencyGroup
import com.bluelytics.mobileapp.domain.NBSP
import com.bluelytics.mobileapp.domain.Quote
import com.bluelytics.mobileapp.domain.calcCurrencies
import com.bluelytics.mobileapp.domain.formatForeign
import com.bluelytics.mobileapp.domain.formatInteger
import com.bluelytics.mobileapp.domain.formatPesos
import com.bluelytics.mobileapp.domain.matchesCurrency
import com.bluelytics.mobileapp.domain.parseAmount
import com.bluelytics.mobileapp.domain.rateFor
import com.bluelytics.mobileapp.domain.toForeignHundredths
import com.bluelytics.mobileapp.domain.toPesosHundredths
import com.bluelytics.mobileapp.i18n.Strings
import com.bluelytics.mobileapp.ui.LocalApp
import com.bluelytics.mobileapp.ui.theme.Bl
import com.bluelytics.mobileapp.ui.theme.BlType
import com.bluelytics.mobileapp.ui.theme.lineBox
import com.bluelytics.mobileapp.ui.theme.mono
import com.bluelytics.mobileapp.ui.theme.sans
import com.bluelytics.mobileapp.ui.widgets.ContentWidth
import com.bluelytics.mobileapp.ui.widgets.FitText
import com.bluelytics.mobileapp.ui.widgets.Glyph
import com.bluelytics.mobileapp.ui.widgets.GlyphIcon
import com.bluelytics.mobileapp.ui.widgets.Hairline
import com.bluelytics.mobileapp.ui.widgets.Panel
import com.bluelytics.mobileapp.ui.widgets.SectionHead
import com.bluelytics.mobileapp.ui.widgets.VerticalHairline
import com.bluelytics.mobileapp.ui.widgets.edges
import com.bluelytics.mobileapp.ui.widgets.pressable
import kotlinx.coroutines.launch

/** Digits and the two separators, at most 15 characters. */
private val AmountInput = InputTransformation {
    val typed = asCharSequence()
    val kept = typed.filter { it.isDigit() || it == '.' || it == ',' }.take(15)
    if (kept.length != typed.length) replace(0, length, kept)
}

/** The amount field, for tests. */
const val AMOUNT_FIELD_TAG = "amount"
const val CURRENCY_SEARCH_TAG = "currency-search"

@Composable
fun CalculatorScreen(strings: Strings) {
    val store = LocalApp.current.store
    val state by store.state.collectAsStateWithLifecycle()
    val amountField = rememberTextFieldState("100")
    val amountText = amountField.text.toString()
    var code by rememberSaveable { mutableStateOf("USD") }
    // `false`: the amount is in the chosen currency and the results in pesos. `true`: the reverse.
    var fromPesos by rememberSaveable { mutableStateOf(false) }
    var copied by remember { mutableStateOf<String?>(null) }
    var picking by rememberSaveable { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val clipboard = LocalClipboard.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()

    val locale = strings.locale
    val latest = state.latest
    val currencies = remember(state.currencies, locale) { calcCurrencies(state.currencies, locale) }
    val currency = currencies.firstOrNull { it.code == code } ?: currencies.first()
    val amount = parseAmount(amountText, locale)
    val inputSign = if (fromPesos) "$" else currency.sign

    // A new amount clears the "copied" mark.
    LaunchedEffect(amountField) { snapshotFlow { amountField.text.toString() }.collect { copied = null } }

    fun copy(text: String) {
        scope.launch {
            clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("Bluelytics", text.replace(NBSP, " "))))
        }
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        copied = text
    }

    Column(
        Modifier
            .fillMaxSize()
            .pointerInput(Unit) { detectTapGestures { focus.clearFocus() } }
            .verticalScroll(rememberScrollState())
            .padding(bottom = 40.dp),
    ) {
        ContentWidth {
            Column {
                Spacer(Modifier.height(24.dp))
                Text(strings.calcTitle, Modifier.semantics { heading() }, style = BlType.h1())
                Spacer(Modifier.height(8.dp))
                Text(strings.calcLead, style = BlType.body())
                Spacer(Modifier.height(22.dp))
                Panel(padding = PaddingValues(start = 16.dp, top = 14.dp, end = 16.dp, bottom = 16.dp)) {
                    Column {
                        Text("${strings.amount} · ${if (fromPesos) "ARS" else currency.code}".uppercase(), style = BlType.label())
                        Spacer(Modifier.height(2.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(inputSign, style = sans(22f, weight = 600, color = Bl.soft, height = 1f))
                            Spacer(Modifier.width(10.dp))
                            val fieldStyle = sans(44f, weight = 800, tracking = -0.05f, height = 1.1f, tabular = true)
                            BasicTextField(
                                state = amountField,
                                modifier = Modifier.weight(1f).semantics { contentDescription = strings.amount }.testTag(AMOUNT_FIELD_TAG).lineBox(fieldStyle),
                                inputTransformation = AmountInput,
                                textStyle = fieldStyle,
                                lineLimits = TextFieldLineLimits.SingleLine,
                                cursorBrush = SolidColor(Bl.brandInk),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = ImeAction.Done, autoCorrectEnabled = false),
                                onKeyboardAction = { focus.clearFocus() },
                                decorator = { inner ->
                                    Box {
                                        if (amountField.text.isEmpty()) Text("0", style = fieldStyle.copy(color = Bl.dim.copy(alpha = 0.4f)))
                                        inner()
                                    }
                                },
                            )
                        }
                        Spacer(Modifier.height(12.dp))
                        Hairline(strong = true)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Row(
                                Modifier
                                    .weight(1f)
                                    .pressable({
                                        focus.clearFocus()
                                        picking = true
                                    }, label = "${strings.currency}: ${currency.name} (${currency.code})", minHeight = 56.dp)
                                    .padding(vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(strings.currency.uppercase(), style = BlType.label())
                                    Spacer(Modifier.height(3.dp))
                                    Text("${currency.code} · ${currency.name}", maxLines = 2, overflow = TextOverflow.Ellipsis, style = sans(16f, weight = 600, height = 1.25f))
                                }
                                GlyphIcon(Glyph.chevronDown, 18.dp, Bl.brandInk)
                                Spacer(Modifier.width(12.dp))
                            }
                            VerticalHairline(Modifier.height(56.dp))
                            Row(
                                Modifier
                                    .pressable({
                                        fromPesos = !fromPesos
                                        copied = null
                                    }, label = "${strings.swap}: ${if (fromPesos) strings.toPesos else strings.fromPesos}", minHeight = 56.dp)
                                    .padding(start = 14.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                GlyphIcon(Glyph.swap, 18.dp, Bl.brandInk)
                                Spacer(Modifier.width(8.dp))
                                Text(strings.swap.uppercase(), style = mono(11.5f, weight = 600, color = Bl.soft, tracking = 0.1f, height = 1f))
                            }
                        }
                    }
                }
                Spacer(Modifier.height(10.dp))
                Text(
                    (if (fromPesos) "${strings.pesos} → ${currency.name}" else "${currency.name} → ${strings.pesos}").uppercase(),
                    style = BlType.label(color = Bl.brandInk),
                )
                Spacer(Modifier.height(26.dp))
                if (amount == null) {
                    Text(strings.enterAmount, style = BlType.body(color = Bl.dim))
                } else {
                    Result(strings.blue, quoteFor(currency, latest?.blue, latest?.blueEuro), currency, amount, fromPesos, strings, copied, ::copy)
                    Spacer(Modifier.height(26.dp))
                    Result(strings.oficial, quoteFor(currency, latest?.oficial, latest?.oficialEuro), currency, amount, fromPesos, strings, copied, ::copy)
                }
                if (currency.group != CurrencyGroup.main) {
                    Spacer(Modifier.height(20.dp))
                    Text(strings.viaDollar, style = BlType.small())
                }
            }
        }
    }

    if (picking) {
        CurrencySheet(currencies, code, strings, onClose = { picking = false }) { chosen ->
            code = chosen
            copied = null
            picking = false
        }
    }
}

/** Hundredths of a peso per unit of `currency`, buying and selling. */
private fun quoteFor(currency: CalcCurrency, usd: Quote?, eur: Quote?): Pair<Double, Double>? {
    val buy = rateFor(currency, usd?.buy, eur?.buy)
    val sell = rateFor(currency, usd?.sell, eur?.sell)
    return if (buy == null || sell == null) null else buy to sell
}

/** A rate as text: whole pesos for a dollar, and enough units to be worth a peso for small currencies (`1.000 IDR = $ 93,80`). */
private fun rateLine(rateHundredths: Double, currency: CalcCurrency, locale: AppLocale): String {
    var units = 1L
    while (rateHundredths * units < 100 && units < 1_000_000_000) units *= 10
    return "${formatInteger(units, locale)} ${currency.code} = ${formatPesos(Math.round(rateHundredths * units), locale)}"
}

/** The conversion at one rate (blue or official): what buying costs and what selling pays. */
@Composable
private fun Result(
    title: String,
    quote: Pair<Double, Double>?,
    currency: CalcCurrency,
    amount: Double,
    fromPesos: Boolean,
    strings: Strings,
    copied: String?,
    onCopy: (String) -> Unit,
) {
    val locale = strings.locale
    Column(Modifier.fillMaxWidth()) {
        SectionHead(title)
        Spacer(Modifier.height(12.dp))
        Hairline(strong = true)
        if (quote == null) {
            Text(strings.noData, Modifier.padding(vertical = 14.dp), style = BlType.body(color = Bl.dim))
            return@Column
        }
        val (buy, sell) = quote
        fun convert(rate: Double) =
            if (fromPesos) formatForeign(toForeignHundredths(amount, rate), currency.sign, locale) else formatPesos(toPesosHundredths(amount, rate), locale)
        for ((label, value, note) in listOf(Triple(strings.youPay, convert(sell), rateLine(sell, currency, locale)), Triple(strings.youGet, convert(buy), rateLine(buy, currency, locale)))) {
            val done = copied == value
            Column(
                Modifier
                    .fillMaxWidth()
                    .pressable({ onCopy(value) }, label = "$label: $value. ${if (done) "✓ ${strings.copied}" else note}")
                    .edges(Bl.line, bottom = 1.dp)
                    .padding(vertical = 12.dp),
            ) {
                Text(label.uppercase(), style = BlType.label())
                Spacer(Modifier.height(4.dp))
                FitText(value, sans(30f, weight = 750, tracking = -0.045f, height = 1.15f, tabular = true))
                Spacer(Modifier.height(4.dp))
                Text(if (done) "✓ ${strings.copied}" else note, style = BlType.note(color = if (done) Bl.up else Bl.dim))
            }
        }
    }
}

/** The currency picker: search on top, then the dollar and the euro, the Americas, and the rest. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CurrencySheet(currencies: List<CalcCurrency>, selected: String, strings: Strings, onClose: () -> Unit, onPick: (String) -> Unit) {
    // Straight to full height: no half-open stop.
    val sheet = rememberBottomSheetState(initialValue = SheetValue.Hidden, enabledValues = setOf(SheetValue.Hidden, SheetValue.Expanded))
    val scope = rememberCoroutineScope()
    val search = rememberTextFieldState()
    val query = search.text.toString()
    fun dismiss(then: () -> Unit) {
        scope.launch { sheet.hide() }.invokeOnCompletion { then() }
    }
    ModalBottomSheet(
        onDismissRequest = onClose,
        sheetState = sheet,
        containerColor = Bl.surface,
        contentColor = Bl.text,
        scrimColor = Bl.ink.copy(alpha = 0.7f),
        shape = RoundedCornerShape(topStart = Bl.radius, topEnd = Bl.radius),
        dragHandle = null,
    ) {
        val matches = currencies.filter { matchesCurrency(it, query) }
        Column(Modifier.fillMaxHeight(0.88f).imePadding()) {
            Row(Modifier.padding(start = Bl.gutter, top = 18.dp, end = 6.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(strings.chooseCurrency, Modifier.weight(1f).semantics { heading() }, style = BlType.h2())
                Box(Modifier.pressable({ dismiss(onClose) }, label = strings.close).padding(11.dp), contentAlignment = Alignment.Center) {
                    GlyphIcon(Glyph.close, 20.dp, Bl.soft)
                }
            }
            Row(
                Modifier
                    .padding(horizontal = Bl.gutter)
                    .fillMaxWidth()
                    .background(Bl.ink.copy(alpha = 0.6f), RoundedCornerShape(2.dp))
                    .border(1.dp, Bl.lineStrong, RoundedCornerShape(2.dp))
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GlyphIcon(Glyph.search, 18.dp, Bl.dim)
                Spacer(Modifier.width(10.dp))
                val style = sans(16f, height = 1.3f)
                BasicTextField(
                    state = search,
                    modifier = Modifier.weight(1f).padding(vertical = 14.dp).semantics { contentDescription = strings.searchCurrency }.testTag(CURRENCY_SEARCH_TAG),
                    textStyle = style,
                    lineLimits = TextFieldLineLimits.SingleLine,
                    cursorBrush = SolidColor(Bl.brandInk),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search, autoCorrectEnabled = false, capitalization = KeyboardCapitalization.None),
                    decorator = { inner ->
                        Box {
                            if (query.isEmpty()) Text(strings.searchCurrency, style = style.copy(color = Bl.dim), maxLines = 1)
                            inner()
                        }
                    },
                )
            }
            Spacer(Modifier.height(6.dp))
            if (matches.isEmpty()) {
                Text(strings.noMatches, Modifier.padding(Bl.gutter), style = BlType.body(color = Bl.dim))
            } else {
                LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(bottom = 24.dp)) {
                    var group: CurrencyGroup? = null
                    for (currency in matches) {
                        if (currency.group != group) {
                            group = currency.group
                            val title = when (currency.group) {
                                CurrencyGroup.main -> strings.groupMain
                                CurrencyGroup.americas -> strings.groupAmericas
                                CurrencyGroup.other -> strings.groupOther
                            }
                            item(key = "group-${currency.group}") {
                                Text(
                                    title.uppercase(),
                                    Modifier.padding(start = Bl.gutter, top = 18.dp, end = Bl.gutter, bottom = 8.dp).semantics { heading() },
                                    style = BlType.label(color = Bl.brandInk),
                                )
                            }
                        }
                        item(key = currency.code) {
                            val active = currency.code == selected
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .pressable({ dismiss { onPick(currency.code) } }, label = "${currency.name} (${currency.code})", selected = active, minHeight = 48.dp)
                                    .background(if (active) Bl.brand.copy(alpha = 0.16f) else androidx.compose.ui.graphics.Color.Transparent)
                                    .edges(Bl.line, bottom = 1.dp)
                                    .padding(horizontal = Bl.gutter, vertical = 13.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    currency.code,
                                    Modifier.width(52.dp),
                                    style = mono(13f, weight = 600, color = if (active) Bl.text else Bl.brandInk, tracking = 0.04f, height = 1.2f),
                                )
                                Text(
                                    currency.name,
                                    Modifier.weight(1f),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    style = sans(15.5f, weight = if (active) 600 else 400, color = if (active) Bl.text else Bl.soft, height = 1.25f),
                                )
                                if (active) GlyphIcon(Glyph.check, 18.dp, Bl.up)
                            }
                        }
                    }
                }
            }
        }
    }
}
