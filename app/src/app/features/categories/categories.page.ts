import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
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
  IonToggle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { addOutline, pricetagOutline, trashOutline } from 'ionicons/icons';
import { CategoryNode } from '../../core/categories/tree';
import { Category, CategoryKind } from '../../core/models/domain';
import { CategoriesService } from '../../core/repositories/categories.service';
import { CategoryEditorComponent } from './category-editor.component';

/**
 * Managing the categories of one kind.
 *
 * Income and expense get their own screen rather than a segment, because they
 * are never compared or moved between: a category is one or the other for its
 * whole life, and a screen that showed both would invite the question of what
 * happens if you drag one across.
 */
@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [FormsModule, CategoryEditorComponent, IonBackButton, IonButton, IonButtons, IonContent, IonFab, IonFabButton, IonHeader, IonIcon, IonItem, IonItemDivider, IonLabel, IonList, IonModal, IonNote, IonTitle, IonToggle, IonToolbar],
  styles: [
    `
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
      ion-content {
        --padding-bottom: 88px;
      }
      .children {
        display: block;
        color: var(--ion-color-medium);
        font-size: 0.8rem;
        margin-top: 2px;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          @if (asModal()) {
            <ion-button (click)="closed.emit()">Done</ion-button>
          } @else {
            <ion-back-button defaultHref="/tabs/settings" />
          }
        </ion-buttons>
        <ion-title>{{ title() }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (categories.subcategoriesEnabled() || anyChildren()) {
        <ion-list>
          <ion-item>
            <ion-toggle
              [checked]="categories.subcategoriesEnabled()"
              (ionChange)="setSubcategories($event)"
            >
              Subcategories
            </ion-toggle>
          </ion-item>
          @if (!categories.subcategoriesEnabled() && anyChildren()) {
            <ion-item lines="none">
              <ion-note>
                Subcategories are hidden, not deleted. Transactions filed under them still count.
              </ion-note>
            </ion-item>
          }
        </ion-list>
      }

      @if (tree().length) {
        <ion-list>
          @for (node of tree(); track node.category.id) {
            <!--
              No icon on the row: a category's icon is not registered with
              Ionic, so it renders as a blank gap rather than a picture, and the
              name is what people actually scan for.
            -->
            <ion-item button (click)="edit(node.category)">
              <ion-label>
                <h3>{{ node.category.name }}{{ countOf(node) }}</h3>
                @if (preview(node); as names) {
                  <span class="children">{{ names }}</span>
                }
              </ion-label>
              <ion-button
                slot="end"
                fill="clear"
                color="danger"
                [attr.aria-label]="'Delete ' + node.category.name"
                (click)="confirmDelete(node, $event)"
              >
                <ion-icon slot="icon-only" name="trash-outline" />
              </ion-button>
            </ion-item>
          }
        </ion-list>
      } @else {
        <div class="empty">
          <ion-icon name="pricetag-outline" size="large" color="medium" />
          <p>
            <ion-note>
              No {{ kind() }} categories yet. Add one and transactions can be filed under it.
            </ion-note>
          </p>
        </div>
      }

      @if (archived().length) {
        <ion-list>
          <ion-item-divider><ion-label>Archived</ion-label></ion-item-divider>
          @for (category of archived(); track category.id) {
            <ion-item button (click)="edit(category)">
              <ion-label color="medium">{{ categories.pathOf(category.id) }}</ion-label>
            </ion-item>
          }
        </ion-list>
      }

      <ion-fab slot="fixed" vertical="bottom" horizontal="end">
        <ion-fab-button [attr.aria-label]="'Add ' + kind() + ' category'" (click)="create()">
          <ion-icon name="add-outline" />
        </ion-fab-button>
      </ion-fab>

      <ion-modal [isOpen]="editorOpen()" (didDismiss)="close()">
        <ng-template>
          <app-category-editor
            [existing]="editing()"
            [kind]="kind()"
            (saved)="close()"
            (cancelled)="close()"
          />
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
})
export class CategoriesPage {
  readonly categories = inject(CategoriesService);
  private readonly alerts = inject(AlertController);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap);

  /**
   * Presented as a sheet rather than pushed as a page.
   *
   * Opened from the category picker while a transaction is half-written, so it
   * cannot navigate: leaving the page would destroy the editor holding that
   * transaction and strand its overlay on screen.
   */
  readonly asModal = input(false);
  readonly closed = output<void>();

  /** Given directly when presented as a sheet; otherwise read from the route. */
  readonly forKind = input<CategoryKind | null>(null);

  /** `income` or `expense`. Anything else is expense. */
  readonly kind = computed<CategoryKind>(
    () => this.forKind() ?? (this.params()?.get('kind') === 'income' ? 'income' : 'expense'),
  );

  readonly title = computed(() => (this.kind() === 'income' ? 'Income' : 'Expense'));

  readonly tree = computed(() => this.categories.tree(this.kind()));

  /** Whether any subcategory exists, which decides if the switch is worth showing. */
  readonly anyChildren = computed(() => this.tree().some((node) => node.children.length > 0));

  archived(): Category[] {
    return this.categories
      .all()
      .filter((category) => category.archived && category.kind === this.kind());
  }

  readonly editorOpen = signal(false);
  readonly editing = signal<Category | null>(null);

  /** "(10)", or nothing at all for a category with no subcategories. */
  countOf(node: CategoryNode): string {
    if (!this.categories.subcategoriesEnabled() || !node.children.length) return '';
    return ` (${node.children.length})`;
  }

  /** The first few subcategory names, the way the list previews them. */
  preview(node: CategoryNode): string {
    if (!this.categories.subcategoriesEnabled() || !node.children.length) return '';
    const names = node.children.map((child) => child.name);
    const shown = names.slice(0, 4).join(', ');
    return names.length > 4 ? `${shown}…` : shown;
  }

  async setSubcategories(event: Event): Promise<void> {
    const checked = (event as CustomEvent<{ checked: boolean }>).detail.checked;
    await this.categories.setSubcategoriesEnabled(checked);
  }

  create(): void {
    this.editing.set(null);
    this.editorOpen.set(true);
  }

  edit(category: Category): void {
    this.editing.set(category);
    this.editorOpen.set(true);
  }

  close(): void {
    this.editorOpen.set(false);
    this.editing.set(null);
  }

  /**
   * Delete a category, saying what it takes with it.
   *
   * A parent takes its subcategories, and any transaction filed under any of
   * them is left without a category — both worth knowing beforehand.
   */
  async confirmDelete(node: CategoryNode, event: Event): Promise<void> {
    event.stopPropagation();

    const { category, children } = node;
    const count = await this.categories.transactionCount(category.id);

    const parts = [];
    if (children.length) {
      parts.push(`Its ${children.length} subcategor${children.length === 1 ? 'y' : 'ies'} go too.`);
    }
    parts.push(
      count
        ? `${count} transaction(s) are filed under it. They will be kept, but will no longer have a category.`
        : 'No transactions are filed under it.',
    );

    const alert = await this.alerts.create({
      header: `Delete ${category.name}?`,
      message: parts.join(' '),
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        {
          text: 'Delete',
          role: 'destructive',
          handler: () => void this.categories.remove(category.id),
        },
      ],
    });
    await alert.present();
  }

  constructor() {
    addIcons({ addOutline, pricetagOutline, trashOutline });
  }
}
