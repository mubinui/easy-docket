import { Pipe, PipeTransform } from '@angular/core';
import { Minor } from '../core/models/domain';
import { formatMoney } from '../core/util/money';

/** Renders minor units as localised currency: `{{ 1234 | money: 'USD' }}` → `$12.34`. */
@Pipe({ name: 'money', standalone: true })
export class MoneyPipe implements PipeTransform {
  transform(amount: Minor | null | undefined, currency = 'USD'): string {
    return formatMoney(amount ?? 0, currency);
  }
}
