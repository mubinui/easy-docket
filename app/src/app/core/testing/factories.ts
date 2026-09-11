import { Account, Budget, Category, RecurringRule, Transaction } from '../models/domain';

/**
 * Builders for test fixtures. Every field has a sensible default so a test only
 * states the part it actually cares about, which keeps assertions readable.
 */
export function anAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'Everyday',
    kind: 'bank',
    currency: 'USD',
    openingBalance: 0,
    archived: false,
    colour: '#3880ff',
    icon: 'card',
    createdAt: 1_700_000_000_000,
    updatedAt: '',
    ...overrides,
  };
}

export function aCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    name: 'Groceries',
    kind: 'expense',
    parentId: null,
    colour: '#2dd36f',
    icon: 'basket',
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: '',
    ...overrides,
  };
}

export function aTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'txn-1',
    kind: 'expense',
    amount: 1_250,
    currency: 'USD',
    accountId: 'acc-1',
    counterAccountId: null,
    categoryId: 'cat-1',
    date: '2026-01-15',
    payee: 'Corner Shop',
    note: '',
    tags: [],
    cleared: true,
    createdAt: 1_700_000_000_000,
    updatedAt: '',
    ...overrides,
  };
}

export function aBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'bud-1',
    name: 'Everyday spending',
    categoryIds: ['cat-1'],
    period: 'monthly',
    amount: 50_000,
    currency: 'USD',
    startDate: '2026-01-01',
    rollover: false,
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: '',
    ...overrides,
  };
}

export function aRecurringRule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rule-1',
    name: 'Rent',
    kind: 'expense',
    amount: 120_000,
    currency: 'USD',
    accountId: 'acc-1',
    counterAccountId: null,
    categoryId: 'cat-1',
    payee: 'Landlord',
    note: '',
    tags: [],
    interval: 1,
    unit: 'month',
    startDate: '2026-01-01',
    endDate: null,
    maxOccurrences: null,
    skipped: [],
    archived: false,
    createdAt: 1_700_000_000_000,
    updatedAt: '',
    ...overrides,
  };
}
