/** `<bl-calc>` (two-way ARS ⇄ USD/EUR converter) and `<bl-gap>` (gap for an amount of dollars). */
import type { Locale } from '../i18n/routes.ts';
import { parseAmount, toForeignHundredths, toPesosHundredths, type CalcRates, type PriceKind } from '../lib/calc.ts';
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
    const locale = (this.dataset['locale'] ?? 'es') as Locale;
    const text = TEXT[locale];
    const foreign = this.querySelector<HTMLInputElement>('input[name=foreign]');
    const ars = this.querySelector<HTMLInputElement>('input[name=ars]');
    const foreignLabel = this.querySelector<HTMLElement>('[data-foreign-label]');
    const result = this.querySelector<HTMLElement>('[data-result]');
    if (!foreign || !ars || !foreignLabel || !result) return;

    const choice = (name: string): string => this.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)?.value ?? '';
    const currentRate = (): number | null => {
      const tipo = choice('tipo') as keyof CalcRates;
      const moneda = choice('moneda') as 'usd' | 'eur';
      return rates[tipo]?.[moneda]?.[choice('precio') as PriceKind] ?? null;
    };

    // Which field the user typed in last decides the direction of the conversion.
    let source: 'foreign' | 'ars' = 'foreign';
    const update = (): void => {
      const rate = currentRate();
      const moneda = choice('moneda') as 'usd' | 'eur';
      foreignLabel.textContent = text[moneda];
      if (rate === null) {
        result.textContent = text.missing;
        return;
      }
      const tipo = choice('tipo') as 'blue' | 'oficial';
      result.textContent = `1 ${moneda.toUpperCase()} = ${formatPesosHundredths(rate, locale)} · ${text[tipo]}, ${text[choice('precio') as PriceKind]}`;
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
      if ((event.target as HTMLInputElement).type === 'radio') update();
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
