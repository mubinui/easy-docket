import { Component } from '@angular/core';

/** Abstract transactions settle into ordered entries; never depicts financial data. */
@Component({
  selector: 'app-ledger-dots',
  standalone: true,
  template: `<figure>
    <svg viewBox="0 0 360 112" aria-hidden="true" focusable="false">
      @for (dot of dots; track $index) {
        <circle [attr.cx]="dot.x" [attr.cy]="dot.y" r="3" [attr.fill]="dot.color"
          [style.--dx]="dot.dx + 'px'" [style.--dy]="dot.dy + 'px'" [style.animation-delay]="dot.delay + 'ms'" />
      }
    </svg>
    <figcaption>Every transaction, in its place.</figcaption>
  </figure>`,
  styles: [`
    :host { display: block; }
    figure { margin: 0; }
    svg { display: block; width: 100%; max-width: 360px; height: auto; overflow: visible; }
    circle { animation: settle 1800ms cubic-bezier(.16,1,.3,1) both; }
    figcaption { margin-top: 12px; font-size: 12px; color: inherit; opacity: .85; }
    @keyframes settle { from { transform: translate(var(--dx), var(--dy)); opacity: .15; } to { transform: translate(0,0); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { circle { animation: none; } }
  `],
})
export class LedgerDotsComponent {
  readonly dots = Array.from({ length: 66 }, (_, i) => {
    const row = Math.floor(i / 22);
    const col = i % 22;
    return { x: 12 + col * 15, y: 24 + row * 30,
      color: col < [18, 13, 9][row] ? ['#9cc9ff', '#8dd6c0', '#c4cfff'][row] : '#ffffff20',
      dx: Math.sin(i * 2.4) * 35, dy: Math.cos(i * 1.7) * 22, delay: col * 18 + row * 70 };
  });
}
