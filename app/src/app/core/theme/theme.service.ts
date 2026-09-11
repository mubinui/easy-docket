import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';

/**
 * Dark / light / auto theming.
 *
 * "Auto" follows the operating system and keeps following it: the media query
 * listener stays attached, so a phone that switches to dark mode at sunset
 * switches the app with it. An explicit choice detaches from the system and is
 * remembered.
 *
 * The preference is not secret — it is stored unencrypted so the correct theme
 * can be applied before the vault is unlocked, rather than flashing white at a
 * user who chose dark.
 */
export type ThemeChoice = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'docket.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly choiceSignal = signal<ThemeChoice>('auto');
  private readonly darkSignal = signal(false);

  /** What the user chose. */
  readonly choice = this.choiceSignal.asReadonly();
  /** What is actually being rendered, after resolving "auto". */
  readonly isDark = this.darkSignal.asReadonly();

  private query: MediaQueryList | null = null;

  async initialise(): Promise<void> {
    const { value } = await Preferences.get({ key: STORAGE_KEY });
    const stored = value as ThemeChoice | null;

    this.query = globalThis.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    this.query?.addEventListener('change', () => {
      if (this.choiceSignal() === 'auto') this.apply();
    });

    this.choiceSignal.set(stored ?? 'auto');
    this.apply();
  }

  async set(choice: ThemeChoice): Promise<void> {
    this.choiceSignal.set(choice);
    await Preferences.set({ key: STORAGE_KEY, value: choice });
    this.apply();
  }

  private apply(): void {
    const dark =
      this.choiceSignal() === 'dark' ||
      (this.choiceSignal() === 'auto' && (this.query?.matches ?? false));

    this.darkSignal.set(dark);
    // Ionic keys its dark palette off this class on <html>.
    document.documentElement.classList.toggle('ion-palette-dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';

    if (Capacitor.isPluginAvailable('StatusBar')) {
      // Light text on a dark bar and vice versa; failures are cosmetic only.
      StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => undefined);
    }
  }
}
