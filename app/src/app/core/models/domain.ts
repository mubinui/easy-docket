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

  /**
   * Units of the reporting currency one unit of `currency` bought, at the
   * moment this happened. Absent when the transaction is already in the
   * reporting currency, or when it predates multi-currency support.
   *
   * Stored rather than derived so that last year's totals never move. A report
   * that reads differently on two afternoons because a rate drifted is a report
   * nobody can trust, and a ledger that rewrites its own history is unsettling.
   */
  rate?: number;
  /** The date the stored rate was quoted for, `YYYY-MM-DD`. */
  rateDate?: string;

  createdAt: number;
  updatedAt: string;
}

/**
 * A quoted exchange rate: how many units of `quote` one unit of `base` buys on
 * a given day.
 *
 * Rates are vault data and replicate like everything else, so a rate entered on
 * a phone is available on a laptop. They are kept per day rather than as a
 * single current figure, because a transaction recorded last March needs
 * March's rate, not today's.
 */
export interface ExchangeRate {
  /** `<base>:<quote>:<date>`, so the same quote cannot be stored twice. */
  id: string;
  base: string;
  quote: string;
  /** Units of `quote` per one unit of `base`. Always positive. */
  rate: number;
  date: string;
  source: 'manual' | 'fetched';
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

export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';

/**
 * A standing instruction: rent on the 1st, salary on the 25th, a subscription
 * every year.
 *
 * The rule is not itself a transaction and never appears in a balance. It is a
 * template plus a schedule, from which ordinary transactions are materialised —
 * so history stays a flat log of things that actually happened, and editing a
 * rule tomorrow cannot silently rewrite what it produced last year.
 */
export interface RecurringRule {
  id: string;
  name: string;

  /** The transaction this rule creates, minus its date. */
  kind: TransactionKind;
  amount: Minor;
  currency: string;
  accountId: string;
  counterAccountId: string | null;
  categoryId: string | null;
  payee: string;
  note: string;
  tags: string[];

  /** Every `interval` `unit`s: 1 month, 2 weeks, 3 days. */
  interval: number;
  unit: RecurrenceUnit;
  /** The first occurrence, `YYYY-MM-DD`. Later ones are measured from here. */
  startDate: string;
  /** Last date the rule may produce anything, or null for open-ended. */
  endDate: string | null;
  /** Cap on how many occurrences are ever created, or null for unlimited. */
  maxOccurrences: number | null;

  /**
   * Occurrence dates the user has explicitly skipped — a month the rent was
   * not due, a subscription paused. Kept on the rule rather than as tombstones
   * so a skip replicates like any other edit.
   */
  skipped: string[];

  archived: boolean;
  createdAt: number;
  updatedAt: string;
}

/**
 * Vault-wide settings, replicated so every device agrees.
 *
 * The reporting currency in particular *must* be vault-wide. Rates are stored
 * on transactions as "units of the reporting currency", so if two devices
 * disagreed about which currency that is, every rate one of them wrote would
 * mean something different to the other. There is exactly one row, id `vault`.
 */
export interface VaultSettings {
  id: 'vault';
  /** The currency totals are expressed in. */
  reportingCurrency: string;
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
export const ENTITY_NAMES = [
  'accounts',
  'categories',
  'transactions',
  'budgets',
  'recurringRules',
  'rates',
  'vaultSettings',
] as const;

export type EntityName = (typeof ENTITY_NAMES)[number];

export interface EntityMap {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
  budgets: Budget;
  recurringRules: RecurringRule;
  rates: ExchangeRate;
  vaultSettings: VaultSettings;
}

export type AnyEntity = EntityMap[EntityName];
