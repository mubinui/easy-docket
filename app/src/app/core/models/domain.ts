/**
 * Domain model for the Easy Docket ledger.
 *
 * Every entity is a plain, serialisable record. Entities carry their own
 * identity (a ULID generated on device) and an `updatedAt` hybrid logical
 * clock stamp so that two devices which have been offline can merge their
 * histories deterministically without a server arbitrating.
 */

/** Monetary amounts are stored as integer minor units (cents) to avoid float drift. */
export type Minor = number;

export type AccountKind = 'cash' | 'bank' | 'card' | 'wallet' | 'savings' | 'investment';

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  /** Balance the account held before the first recorded transaction. */
  openingBalance: Minor;
  archived: boolean;
  colour: string;
  icon: string;
  createdAt: number;
  updatedAt: string;
}

export type CategoryKind = 'income' | 'expense';

export interface Category {
  id: string;
  name: string;
  kind: CategoryKind;
  parentId: string | null;
  colour: string;
  icon: string;
  archived: boolean;
  createdAt: number;
  updatedAt: string;
}

export type TransactionKind = 'income' | 'expense' | 'transfer';

export interface Transaction {
  id: string;
  kind: TransactionKind;
  /** Always positive; direction is carried by `kind`. */
  amount: Minor;
  currency: string;
  /** Source account for expense/transfer, destination for income. */
  accountId: string;
  /** Only set for transfers: the receiving account. */
  counterAccountId: string | null;
  categoryId: string | null;
  /** Local calendar date as `YYYY-MM-DD`, independent of timezone. */
  date: string;
  payee: string;
  note: string;
  tags: string[];
  cleared: boolean;
  createdAt: number;
  updatedAt: string;
}

export type BudgetPeriod = 'weekly' | 'monthly' | 'yearly';

/**
 * A spending limit for a set of categories over a repeating period.
 *
 * A budget references categories rather than owning them, so the same category
 * can appear in more than one budget (a "Food" budget and a broader "Essentials"
 * one) without the transaction having to know about either.
 */
export interface Budget {
  id: string;
  name: string;
  /** Expense categories counted against this budget; at least one. */
  categoryIds: string[];
  period: BudgetPeriod;
  /** The limit for one period, in minor units. */
  amount: Minor;
  currency: string;
  /**
   * The day the first period begins, as `YYYY-MM-DD`. Every later period is
   * measured from here, so a monthly budget started on the 15th runs 15th to
   * 14th rather than snapping to calendar months.
   */
  startDate: string;
  /** Carry an unspent balance into the next period. */
  rollover: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: string;
}

/**
 * Every entity the ledger stores and replicates.
 *
 * The list is the single source of truth, and `EntityName` is derived from it
 * rather than declared alongside it. Anything that has to touch "all entities"
 * — the merge transaction's scope, most obviously — iterates this, so adding an
 * entity cannot leave a code path quietly behind.
 */
export const ENTITY_NAMES = ['accounts', 'categories', 'transactions', 'budgets'] as const;

export type EntityName = (typeof ENTITY_NAMES)[number];

export interface EntityMap {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
  budgets: Budget;
}

export type AnyEntity = EntityMap[EntityName];
