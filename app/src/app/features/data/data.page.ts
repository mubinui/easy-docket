import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
  ToastController,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { cloudDownloadOutline, cloudUploadOutline, documentTextOutline } from 'ionicons/icons';
import { BackupService } from '../../core/backup/backup.service';
import { countRows } from '../../core/backup/backup';
import {
  ColumnMapping,
  ImportPlan,
  detectColumns,
  planImport,
} from '../../core/import/csv-import';
import { parseCsv } from '../../core/import/csv-parse';
import { ImportService } from '../../core/import/import.service';
import { AccountsService } from '../../core/repositories/accounts.service';

/**
 * Getting a ledger in and out.
 *
 * Import resolves the whole file before writing anything, and shows what will
 * happen — how many rows are ready, how many look like repeats, how many could
 * not be read and why. Importing is the one action that can add a thousand rows
 * at once, and an import that half-succeeded is much harder to undo than to
 * prevent.
 */
@Component({
  selector: 'app-data',
  standalone: true,
  imports: [
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonList,
    IonListHeader,
    IonItem,
    IonLabel,
    IonNote,
    IonIcon,
    IonSelect,
    IonSelectOption,
    IonToggle,
    IonText,
  ],
  styles: [
    `
      .actions {
        padding: 0 1rem 1rem;
      }
      .summary {
        padding: 0 1rem 0.5rem;
        font-size: 0.85rem;
      }
      .summary strong {
        display: block;
        font-size: 1.1rem;
      }
      .problems {
        font-size: 0.75rem;
        color: var(--ion-color-medium);
        padding: 0 1rem 1rem;
      }
      input[type='file'] {
        display: none;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/settings" /></ion-buttons>
        <ion-title>Import and backup</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-list-header><ion-label>Backup</ion-label></ion-list-header>
        <ion-item lines="none">
          <ion-note>
            A backup holds your whole ledger, encrypted with the same key as everything else. It is
            useless without your passphrase, so keep the recovery bundle from the security screen
            as well — one is the data, the other is the key.
          </ion-note>
        </ion-item>
      </ion-list>

      <div class="actions">
        <ion-button expand="block" fill="outline" (click)="exportBackup()">
          <ion-icon slot="start" name="cloud-download-outline" />
          Export backup
        </ion-button>
        <ion-button expand="block" fill="outline" (click)="pickBackup.click()">
          <ion-icon slot="start" name="cloud-upload-outline" />
          Restore from backup
        </ion-button>
      </div>

      <ion-list>
        <ion-list-header><ion-label>Import a statement</ion-label></ion-list-header>

        @if (accounts.active().length) {
          <ion-item>
            <ion-select
              label="Into account"
              labelPlacement="stacked"
              [ngModel]="accountId()"
              (ngModelChange)="accountId.set($event)"
            >
              @for (account of accounts.active(); track account.id) {
                <ion-select-option [value]="account.id">{{ account.name }}</ion-select-option>
              }
            </ion-select>
          </ion-item>

          <ion-item>
            <ion-toggle [ngModel]="dayFirst()" (ngModelChange)="setDayFirst($event)">
              Dates are day first (31/12)
            </ion-toggle>
          </ion-item>
        } @else {
          <ion-item lines="none">
            <ion-note>Add an account before importing.</ion-note>
          </ion-item>
        }
      </ion-list>

      @if (plan(); as result) {
        <div class="summary">
          <strong>{{ result.ready }} ready to import</strong>
          <ion-note>
            {{ result.duplicates }} already recorded · {{ result.failed }} could not be read
          </ion-note>
        </div>

        @if (problems().length) {
          <div class="problems">
            @for (problem of problems(); track problem) {
              <div>{{ problem }}</div>
            }
          </div>
        }

        <div class="actions">
          <ion-button expand="block" [disabled]="result.ready === 0" (click)="applyImport()">
            Import {{ result.ready }} transaction(s)
          </ion-button>
          <ion-button expand="block" fill="clear" (click)="clear()">Cancel</ion-button>
        </div>
      } @else {
        <div class="actions">
          <ion-button
            expand="block"
            fill="outline"
            [disabled]="!accounts.active().length"
            (click)="pickCsv.click()"
          >
            <ion-icon slot="start" name="document-text-outline" />
            Choose a CSV file
          </ion-button>
        </div>
      }

      @if (error()) {
        <ion-item lines="none">
          <ion-text color="danger"><small>{{ error() }}</small></ion-text>
        </ion-item>
      }

      <input #pickCsv type="file" accept=".csv,text/csv" (change)="readCsv($event)" />
      <input #pickBackup type="file" accept=".edk" (change)="readBackup($event)" />
    </ion-content>
  `,
})
export class DataPage {
  readonly accounts = inject(AccountsService);
  private readonly imports = inject(ImportService);
  private readonly backups = inject(BackupService);
  private readonly toasts = inject(ToastController);
  private readonly alerts = inject(AlertController);

  readonly accountId = signal<string | null>(null);
  readonly dayFirst = signal(true);
  readonly plan = signal<ImportPlan | null>(null);
  readonly error = signal<string | null>(null);

  private rows: string[][] = [];
  private mapping: ColumnMapping | null = null;

  /** The first few problems, named with their line, so a fix is possible. */
  readonly problems = computed(() =>
    (this.plan()?.rows ?? [])
      .filter((row) => row.error)
      .slice(0, 5)
      .map((row) => `Line ${row.line}: ${row.error}`),
  );

  async readCsv(event: Event): Promise<void> {
    this.error.set(null);
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const rows = parseCsv(await file.text());
      if (rows.length < 2) {
        this.error.set('That file has no rows to import.');
        return;
      }

      this.mapping = detectColumns(rows[0]);
      this.rows = rows.slice(1);
      await this.replan();
    } catch (problem) {
      this.error.set((problem as Error).message);
    } finally {
      // Allow the same file to be chosen again after a cancel.
      (event.target as HTMLInputElement).value = '';
    }
  }

  async setDayFirst(dayFirst: boolean): Promise<void> {
    this.dayFirst.set(dayFirst);
    // The convention changes which rows parse, so the plan is rebuilt rather
    // than left showing counts for the previous setting.
    if (this.mapping) await this.replan();
  }

  private async replan(): Promise<void> {
    if (!this.mapping) return;
    const account = this.accounts.byId(this.accountId() ?? '') ?? this.accounts.active()[0];
    if (!account) return;

    this.accountId.set(account.id);
    this.plan.set(
      planImport(this.rows, this.mapping, {
        accountId: account.id,
        currency: account.currency,
        dayFirst: this.dayFirst(),
        existing: await this.imports.existingKeys(),
      }),
    );
  }

  async applyImport(): Promise<void> {
    const plan = this.plan();
    const account = this.accounts.byId(this.accountId() ?? '');
    if (!plan || !account) return;

    const result = await this.imports.apply(plan, {
      accountId: account.id,
      currency: account.currency,
    });

    this.clear();
    const created = result.categoriesCreated.length
      ? `, ${result.categoriesCreated.length} new category(s)`
      : '';
    await this.say(`Imported ${result.imported} transaction(s)${created}`);
  }

  clear(): void {
    this.plan.set(null);
    this.rows = [];
    this.mapping = null;
  }

  async exportBackup(): Promise<void> {
    try {
      const { rows } = await this.backups.export();
      await this.say(`Backed up ${rows} row(s)`);
    } catch (problem) {
      this.error.set((problem as Error).message);
    }
  }

  /**
   * Restore is confirmed, not immediate: it writes into the current ledger
   * rather than replacing it, and the user should know that before it happens.
   */
  async readBackup(event: Event): Promise<void> {
    this.error.set(null);
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    try {
      const payload = await this.backups.inspect(await file.text());
      const taken = payload.takenAt ? new Date(payload.takenAt).toLocaleString() : 'an unknown time';

      const alert = await this.alerts.create({
        header: 'Restore this backup?',
        message: `It holds ${countRows(payload)} row(s) from ${taken}. Anything you have changed since is kept — only older or missing records are restored.`,
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          {
            text: 'Restore',
            handler: () => {
              void this.backups
                .restore(payload)
                .then((result) =>
                  this.say(`Restored ${result.restored} row(s), kept ${result.skipped}`),
                );
            },
          },
        ],
      });
      await alert.present();
    } catch (problem) {
      this.error.set((problem as Error).message);
    } finally {
      (event.target as HTMLInputElement).value = '';
    }
  }

  private async say(message: string): Promise<void> {
    const toast = await this.toasts.create({ message, duration: 2500 });
    await toast.present();
  }

  constructor() {
    addIcons({ cloudDownloadOutline, cloudUploadOutline, documentTextOutline });
  }
}
