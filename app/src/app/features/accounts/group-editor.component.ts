import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountGroup, AccountGroupType } from '../../core/models/domain';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonSelect,
  IonSelectOption,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';

/**
 * What a group means, in the user's words.
 *
 * The note under each option is not decoration: "Credit card" changes how every
 * balance in the group is read, and a picker that silently did that would be a
 * trap.
 */
export const GROUP_TYPES: ReadonlyArray<{
  value: AccountGroupType;
  label: string;
  icon: string;
  note: string;
}> = [
  {
    value: 'default',
    label: 'Default',
    icon: 'folder-outline',
    note: 'Ordinary accounts. Balances read as money you hold, and count as assets.',
  },
  {
    value: 'credit-card',
    label: 'Credit card',
    icon: 'card-outline',
    note: 'Balances read as money owed and count as liabilities; a bill can be paid.',
  },
  {
    value: 'debit-card',
    label: 'Debit card',
    icon: 'card-outline',
    note: 'Cards drawing on money you already hold. Balances read as normal.',
  },
  {
    value: 'loan',
    label: 'Loan',
    icon: 'trending-down-outline',
    note: 'Money borrowed — a mortgage, a car loan. Counts as a liability, like a credit card.',
  },
];

@Component({
  selector: 'app-group-editor',
  standalone: true,
  imports: [FormsModule, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem, IonList, IonNote, IonSelect, IonSelectOption, IonText, IonTitle, IonToggle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelled.emit()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ existing() ? 'Edit' : 'New' }} group</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" [disabled]="!canSave()" (click)="save()">Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-item>
          <ion-input
            label="Name"
            labelPlacement="stacked"
            placeholder="Cards"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </ion-item>

        <ion-item>
          <ion-select
            label="Type"
            labelPlacement="stacked"
            [ngModel]="type()"
            (ngModelChange)="type.set($event)"
          >
            @for (option of types; track option.value) {
              <ion-select-option [value]="option.value">{{ option.label }}</ion-select-option>
            }
          </ion-select>
        </ion-item>

        @if (existing()) {
          <ion-item>
            <ion-toggle [ngModel]="archived()" (ngModelChange)="archived.set($event)">
              Archived
            </ion-toggle>
          </ion-item>
        }
      </ion-list>

      <ion-item lines="none">
        <ion-note>{{ typeNote() }}</ion-note>
      </ion-item>

      @if (error()) {
        <ion-item lines="none">
          <ion-text color="danger"><small>{{ error() }}</small></ion-text>
        </ion-item>
      }
    </ion-content>
  `,
})
export class GroupEditorComponent {
  private readonly groups = inject(AccountGroupsService);

  readonly existing = input<AccountGroup | null>(null);
  readonly saved = output<AccountGroup>();
  readonly cancelled = output<void>();

  readonly types = GROUP_TYPES;

  readonly name = signal('');
  readonly type = signal<AccountGroupType>('default');
  readonly archived = signal(false);
  readonly error = signal<string | null>(null);

  canSave(): boolean {
    return this.name().trim().length > 0;
  }

  typeNote(): string {
    return GROUP_TYPES.find((option) => option.value === this.type())?.note ?? '';
  }

  constructor() {
    effect(() => {
      const group = this.existing();
      this.name.set(group?.name ?? '');
      this.type.set(group?.type ?? 'default');
      this.archived.set(group?.archived ?? false);
      this.error.set(null);
    });
  }

  async save(): Promise<void> {
    this.error.set(null);
    try {
      const existing = this.existing();
      const saved = await this.groups.save({
        id: existing?.id ?? crypto.randomUUID(),
        name: this.name().trim(),
        type: this.type(),
        archived: this.archived(),
        icon: GROUP_TYPES.find((t) => t.value === this.type())?.icon ?? 'folder-outline',
        colour: existing?.colour ?? '#3880ff',
        ...(existing ? { order: existing.order, createdAt: existing.createdAt } : {}),
      });
      this.saved.emit(saved);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }
}
