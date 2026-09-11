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

/** Union of everything the ledger stores and replicates. */
export type EntityName = 'accounts' | 'categories' | 'transactions';

export interface EntityMap {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
}

export type AnyEntity = EntityMap[EntityName];
