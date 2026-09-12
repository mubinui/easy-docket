import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { DOCKET_DB } from '../../core/db/db.token';
import { DocketDb } from '../../core/db/docket-db';
import { CategoriesService } from '../../core/repositories/categories.service';
import { LedgerService } from '../../core/repositories/ledger.service';
import { waitUntil } from '../../core/testing/async';
import { aCategory, aTransaction } from '../../core/testing/factories';
import { CategoriesPage } from './categories.page';

let counter = 0;

describe('CategoriesPage', () => {
  let fixture: ComponentFixture<CategoriesPage>;
  let page: CategoriesPage;
  let db: DocketDb;

  beforeEach(async () => {
    db = new DocketDb(`cat-page-${counter++}`);
    await db.categories.bulkPut([
      aCategory({ id: 'food', name: 'Food', kind: 'expense', parentId: null }),
      aCategory({ id: 'lunch', name: 'Lunch', kind: 'expense', parentId: 'food' }),
      aCategory({ id: 'dinner', name: 'Dinner', kind: 'expense', parentId: 'food' }),
      aCategory({ id: 'rent', name: 'Rent', kind: 'expense', parentId: null }),
      aCategory({ id: 'salary', name: 'Salary', kind: 'income', parentId: null }),
    ]);
  });

  async function render(kind: 'income' | 'expense'): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [CategoriesPage],
      providers: [
        { provide: DOCKET_DB, useValue: db },
        provideRouter([]),
        // After `provideRouter`, which supplies its own ActivatedRoute: the
        // later provider wins, and with the order reversed this stub is
        // ignored and every render reads as the default kind.
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ kind })) } },
      ],
    });
    await TestBed.inject(LedgerService).initialise('aaaaaaaa');

    fixture = TestBed.createComponent(CategoriesPage);
    page = fixture.componentInstance;
    fixture.detectChanges();

    // `>=`: some tests seed extra categories before rendering.
    await waitUntil(() => page.categories.all().length >= 5);
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('shows only the kind it was asked for', async () => {
    await render('expense');
    expect(page.tree().map((n) => n.category.name)).toEqual(['Food', 'Rent']);

    await render('income');
    expect(page.tree().map((n) => n.category.name)).toEqual(['Salary']);
  });

  it('names the screen after the kind', async () => {
    await render('income');
    expect(page.title()).toBe('Income');
  });

  it('counts the subcategories and names the first few', async () => {
    await render('expense');

    const food = page.tree()[0];
    expect(page.countOf(food)).toBe(' (2)');
    expect(page.preview(food)).toBe('Dinner, Lunch');
    expect(text()).toContain('Food (2)');
  });

  it('says nothing about subcategories for a category with none', async () => {
    await render('expense');

    const rent = page.tree()[1];
    expect(page.countOf(rent)).toBe('');
    expect(page.preview(rent)).toBe('');
  });

  it('trims a long list of subcategories rather than filling the row', async () => {
    await db.categories.bulkPut(
      ['A', 'B', 'C', 'D', 'E'].map((name) =>
        aCategory({ id: `x-${name}`, name, kind: 'expense', parentId: 'rent' }),
      ),
    );
    await render('expense');
    await waitUntil(() => page.tree()[1].children.length === 5);

    expect(page.preview(page.tree()[1])).toBe('A, B, C, D…');
  });

  describe('the subcategories switch', () => {
    it('is on until someone turns it off', async () => {
      await render('expense');
      expect(page.categories.subcategoriesEnabled()).toBe(true);
    });

    it('hides the second level without deleting it', async () => {
      await render('expense');
      await page.setSubcategories(new CustomEvent('ionChange', { detail: { checked: false } }));
      await waitUntil(() => !page.categories.subcategoriesEnabled());
      fixture.detectChanges();

      // The row stops advertising them...
      expect(page.countOf(page.tree()[0])).toBe('');
      expect(page.preview(page.tree()[0])).toBe('');
      // ...but they are still in the ledger.
      expect(await db.categories.get('lunch')).toBeDefined();
    });

    it('is still offered when there are subcategories to hide', async () => {
      await render('expense');
      await page.setSubcategories(new CustomEvent('ionChange', { detail: { checked: false } }));
      await waitUntil(() => !page.categories.subcategoriesEnabled());
      fixture.detectChanges();

      expect(page.anyChildren()).toBe(true);
      expect(text()).toContain('Subcategories');
    });
  });

  describe('archived categories', () => {
    it('are listed apart from the rest', async () => {
      await db.categories.put(
        aCategory({ id: 'old', name: 'Retired', kind: 'expense', archived: true }),
      );
      await render('expense');
      await waitUntil(() => page.archived().length === 1);

      expect(page.tree().map((n) => n.category.name)).toEqual(['Food', 'Rent']);
      expect(page.archived().map((c) => c.name)).toEqual(['Retired']);
    });
  });

  describe('the editor', () => {
    it('opens empty for a new category and loaded for an existing one', async () => {
      await render('expense');

      page.create();
      expect(page.editorOpen()).toBe(true);
      expect(page.editing()).toBeNull();

      page.edit(page.tree()[0].category);
      expect(page.editing()?.name).toBe('Food');

      page.close();
      expect(page.editorOpen()).toBe(false);
    });
  });

  describe('deleting', () => {
    it('takes the subcategories and leaves the transactions', async () => {
      await db.transactions.bulkPut([
        aTransaction({ id: 't1', categoryId: 'food' }),
        aTransaction({ id: 't2', categoryId: 'lunch' }),
      ]);
      await render('expense');

      await TestBed.inject(CategoriesService).remove('food');

      expect(await db.categories.get('lunch')).toBeUndefined();
      expect(await db.transactions.count()).toBe(2);
    });
  });
});
