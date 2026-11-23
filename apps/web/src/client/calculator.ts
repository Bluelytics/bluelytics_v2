/** `<bl-calc>` (two-way ARS ⇄ USD/EUR/any `currency.json` currency converter) and `<bl-gap>` (gap for an amount of dollars). */
import type { Locale } from '../i18n/routes.ts';
import { crossRateHundredths, displayUnits, parseAmount, toForeignHundredths, toPesosHundredths, type CalcCurrency, type CalcRates, type PriceKind } from '../lib/calc.ts';
import { formatHundredths, formatPesosHundredths } from '../lib/format.ts';

const TEXT = {
  es: {
    usd: 'Dólares (USD)',
    eur: 'Euros (EUR)',
    blue: 'dólar blue',
    oficial: 'dólar oficial',
    buy: 'precio de compra',
    average: 'promedio entre compra y venta',
    sell: 'precio de venta',
    missing: 'Sin cotización disponible',
  },
  en: {
    usd: 'Dollars (USD)',
    eur: 'Euros (EUR)',
    blue: 'blue dollar',
    oficial: 'official dollar',
    buy: 'buy price',
    average: 'average of buy and sell',
    sell: 'sell price',
    missing: 'No rate available',
  },
} as const;

class Calculator extends HTMLElement {
  connectedCallback(): void {
    const rates = JSON.parse(this.dataset['rates'] ?? '{}') as CalcRates;
    const currencies = new Map((JSON.parse(this.dataset['currencies'] ?? '[]') as CalcCurrency[]).map((c) => [c.code, c]));
    const locale = (this.dataset['locale'] ?? 'es') as Locale;
    const text = TEXT[locale];
    const foreign = this.querySelector<HTMLInputElement>('input[name=foreign]');
    const ars = this.querySelector<HTMLInputElement>('input[name=ars]');
    // typed by what is used: this build's DOM lib has no HTMLSelectElement
    const moneda = this.querySelector('select[name=moneda]') as (HTMLElement & { value: string }) | null;
    const foreignLabel = this.querySelector<HTMLElement>('[data-foreign-label]');
    const result = this.querySelector<HTMLElement>('[data-result]');
    if (!foreign || !ars || !moneda || !foreignLabel || !result) return;

    const choice = (name: string): string => this.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)?.value ?? '';
    /** Hundredths of a peso per unit of the selected currency; USD and EUR use the published rates. */
    const currentRate = (): number | null => {
      const tipo = choice('tipo') as keyof CalcRates;
      const precio = choice('precio') as PriceKind;
      const code: string = moneda.value;
      if (code === 'usd' || code === 'eur') return rates[tipo]?.[code]?.[precio] ?? null;
      const usd = rates[tipo]?.usd?.[precio];
      const currency = currencies.get(code);
      return usd === undefined || currency === undefined ? null : crossRateHundredths(usd, currency.perUsdHundredths);
    };
    const currencyLabel = (code: string): string => {
      if (code === 'usd' || code === 'eur') return text[code];
      const currency = currencies.get(code);
      return currency ? `${currency.name} (${currency.code})` : code;
    };

    // Which field the user typed in last decides the direction of the conversion.
    let source: 'foreign' | 'ars' = 'foreign';
    const update = (): void => {
      const rate = currentRate();
      foreignLabel.textContent = currencyLabel(moneda.value);
      if (rate === null) {
        result.textContent = text.missing;
        return;
      }
      const tipo = choice('tipo') as 'blue' | 'oficial';
      const units = displayUnits(rate);
      const unitsText = units === 1 ? '1' : formatHundredths(units * 100, locale).replace(/[.,]00$/, '');
      const via = moneda.value === 'usd' || moneda.value === 'eur' ? '' : locale === 'es' ? ' (vía dólar)' : ' (via the dollar)';
      result.textContent = `${unitsText} ${moneda.value.toUpperCase()} = ${formatPesosHundredths(Math.round(rate * units), locale)} · ${text[tipo]}, ${text[choice('precio') as PriceKind]}${via}`;
      if (source === 'foreign') {
        const amount = parseAmount(foreign.value, locale);
        ars.value = amount === null ? '' : formatHundredths(toPesosHundredths(amount, rate), locale);
      } else {
        const amount = parseAmount(ars.value, locale);
        foreign.value = amount === null ? '' : formatHundredths(toForeignHundredths(amount, rate), locale);
      }
    };

    foreign.addEventListener('input', () => {
      source = 'foreign';
      update();
    });
    ars.addEventListener('input', () => {
      source = 'ars';
      update();
    });
    this.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement;
      if (target.type === 'radio' || (target as unknown) === moneda) update();
    });
  }
}

class GapCalculator extends HTMLElement {
  connectedCallback(): void {
    const diff = Number(this.dataset['diff']);
    const locale = (this.dataset['locale'] ?? 'es') as Locale;
    const input = this.querySelector('input');
    const output = this.querySelector<HTMLElement>('[data-output]');
    if (!input || !output || !Number.isFinite(diff)) return;
    input.addEventListener('input', () => {
      const amount = parseAmount(input.value, locale);
      output.textContent = amount === null ? '–' : formatPesosHundredths(Math.round(amount * diff * 100), locale);
    });
  }
}

export function defineCalculator(): void {
  if (!customElements.get('bl-calc')) customElements.define('bl-calc', Calculator);
}

export function defineGapCalculator(): void {
  if (!customElements.get('bl-gap')) customElements.define('bl-gap', GapCalculator);
}
