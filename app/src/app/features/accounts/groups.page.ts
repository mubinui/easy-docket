import { Component, inject, signal } from '@angular/core';
import {
  AlertController,
  IonBackButton,
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
  IonReorder,
  IonReorderGroup,
  IonTitle,
  IonToolbar,
  ItemReorderEventDetail,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, cardOutline, folderOutline } from 'ionicons/icons';
import { AccountGroup } from '../../core/models/domain';
import { AccountGroupsService } from '../../core/repositories/account-groups.service';
import { GROUP_TYPES, GroupEditorComponent } from './group-editor.component';

/**
 * Managing the groups themselves.
 *
 * Reached from the Accounts screen rather than the tab bar: groups are set up
 * once and then mostly left alone, and the tab bar is already full.
 */
@Component({
  selector: 'app-account-groups',
  standalone: true,
  imports: [GroupEditorComponent, IonBackButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonItem, IonItemDivider, IonLabel, IonList, IonModal, IonNote, IonReorder, IonReorderGroup, IonTitle, IonToolbar],
  styles: [
    `
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/accounts" />
        </ion-buttons>
        <ion-title>Account groups</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (groups.active().length) {
        <ion-list>
          <ion-reorder-group [disabled]="false" (ionItemReorder)="reorder($any($event))">
            @for (group of groups.active(); track group.id) {
              <ion-item button (click)="edit(group)">
                <ion-icon slot="start" [name]="group.icon" [style.color]="group.colour" />
                <ion-label>
                  <h3>{{ group.name }}</h3>
                  <p>{{ labelFor(group) }} · {{ countIn(group) }}</p>
                </ion-label>
                <ion-reorder slot="end" />
              </ion-item>
            }
          </ion-reorder-group>
        </ion-list>
      } @else {
        <div class="empty">
          <ion-icon name="folder-outline" size="large" color="medium" />
          <p>
            <ion-note>
              No groups yet. A group files accounts together, and its type decides how they
              behave — a credit card group turns balances into what you owe.
            </ion-note>
          </p>
        </div>
      }

      @if (archived().length) {
        <ion-list>
          <ion-item-divider><ion-label>Archived</ion-label></ion-item-divider>
          @for (group of archived(); track group.id) {
            <ion-item button (click)="edit(group)">
              <ion-label color="medium">{{ group.name }}</ion-label>
              <ion-note slot="end">{{ countIn(group) }}</ion-note>
            </ion-item>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button (click)="create()">
          <ion-icon name="add-outline" />
        </ion-fab-button>
      </ion-fab>

      <ion-modal [isOpen]="editorOpen()" (didDismiss)="close()">
        <ng-template>
          <app-group-editor [existing]="editing()" (saved)="close()" (cancelled)="close()" />
          @if (editing(); as group) {
            <ion-item button lines="none" (click)="confirmDelete(group)">
              <ion-label color="danger">Delete group</ion-label>
            </ion-item>
          }
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class AccountGroupsPage {
  readonly groups = inject(AccountGroupsService);
  private readonly alerts = inject(AlertController);

  readonly editorOpen = signal(false);
  readonly editing = signal<AccountGroup | null>(null);

  archived(): AccountGroup[] {
    return this.groups.ordered().filter((group) => group.archived);
  }

  labelFor(group: AccountGroup): string {
    return GROUP_TYPES.find((type) => type.value === group.type)?.label ?? 'Default';
  }

  countIn(group: AccountGroup): string {
    const count = this.groups.accountsIn(group.id).length;
    return count === 1 ? '1 account' : `${count} accounts`;
  }

  create(): void {
    this.editing.set(null);
    this.editorOpen.set(true);
  }

  edit(group: AccountGroup): void {
    this.editing.set(group);
    this.editorOpen.set(true);
  }

  close(): void {
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  /**
   * Ionic moves the row itself and hands back the indices. `complete()` is
   * called synchronously so the list never snaps back while the writes land.
   */
  async reorder(event: CustomEvent<ItemReorderEventDetail>): Promise<void> {
    const ids = this.groups.active().map((group) => group.id);
    const [moved] = ids.splice(event.detail.from, 1);
    ids.splice(event.detail.to, 0, moved);

    event.detail.complete();
    await this.groups.reorder(ids);
  }

  /**
   * Deleting a group never deletes accounts. The confirmation says so, because
   * "delete group" is exactly the phrase a user would expect to be dangerous.
   */
  async confirmDelete(group: AccountGroup): Promise<void> {
    const count = this.groups.accountsIn(group.id).length;
    const consequence = count
      ? `Its ${count === 1 ? 'account' : `${count} accounts`} will be kept and left ungrouped.`
      : 'It has no accounts in it.';

    const alert = await this.alerts.create({
      header: 'Delete group?',
      message: `${group.name} will be removed from every device you sync with. ${consequence}`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => {
            void this.groups.remove(group.id).then(() => this.close());
          },
        },
      ],
    });
    await alert.present();
  }

  constructor() {
    addIcons({ addOutline, cardOutline, folderOutline });
  }
}
