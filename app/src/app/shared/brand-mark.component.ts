import { Component } from '@angular/core';

/** Theme-aware ledger mark: entries arranged into three rows. */
@Component({
  selector: 'app-brand-mark',
  standalone: true,
  template: `<svg viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <path d="M11 10h18v22l-3-2-3 2-3-2-3 2-3-2-3 2V10Z" fill="currentColor" opacity=".16" />
    @for (dot of dots; track $index) { <circle [attr.cx]="dot[0]" [attr.cy]="dot[1]" r="1.7" fill="currentColor" /> }
  </svg>`,
  styles: [`
    :host { display: inline-flex; flex: 0 0 38px; width: 38px; height: 38px; color: var(--ion-color-primary); background: var(--ion-card-background); border-radius: 12px; box-shadow: var(--docket-surface-light), var(--docket-control-elevation); }
    svg { display: block; width: 100%; height: 100%; }
  `],
})
export class BrandMarkComponent {
  readonly dots = [[14, 15], [20, 15], [26, 15], [14, 21], [20, 21], [26, 21], [14, 27], [20, 27]];
}
