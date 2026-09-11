import { Component, computed, input } from '@angular/core';

/**
 * The progress bar shared by the budgets list and the Summary card.
 *
 * Extracted rather than duplicated so the two cannot drift: a budget that reads
 * as comfortable on one screen and alarming on the other would be worse than
 * having no bar at all.
 */
@Component({
  selector: 'app-budget-bar',
  standalone: true,
  styles: [
    `
      .bar {
        height: 8px;
        border-radius: 4px;
        background: var(--ion-color-step-150, #e6e6e6);
        overflow: hidden;
        margin: 0.4rem 0 0.2rem;
      }
      .bar span {
        display: block;
        height: 100%;
        transition: width 200ms ease;
      }
    `,
  ],
  template: `
    <div
      class="bar"
      role="progressbar"
      [attr.aria-valuenow]="share()"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-label]="label()"
    >
      <span [style.width.%]="share()" [style.background]="colour()"></span>
    </div>
  `,
})
export class BudgetBarComponent {
  /** Percentage of the allowance used, already clamped to 0-100 by the caller. */
  readonly share = input.required<number>();
  readonly over = input(false);

  readonly colour = computed(() =>
    this.over() ? 'var(--ion-color-danger)' : 'var(--ion-color-success)',
  );

  readonly label = computed(() =>
    this.over() ? `Over budget, ${this.share()}% of allowance used` : `${this.share()}% of budget used`,
  );
}
