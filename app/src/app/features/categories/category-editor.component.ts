import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonListHeader,
  IonNote,
  IonText,
  IonTitle,
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, trashOutline } from 'ionicons/icons';
import { Category, CategoryKind } from '../../core/models/domain';
import { CategoriesService } from '../../core/repositories/categories.service';

/**
 * Editing one category, and its subcategories alongside it.
 *
 * The subcategories live here rather than on a screen of their own because
 * they only mean anything in the context of their parent — "Lunch" is not a
 * thing you go and manage, it is something Food has.
 */
@Component({
  selector: 'app-category-editor',
  standalone: true,
  imports: [FormsModule, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonText, IonTitle, IonToggle, IonToolbar],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button (click)="cancelled.emit()">Cancel</ion-button>
        </ion-buttons>
        <ion-title>{{ existing() ? 'Edit' : 'New' }} category</ion-title>
        <ion-buttons slot="end">
          <ion-button strong="true" fill="solid" [disabled]="!canSave()" (click)="save()">Save</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-list>
        <ion-item>
          <ion-input
            label="Name"
            labelPlacement="stacked"
            [placeholder]="kind() === 'income' ? 'Salary' : 'Groceries'"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
          />
        </ion-item>

        @if (existing()) {
          <ion-item>
            <ion-toggle [ngModel]="archived()" (ngModelChange)="archived.set($event)">
              Archived
            </ion-toggle>
          </ion-item>
        }
      </ion-list>

      @if (showSubcategories()) {
        <ion-list>
          <ion-list-header><ion-label>Subcategories</ion-label></ion-list-header>

          @for (child of children(); track child.id) {
            <ion-item>
              <ion-input
                aria-label="Subcategory name"
                [ngModel]="child.name"
                (ngModelChange)="renameChild(child.id, $event)"
              />
              <ion-button
                slot="end"
                fill="clear"
                color="danger"
                [attr.aria-label]="'Remove ' + child.name"
                (click)="removeChild(child)"
              >
                <ion-icon slot="icon-only" name="trash-outline" />
              </ion-button>
            </ion-item>
          }

          <ion-item>
            <ion-input
              label="Add a subcategory"
              labelPlacement="stacked"
              placeholder="Lunch"
              [ngModel]="newChild()"
              (ngModelChange)="newChild.set($event)"
              (keyup.enter)="addChild()"
            />
            <ion-button
              slot="end"
              fill="clear"
              [disabled]="!newChild().trim()"
              aria-label="Add subcategory"
              (click)="addChild()"
            >
              <ion-icon slot="icon-only" name="add-outline" />
            </ion-button>
          </ion-item>

          <ion-item lines="none">
            <ion-note>
              @if (!existing()) {
                Save the category first, then subcategories can be added to it.
              } @else {
                A transaction filed under a subcategory still counts towards this category in
                budgets and reports.
              }
            </ion-note>
          </ion-item>
        </ion-list>
      }

      @if (error()) {
        <ion-item lines="none">
          <ion-text color="danger"><small>{{ error() }}</small></ion-text>
        </ion-item>
      }
    </ion-content>
  `,
})
export class CategoryEditorComponent {
  private readonly categories = inject(CategoriesService);
  private readonly alerts = inject(AlertController);

  readonly existing = input<Category | null>(null);
  readonly kind = input.required<CategoryKind>();
  readonly saved = output<Category>();
  readonly cancelled = output<void>();

  readonly name = signal('');
  readonly archived = signal(false);
  readonly newChild = signal('');
  readonly error = signal<string | null>(null);

  /** Subcategories are only meaningful once the parent exists to hang them on. */
  readonly showSubcategories = computed(
    () => this.categories.subcategoriesEnabled() && this.existing() !== null,
  );

  readonly children = computed(() => {
    const parent = this.existing();
    return parent ? this.categories.childrenOf(parent.id) : [];
  });

  canSave(): boolean {
    return this.name().trim().length > 0;
  }

  constructor() {
    addIcons({ addOutline, trashOutline });

    effect(() => {
      const category = this.existing();
      // Only the input is tracked: this resets the form, and the category list
      // it reads changes whenever a subcategory is added.
      untracked(() => {
        this.name.set(category?.name ?? '');
        this.archived.set(category?.archived ?? false);
        this.newChild.set('');
        this.error.set(null);
      });
    });
  }

  async save(): Promise<void> {
    this.error.set(null);
    try {
      const existing = this.existing();
      const saved = await this.categories.save({
        id: existing?.id ?? crypto.randomUUID(),
        name: this.name().trim(),
        kind: this.kind(),
        parentId: existing?.parentId ?? null,
        archived: this.archived(),
        colour: existing?.colour ?? '#92949c',
        icon: existing?.icon ?? 'pricetag-outline',
        createdAt: existing?.createdAt ?? Date.now(),
      });
      this.saved.emit(saved);
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  async addChild(): Promise<void> {
    const parent = this.existing();
    const name = this.newChild().trim();
    if (!parent || !name) return;

    this.error.set(null);
    try {
      await this.categories.save({
        id: crypto.randomUUID(),
        name,
        kind: parent.kind,
        parentId: parent.id,
        colour: parent.colour,
        icon: parent.icon,
      });
      this.newChild.set('');
    } catch (error) {
      this.error.set((error as Error).message);
    }
  }

  async renameChild(id: string, name: string): Promise<void> {
    const child = this.categories.byId(id);
    if (!child || !name.trim() || child.name === name.trim()) return;
    await this.categories.save({ ...child, name: name.trim() });
  }

  /**
   * Remove a subcategory, saying first what it would cost.
   *
   * Transactions filed against it keep their category id and read as
   * uncategorised, which is worth knowing before rather than after.
   */
  async removeChild(child: Category): Promise<void> {
    const count = await this.categories.transactionCount(child.id);
    const message = count
      ? `${count} transaction(s) are filed under ${child.name}. They will be kept, but will no longer have a category.`
      : `${child.name} has no transactions filed under it.`;

    const alert = await this.alerts.create({
      header: `Remove ${child.name}?`,
      message,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => void this.categories.remove(child.id),
        },
      ],
    });
    await alert.present();
  }
}
