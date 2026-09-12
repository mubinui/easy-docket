import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonNote,
  IonTitle,
  IonToolbar,
} from '@ionic/angular';
import { addIcons } from 'ionicons';
import { chevronDownOutline, chevronUpOutline, closeOutline, createOutline } from 'ionicons/icons';
import { CategoryNode } from '../../core/categories/tree';
import { Category, CategoryKind } from '../../core/models/domain';
import { CategoriesService } from '../../core/repositories/categories.service';

/**
 * Choosing a category, as a grid rather than a list.
 *
 * A select forces a scroll through thirty names one at a time. A grid puts a
 * whole vault's categories on one screen, which is what makes recording a
 * transaction quick — the thing people do several times a day.
 *
 * A category with subcategories expands in place rather than pushing a second
 * screen, so the parent stays visible next to its children and the choice can
 * be changed without going back.
 */
@Component({
  selector: 'app-category-picker',
  standalone: true,
  imports: [RouterLink, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonNote, IonTitle, IonToolbar],
  styles: [
    `
      .grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
      }
      /*
       * Separators are drawn on the tiles rather than as grid gaps over a
       * coloured background: a row that does not divide by three leaves empty
       * cells, and a background showing through them reads as a stray grey box.
       */
      .tile {
        background: var(--ion-background-color, #fff);
        border: 0;
        border-right: 1px solid var(--ion-color-step-150, #e0e0e0);
        border-bottom: 1px solid var(--ion-color-step-150, #e0e0e0);
        color: inherit;
        font: inherit;
        min-height: 64px;
        padding: 0.75rem 0.5rem;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        cursor: pointer;
        text-align: center;
      }
      .tile.chosen {
        color: var(--ion-color-primary);
        font-weight: 600;
      }
      /* The children of an expanded category, inset so the nesting is visible. */
      .tile.child {
        background: var(--ion-color-step-50, #f7f7f7);
        font-size: 0.9rem;
      }
      .tile ion-icon {
        font-size: 0.85rem;
        opacity: 0.6;
      }
      .empty {
        text-align: center;
        padding: 3rem 1.5rem;
      }
    `,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Category</ion-title>
        <ion-buttons slot="end">
          <ion-button
            [routerLink]="'/settings/categories/' + kind()"
            aria-label="Manage categories"
            (click)="dismissed.emit()"
          >
            <ion-icon slot="icon-only" name="create-outline" />
          </ion-button>
          <ion-button aria-label="Close" (click)="dismissed.emit()">
            <ion-icon slot="icon-only" name="close-outline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      @if (tree().length) {
        <div class="grid">
          @for (node of tree(); track node.category.id) {
            <button
              type="button"
              class="tile"
              [class.chosen]="isChosen(node.category.id)"
              [attr.aria-expanded]="hasChildren(node) ? expanded() === node.category.id : null"
              (click)="choose(node)"
            >
              {{ node.category.name }}
              @if (hasChildren(node)) {
                <ion-icon
                  [name]="expanded() === node.category.id ? 'chevron-up-outline' : 'chevron-down-outline'"
                />
              }
            </button>

            <!--
              The children take the row beneath their parent. Rendered inside the
              same grid so they line up with it, which is what makes the nesting
              legible without indentation a grid cannot do.
            -->
            @if (expanded() === node.category.id) {
              @for (child of node.children; track child.id) {
                <button
                  type="button"
                  class="tile child"
                  [class.chosen]="isChosen(child.id)"
                  (click)="pick(child)"
                >
                  {{ child.name }}
                </button>
              }
            }
          }
        </div>
      } @else {
        <div class="empty">
          <p>
            <ion-note>
              No {{ kind() }} categories yet.
              <a [routerLink]="'/settings/categories/' + kind()" (click)="dismissed.emit()">
                Add one
              </a>
              and it will appear here.
            </ion-note>
          </p>
        </div>
      }
    </ion-content>
  `,
})
export class CategoryPickerComponent {
  private readonly categories = inject(CategoriesService);

  readonly kind = input.required<CategoryKind>();
  readonly selected = input<string | null>(null);
  readonly picked = output<string | null>();
  readonly dismissed = output<void>();

  /** Which category is showing its subcategories, if any. */
  readonly expanded = signal<string | null>(null);

  readonly tree = computed(() => this.categories.tree(this.kind()));

  constructor() {
    addIcons({ chevronDownOutline, chevronUpOutline, closeOutline, createOutline });

    // Open on the chosen category's parent, so an existing choice is visible
    // rather than hidden one tap away.
    //
    // It only ever opens, never closes. Choosing a top-level category emits,
    // which comes straight back in as `selected` — and a version of this that
    // set the expansion unconditionally would read that category's null parent
    // and collapse the subcategories it had just opened.
    effect(() => {
      const selected = this.selected();
      untracked(() => {
        const parentId = this.categories.byId(selected)?.parentId;
        if (parentId) this.expanded.set(parentId);
      });
    });
  }

  hasChildren(node: CategoryNode): boolean {
    return this.categories.subcategoriesEnabled() && node.children.length > 0;
  }

  isChosen(id: string): boolean {
    return this.selected() === id;
  }

  /**
   * Tapping a top-level category.
   *
   * It is chosen either way — plenty of spending is just "Transport" — and if
   * it has subcategories they open underneath, so the more specific choice is
   * one more tap rather than a different gesture. The sheet stays open, because
   * the next tap may well be a subcategory.
   */
  choose(node: CategoryNode): void {
    this.picked.emit(node.category.id);

    if (!this.hasChildren(node)) {
      this.dismissed.emit();
      return;
    }
    this.expanded.set(this.expanded() === node.category.id ? null : node.category.id);
  }

  /** Tapping a subcategory is the end of the choice. */
  pick(child: Category): void {
    this.picked.emit(child.id);
    this.dismissed.emit();
  }
}
