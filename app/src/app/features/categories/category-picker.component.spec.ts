import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { CategoriesService } from '../../core/repositories/categories.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { waitUntil } from '../../core/testing/async';
import { aCategory } from '../../core/testing/factories';
import { CategoryPickerComponent } from './category-picker.component';

let counter = 0;

describe('CategoryPickerComponent', () => {
  let fixture: ComponentFixture<CategoryPickerComponent>;
  let picker: CategoryPickerComponent;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`picker-${counter++}`);
    await db.categories.bulkPut([
      aCategory({ id: 'food', name: 'Food', kind: 'expense', parentId: null }),
      aCategory({ id: 'lunch', name: 'Lunch', kind: 'expense', parentId: 'food' }),
      aCategory({ id: 'dinner', name: 'Dinner', kind: 'expense', parentId: 'food' }),
      aCategory({ id: 'rent', name: 'Rent', kind: 'expense', parentId: null }),
      aCategory({ id: 'salary', name: 'Salary', kind: 'income', parentId: null }),
    ]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CategoryPickerComponent],
      providers: [{ provide: DOCKET_DB, useValue: db }, provideRouter([])],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(CategoryPickerComponent);
    picker = fixture.componentInstance;
    fixture.componentRef.setInput('kind', 'expense');
    fixture.detectChanges();

    await waitUntil(() => picker.tree().length === 2);
    fixture.detectChanges();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** What the grid actually offers, in order. */
  function tiles(): string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('.tile')].map((tile) =>
      (tile.textContent ?? '').trim(),
    );
  }

  it('shows the categories of its kind and no others', () => {
    expect(tiles()).toEqual(['Food', 'Rent']);
  });

  describe('choosing a top-level category', () => {
    it('chooses it and opens its subcategories', async () => {
      // Both at once: plenty of spending is just "Transport", and the more
      // specific choice should be one more tap rather than a different gesture.
      const picked: (string | null)[] = [];
      picker.picked.subscribe((id) => picked.push(id));

      picker.choose(picker.tree()[0]);
      fixture.detectChanges();

      expect(picked).toEqual(['food']);
      expect(picker.expanded()).toBe('food');
      expect(tiles()).toEqual(['Food', 'Dinner', 'Lunch', 'Rent']);
    });

    it('stays open, because the next tap may be a subcategory', () => {
      let dismissed = false;
      picker.dismissed.subscribe(() => (dismissed = true));

      picker.choose(picker.tree()[0]);
      expect(dismissed).toBe(false);
    });

    it('does not collapse when the choice comes back in', () => {
      // The bug this guards: choosing a parent emits, the emission returns as
      // `selected`, and an effect that set the expansion unconditionally read
      // that category's null parent and closed what the tap had just opened.
      picker.choose(picker.tree()[0]);
      fixture.componentRef.setInput('selected', 'food');
      fixture.detectChanges();

      expect(picker.expanded()).toBe('food');
    });

    it('closes straight away when there is nothing underneath', () => {
      let dismissed = false;
      picker.dismissed.subscribe(() => (dismissed = true));

      picker.choose(picker.tree()[1]);
      expect(dismissed).toBe(true);
    });

    it('collapses when tapped a second time', () => {
      picker.choose(picker.tree()[0]);
      picker.choose(picker.tree()[0]);
      expect(picker.expanded()).toBeNull();
    });
  });

  describe('choosing a subcategory', () => {
    it('picks it and closes', () => {
      const picked: (string | null)[] = [];
      let dismissed = false;
      picker.picked.subscribe((id) => picked.push(id));
      picker.dismissed.subscribe(() => (dismissed = true));

      picker.pick(picker.tree()[0].children[0]);

      expect(picked).toEqual(['dinner']);
      expect(dismissed).toBe(true);
    });
  });

  describe('opening with a choice already made', () => {
    it('opens on the parent, so the chosen subcategory is visible', () => {
      fixture.componentRef.setInput('selected', 'lunch');
      fixture.detectChanges();

      expect(picker.expanded()).toBe('food');
      expect(tiles()).toContain('Lunch');
    });

    it('leaves the grid closed for a top-level choice', () => {
      fixture.componentRef.setInput('selected', 'rent');
      fixture.detectChanges();

      expect(picker.expanded()).toBeNull();
    });
  });

  describe('when subcategories are switched off', () => {
    it('offers only the top level', async () => {
      await TestBed.inject(CategoriesService).setSubcategoriesEnabled(false);
      await waitUntil(() => !TestBed.inject(CategoriesService).subcategoriesEnabled());
      fixture.detectChanges();

      picker.choose(picker.tree()[0]);
      fixture.detectChanges();

      // The subcategories still exist in the ledger; they are simply not shown.
      expect(tiles()).toEqual(['Food', 'Rent']);
    });

    it('closes on a choice, since there is nothing to expand', async () => {
      await TestBed.inject(CategoriesService).setSubcategoriesEnabled(false);
      await waitUntil(() => !TestBed.inject(CategoriesService).subcategoriesEnabled());

      let dismissed = false;
      picker.dismissed.subscribe(() => (dismissed = true));
      picker.choose(picker.tree()[0]);

      expect(dismissed).toBe(true);
    });
  });

  describe('managing categories from here', () => {
    /**
     * The pencil used to be a `routerLink`. Navigating away unmounted the
     * transaction editor that owns this overlay, so the URL changed to the
     * settings screen while the picker stayed on top of it — a dead sheet over
     * a page that could not be reached. It opens the manager over this sheet
     * instead, which also keeps the half-written transaction.
     */
    it('navigates nowhere at all', () => {
      // The property that broke, stated directly: nothing in this sheet is a
      // link. Ionic moves `aria-label` into its shadow root, so the pencil
      // cannot be found by label from here — but a link can, and there must
      // not be one.
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelectorAll('a[href], [routerlink], [ng-reflect-router-link]')).toHaveLength(
        0,
      );
    });

    it('opens the manager without leaving', () => {
      // Only the flag is asserted here: Ionic instantiates a modal's template
      // when it presents, which needs an overlay lifecycle a unit test has no
      // way to drive. `categories.spec.ts` drives the real thing.
      expect(picker.managing()).toBe(false);
      picker.managing.set(true);
      expect(picker.managing()).toBe(true);
    });

    it('does not dismiss the picker when the manager opens', () => {
      let dismissed = false;
      picker.dismissed.subscribe(() => (dismissed = true));

      picker.managing.set(true);
      fixture.detectChanges();

      expect(dismissed).toBe(false);
    });
  });
});
