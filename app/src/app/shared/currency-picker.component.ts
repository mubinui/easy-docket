import { Component, computed, input, output } from '@angular/core';
import { IonIcon } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { checkmarkOutline, closeOutline } from 'ionicons/icons';
import { COMMON_CURRENCIES, currencyInfo } from '../core/money/currencies';

/**
 * Choosing a currency: an inset grouped list, one tap to commit.
 *
 * A code on its own asks the reader to already know that BDT is the taka, so
 * each row carries the symbol and the name as well. Selection is a checkmark on
 * the trailing edge rather than a tinted row, and there is no OK button: with a
 * single choice to make, confirming it is a second tap that decides nothing.
 *
 * Deliberately not an `ion-select`. The select's alert renders each option as
 * one line of unstyled text, which leaves no room for the symbol and the name
 * that make the list scannable, and it stacks a radio column and two buttons
 * around a choice that needs neither.
 *
 * Laid out as a self-sizing panel rather than a header over `ion-content`, so
 * the sheet it opens in can hug the list instead of taking the whole screen.
 */
@Component({
  selector: 'app-currency-picker',
  standalone: true,
  imports: [IonIcon],
  styles: [
    `
      :host {
        display: block;
        background: var(--ion-background-color);
      }
      header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 18px 16px 12px;
      }
      h2 {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-size: 17px;
        font-weight: 650;
        letter-spacing: -0.02em;
      }
      .close {
        flex: none;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: var(--docket-sidebar);
        color: var(--docket-secondary);
        font-size: 15px;
        cursor: pointer;
      }
      /*
       * The house inset group, with the rounding on the scrolling box rather
       * than on the rows inside it: a radius on the inner group scrolls out of
       * view, leaving a scrolled list cut off square at the top.
       */
      .scroller {
        max-height: min(64vh, 544px);
        margin: 0 16px;
        border-radius: var(--docket-radius);
        background: var(--ion-item-background);
        box-shadow: var(--docket-surface-light), var(--docket-elevation);
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
        /* An iOS list shows no rail; the cut rows are the scroll affordance. */
        scrollbar-width: none;
      }
      .scroller::-webkit-scrollbar {
        display: none;
      }
      .row {
        position: relative;
        display: grid;
        grid-template-columns: 26px 1fr auto auto;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 48px;
        padding: 0 14px;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      /*
       * Separators start at the text origin rather than the row edge, which is
       * what makes a grouped list read as one surface with rows in it instead
       * of a stack of boxes. 52px is the padding plus the symbol column plus
       * its gap.
       */
      .row + .row::before {
        content: '';
        position: absolute;
        top: 0;
        inset-inline-start: 52px;
        inset-inline-end: 0;
        height: 1px;
        background: var(--ion-border-color);
      }
      .sym {
        justify-self: center;
        color: var(--docket-secondary);
        font-size: 15px;
        line-height: 1;
      }
      .name {
        min-width: 0;
        font-size: 15px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .code {
        color: var(--docket-secondary);
        font-size: 13px;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.01em;
      }
      .tick {
        width: 16px;
        font-size: 16px;
        color: var(--ion-color-primary);
      }
      .row:active {
        background: var(--docket-hover);
      }
      .footnote {
        margin: 0;
        padding: 16px 20px 20px;
        color: var(--docket-secondary);
        font-size: 12px;
        line-height: 1.55;
      }
      .row:focus-visible {
        outline: 3px solid var(--ion-color-primary);
        outline-offset: -3px;
        border-radius: 8px;
      }
      @media (hover: hover) and (pointer: fine) {
        .row:hover {
          background: var(--docket-hover);
        }
        .close:hover {
          background: var(--docket-hover);
        }
      }
    `,
  ],
  template: `
    <header>
      <h2>{{ heading() }}</h2>
      <button type="button" class="close" aria-label="Close" (click)="dismissed.emit()">
        <ion-icon name="close-outline" aria-hidden="true" />
      </button>
    </header>

    <div class="scroller">
      <div class="rows" role="radiogroup" [attr.aria-label]="heading()">
        @for (entry of options(); track entry.code) {
          <button
            type="button"
            class="row"
            role="radio"
            [attr.aria-checked]="entry.code === selected()"
            (click)="pick(entry.code)"
          >
            <span class="sym" aria-hidden="true">{{ entry.symbol }}</span>
            <span class="name">{{ entry.name || entry.code }}</span>
            <span class="code">{{ entry.code }}</span>
            <ion-icon
              class="tick"
              name="checkmark-outline"
              aria-hidden="true"
              [style.visibility]="entry.code === selected() ? 'visible' : 'hidden'"
            />
          </button>
        }
      </div>
    </div>

    @if (footnote()) {
      <p class="footnote">{{ footnote() }}</p>
    }
  `,
})
export class CurrencyPickerComponent {
  readonly heading = input('Currency');
  readonly selected = input<string | null>(null);

  /** One short line about what the choice affects, shown under the list. */
  readonly footnote = input('');

  /**
   * Codes to offer beyond the common set, listed first.
   *
   * The rates screen passes the currencies the vault's accounts are actually
   * held in, which may be anything that was typed.
   */
  readonly extra = input<readonly string[]>([]);

  readonly picked = output<string>();
  readonly dismissed = output<void>();

  readonly options = computed(() => {
    const codes = [...new Set([...this.extra(), ...COMMON_CURRENCIES])];
    return codes.map(currencyInfo);
  });

  pick(code: string): void {
    this.picked.emit(code);
    this.dismissed.emit();
  }

  constructor() {
    addIcons({ checkmarkOutline, closeOutline });
  }
}
