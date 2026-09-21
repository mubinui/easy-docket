import { Component, computed, inject, signal } from '@angular/core';
import {
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonFab,
  IonFabButton,
  IonHeader,
  IonIcon,
  IonItem,
  IonItemDivider,
  IonLabel,
  IonList,
  IonModal,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, repeatOutline } from 'ionicons/icons';
import { RecurringRule } from '../../core/models/domain';
import { MaterialiserService } from '../../core/recurring/materialiser.service';
import { RecurringService, RuleStatus } from '../../core/repositories/recurring.service';
import { DayPipe } from '../../shared/day.pipe';
import { MoneyPipe } from '../../shared/money.pipe';
import { RuleEditorComponent } from './rule-editor.component';

@Component({
  selector: 'app-rules',
  standalone: true,
  imports: [
    MoneyPipe,
    DayPipe,
    RuleEditorComponent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonContent,
    IonList,
    IonItem,
    IonItemDivider,
    IonLabel,
    IonNote,
    IonIcon,
    IonFab,
    IonFabButton,
    IonModal,
  ],
  styles: [
    `
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
      .finished {
        font-style: italic;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/transactions" /></ion-buttons>
        <ion-title>Recurring</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (upcoming().length) {
        <ion-list>
          @for (status of upcoming(); track status.rule.id) {
            <ion-item button (click)="edit(status.rule)">
              <ion-label>
                <h3>{{ status.rule.name }}</h3>
                <p>{{ cadence(status.rule) }} · {{ dueText(status) }}</p>
              </ion-label>
              <ion-note slot="end" [color]="status.rule.kind === 'income' ? 'success' : undefined">
                {{ status.rule.kind === 'income' ? '+' : '−'
                }}{{ status.rule.amount | money: status.rule.currency }}
              </ion-note>
            </ion-item>

            @if (status.next) {
              <ion-item lines="full">
                <ion-label />
                <ion-button slot="end" size="small" fill="clear" (click)="skip(status, $event)">
                  Skip {{ status.next | day }}
                </ion-button>
              </ion-item>
            }
          }
        </ion-list>
      } @else {
        <div class="empty">
          <ion-icon name="repeat-outline" size="large" color="medium" />
          <p>
            <ion-note>
              Nothing recurring yet. Add rent, a salary or a subscription and it will be recorded
              for you.
            </ion-note>
          </p>
        </div>
      }

      @if (recurring.archived().length) {
        <ion-list>
          <ion-item-divider><ion-label>Archived</ion-label></ion-item-divider>
          @for (rule of recurring.archived(); track rule.id) {
            <ion-item button (click)="edit(rule)">
              <ion-label color="medium">{{ rule.name }}</ion-label>
              <ion-note slot="end">{{ rule.amount | money: rule.currency }}</ion-note>
            </ion-item>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button aria-label="Add recurring rule" [disabled]="!accountsExist()" (click)="create()">
          <ion-icon name="add-outline" />
        </ion-fab-button>
      </ion-fab>

      <ion-modal [isOpen]="editorOpen()" (didDismiss)="close()">
        <ng-template>
          <app-rule-editor [existing]="editing()" (saved)="close()" (cancelled)="close()" />
          @if (editing(); as rule) {
            <ion-button expand="block" fill="clear" (click)="toggleArchive(rule)">
              {{ rule.archived ? 'Restore' : 'Archive' }} rule
            </ion-button>
            <ion-button expand="block" fill="clear" color="danger" (click)="confirmDelete(rule)">
              Delete rule
            </ion-button>
          }
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class RulesPage {
  readonly recurring = inject(RecurringService);
  private readonly materialiser = inject(MaterialiserService);
  private readonly alerts = inject(AlertController);

  readonly editorOpen = signal(false);
  readonly editing = signal<RecurringRule | null>(null);

  readonly upcoming = computed(() => this.recurring.upcoming());
  readonly accountsExist = computed(() => this.recurring.all().length >= 0);

  cadence(rule: RecurringRule): string {
    const unit = rule.interval === 1 ? rule.unit : `${rule.interval} ${rule.unit}s`;
    return rule.interval === 1 ? `every ${unit}` : `every ${unit}`;
  }

  dueText(status: RuleStatus): string {
    return status.next ? `next ${status.next}` : 'finished';
  }

  create(): void {
    this.editing.set(null);
    this.editorOpen.set(true);
  }

  edit(rule: RecurringRule): void {
    this.editing.set(rule);
    this.editorOpen.set(true);
  }

  close(): void {
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  /** Skip the next occurrence. The row is tappable, so the button must not also open it. */
  async skip(status: RuleStatus, event: Event): Promise<void> {
    event.stopPropagation();
    if (!status.next) return;

    await this.materialiser.skip(status.rule.id, status.next);
  }

  async toggleArchive(rule: RecurringRule): Promise<void> {
    await this.recurring.setArchived(rule.id, !rule.archived);
    this.close();
  }

  async confirmDelete(rule: RecurringRule): Promise<void> {
    const alert = await this.alerts.create({
      header: 'Delete rule?',
      // Said plainly: people hesitate, fearing it will erase the payments too.
      message: `${rule.name} will stop recording new transactions. The ones it has already created stay in your ledger.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.recurring.remove(rule.id).then(() => this.close());
          },
        },
      ],
    });
    await alert.present();
  }

  constructor() {
    addIcons({ addOutline, repeatOutline });
  }
}
