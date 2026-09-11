import { Pipe, PipeTransform } from '@angular/core';
import { toIsoDate } from '../core/util/dates';

/**
 * Renders a `YYYY-MM-DD` ledger date as a human heading, using "Today" and
 * "Yesterday" for the two dates people scan for most often.
 */
@Pipe({ name: 'day', standalone: true })
export class DayPipe implements PipeTransform {
  transform(date: string): string {
    const today = toIsoDate();
    if (date === today) return 'Today';

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date === toIsoDate(yesterday)) return 'Yesterday';

    // Parsed with an explicit local time so the label cannot slip a day in
    // timezones behind UTC.
    return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
    });
  }
}
