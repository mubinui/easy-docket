import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, input, output, signal } from '@angular/core';
import { IonIcon, IonModal } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronExpandOutline } from 'ionicons/icons';
import { currencyInfo } from '../core/money/currencies';
import { CurrencyPickerComponent } from './currency-picker.component';

/**
 * The currency form control: what is chosen now, and the picker that changes it.
 *
 * Two shapes, matching the fields it stands beside. `outline` draws the notched
 * border the vault's inputs use, through a real `fieldset` and `legend` so the
 * label punches a hole in the border rather than painting over it with a
 * guessed background colour. Inside an `ion-item` it is a stacked label with no
 * border of its own, because the item already draws one.
 */
@Component({
  selector: 'app-currency-field',
  standalone: true,
  imports: [CurrencyPickerComponent, IonIcon, IonModal, NgTemplateOutlet],
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      fieldset {
        margin: 0;
        padding: 0 10px 0 6px;
        border: 1px solid var(--docket-line);
        border-radius: 10px;
        background: transparent;
        min-inline-size: 0;
      }
      legend {
        padding-inline: 5px;
        margin-inline-start: 6px;
        color: var(--docket-secondary);
        font-size: 12px;
        line-height: 1;
      }
      /* Stacked mode has no border to notch, so the label is just a row above. */
      .stacked-label {
        display: block;
        margin-bottom: 3px;
        font-size: 11.25px;
        color: var(--ion-text-color);
      }
      .trigger {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
        min-height: 40px;
      }
      fieldset .trigger {
        padding: 0 4px 10px;
        min-height: 34px;
      }
      .code {
        font-size: 15px;
        font-weight: 500;
        letter-spacing: -0.005em;
      }
      .name {
        flex: 1;
        min-width: 0;
        color: var(--docket-secondary);
        font-size: 13.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .chevron {
        flex: none;
        font-size: 16px;
        color: var(--docket-secondary);
      }
      .trigger:disabled {
        cursor: default;
      }
      .trigger:disabled .code,
      .trigger:disabled .name,
      .trigger:disabled .chevron {
        opacity: 0.55;
      }
      .trigger:focus-visible {
        outline: 3px solid var(--ion-color-primary);
        outline-offset: 3px;
        border-radius: 8px;
      }
      @media (hover: hover) and (pointer: fine) {
        .trigger:not(:disabled):hover .code {
          color: var(--ion-color-primary);
        }
      }
      ion-modal.currency-sheet {
        --width: min(460px, calc(100vw - 24px));
        --height: auto;
        --max-height: calc(100dvh - 64px);
        --border-radius: 18px;
        --background: var(--ion-background-color);
        --box-shadow: 0 10px 30px #00000026, 0 40px 100px #00000040;
      }
    `,
  ],
  template: `
    @if (fill() === 'outline') {
      <fieldset>
        <legend>{{ label() }}</legend>
        <ng-container [ngTemplateOutlet]="trigger" />
      </fieldset>
    } @else {
      <span class="stacked-label">{{ label() }}</span>
      <ng-container [ngTemplateOutlet]="trigger" />
    }

    <ng-template #trigger>
      <button
        type="button"
        class="trigger"
        aria-haspopup="dialog"
        [disabled]="disabled()"
        [attr.aria-label]="label() + ': ' + info().code"
        (click)="open()"
      >
        <span class="code">{{ info().code }}</span>
        <span class="name">{{ info().name }}</span>
        <ion-icon class="chevron" name="chevron-expand-outline" aria-hidden="true" />
      </button>
    </ng-template>

    <!--
      Auto height, so the sheet is the size of the list rather than the size of
      the screen. That is why the picker is a plain panel and not an
      ion-content: a modal can only hug content that sizes itself.
    -->
    <ion-modal class="currency-sheet" [isOpen]="picking()" (didDismiss)="picking.set(false)">
      <ng-template>
        <app-currency-picker
          [heading]="label()"
          [selected]="value()"
          [extra]="extra()"
          [footnote]="footnote()"
          (picked)="valueChange.emit($event)"
          (dismissed)="picking.set(false)"
        />
      </ng-template>
    </ion-modal>
  `,
})
export class CurrencyFieldComponent {
  readonly label = input('Currency');
  readonly value = input.required<string>();
  readonly disabled = input(false);
  readonly fill = input<'outline' | 'none'>('none');
  readonly extra = input<readonly string[]>([]);
  readonly footnote = input('');

  readonly valueChange = output<string>();

  readonly picking = signal(false);

  readonly info = computed(() => currencyInfo(this.value()));

  open(): void {
    if (!this.disabled()) this.picking.set(true);
  }

  constructor() {
    addIcons({ chevronExpandOutline });
  }
}
