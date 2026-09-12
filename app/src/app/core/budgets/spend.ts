import { inReporting } from '../money/conversion';
import { Budget, Minor, Transaction } from '../models/domain';
import { BudgetWindow, windowByIndex, windowFor } from './period';

/**
 * Turning a budget plus a ledger into "how am I doing".
 *
 * Kept as pure functions over plain arrays so the rules can be stated and
 * tested without a database: the rules are the part that is easy to get subtly
 * wrong, and the plumbing around them is not.
 */

export interface BudgetProgress {
  budget: Budget;
  /** Transactions in this period with no rate to the budget's currency. */
  unconverted: number;
  window: BudgetWindow;
  /** The budget's own per-period limit, before any carry. */
  limit: Minor;
  /** Brought forward from earlier periods; zero unless rollover is on. */
  carried: Minor;
  /** What may be spent this period: `limit + carried`. */
  allowance: Minor;
  spent: Minor;
  /** `allowance - spent`; negative when over. */
  remaining: Minor;
  /** Percentage of the allowance used, clamped to 0-100 for display. */
  share: number;
  over: boolean;
}

/**
 * Does this transaction count against this budget?
 *
 * Only expenses. Income is not spending, and a transfer moves money between the
 * user's own accounts — counting it would let someone blow a grocery budget by
 * moving savings around.
 *
 * `covered` is the budget's categories **and their subcategories**, which the
 * caller expands with `withDescendants`. A budget on "Food" has to count what
 * was spent on "Food → Lunch"; without that, adding a subcategory would quietly
 * stop an existing budget seeing the spending it was set up to watch. Callers
 * that have no category tree to hand can omit it and get the budget's own list,
 * which is what this did before subcategories existed.
 */
export function countsTowards(
  budget: Budget,
  transaction: Transaction,
  covered?: ReadonlySet<string>,
): boolean {
  if (transaction.kind !== 'expense' || transaction.categoryId === null) return false;
  return covered
    ? covered.has(transaction.categoryId)
    : budget.categoryIds.includes(transaction.categoryId);
}

export function spendIn(
  budget: Budget,
  window: BudgetWindow,
  transactions: readonly Transaction[],
  covered?: ReadonlySet<string>,
): Minor {
  return spendDetail(budget, window, transactions, covered).spent;
}

/**
 * Spend in a period, with a count of what could not be converted.
 *
 * A budget is denominated in one currency, so spending recorded in another has
 * to be converted using the rate stored on the transaction. Anything with no
 * rate is left out and counted, rather than added at face value — treating €45
 * as $45 would quietly understate the spend and tell the user they are within a
 * limit they have passed.
 */
export function spendDetail(
  budget: Budget,
  window: BudgetWindow,
  transactions: readonly Transaction[],
  covered?: ReadonlySet<string>,
): { spent: Minor; unconverted: number } {
  let spent = 0;
  let unconverted = 0;

  for (const transaction of transactions) {
    if (!countsTowards(budget, transaction, covered)) continue;
    if (transaction.date < window.from || transaction.date > window.to) continue;

    const amount = inReporting(transaction, budget.currency);
    if (amount === null) unconverted++;
    else spent += amount;
  }
  return { spent, unconverted };
}

/**
 * What carries into period `index` from everything before it.
 *
 * Overspend carries too, as a negative. Letting an overspent month reset to a
 * clean slate would make the rollover setting flattering rather than useful —
 * the point of carrying a balance is that it tells the truth in both directions.
 * Rollover never reaches back before the budget started.
 */
export function carriedInto(
  budget: Budget,
  index: number,
  transactions: readonly Transaction[],
  covered?: ReadonlySet<string>,
): Minor {
  if (!budget.rollover || index <= 0) return 0;

  // Each completed period contributes its own surplus or deficit, so the
  // running total is what an unbroken chain of periods has left over.
  let carry = 0;
  for (let period = 0; period < index; period++) {
    carry += budget.amount - spendIn(budget, windowByIndex(budget, period), transactions, covered);
  }
  return carry;
}

/** Progress for the period containing `asOf`, or null before the budget begins. */
export function progressFor(
  budget: Budget,
  transactions: readonly Transaction[],
  asOf: string,
  covered?: ReadonlySet<string>,
): BudgetProgress | null {
  const window = windowFor(budget, asOf);
  if (!window) return null;

  const carried = carriedInto(budget, window.index, transactions, covered);
  const allowance = budget.amount + carried;
  const { spent, unconverted } = spendDetail(budget, window, transactions, covered);
  const remaining = allowance - spent;

  return {
    budget,
    unconverted,
    window,
    limit: budget.amount,
    carried,
    allowance,
    spent,
    remaining,
    // An allowance of zero or less is fully consumed by definition; dividing by
    // it would produce Infinity and a bar that renders as garbage.
    share: allowance > 0 ? Math.min(100, Math.round((spent / allowance) * 100)) : 100,
    over: remaining < 0,
  };
}

/**
 * Category ids a budget references that no longer exist.
 *
 * Deleting a category does not touch budgets that name it, so without this the
 * budget would quietly stop counting that spending and still look healthy. The
 * UI surfaces these rather than silently dropping them, because the user is the
 * only one who knows whether the right fix is to remove the reference or to
 * recreate the category.
 */
export function staleCategoryIds(budget: Budget, knownCategoryIds: ReadonlySet<string>): string[] {
  return budget.categoryIds.filter((id) => !knownCategoryIds.has(id));
}
