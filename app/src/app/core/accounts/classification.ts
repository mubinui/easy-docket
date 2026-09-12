import { Account, AccountGroup, AccountGroupType } from '../models/domain';

/**
 * Which side of the balance sheet an account falls on.
 *
 * An **asset** is money held: cash, current accounts, savings, investments.
 * A **liability** is money owed: a credit card balance, a loan outstanding.
 *
 * The distinction is about what the account *is*, not what its balance happens
 * to be today. A current account overdrawn this week is still an asset that
 * happens to be negative — it does not become a loan — and a credit card paid
 * off to zero is still a liability account with nothing on it. Classifying by
 * balance would move accounts between the two halves of the balance sheet as
 * money came and went, which is not how a balance sheet works.
 */
export type BalanceSheetSide = 'asset' | 'liability';

/** The group types that represent money owed rather than money held. */
export function sideOfType(type: AccountGroupType): BalanceSheetSide {
  return type === 'credit-card' || type === 'loan' ? 'liability' : 'asset';
}

/**
 * Which side an account falls on, given its group.
 *
 * Ungrouped — and an account whose group this device has not seen — is an
 * asset. That is the safe reading: a balance appearing under "money held" when
 * it should have been "owed" is visible and correctable, whereas the reverse
 * would quietly overstate what someone owes.
 */
export function sideOf(account: Account, group: AccountGroup | undefined | null): BalanceSheetSide {
  return group ? sideOfType(group.type) : 'asset';
}

/**
 * Whether balances in this group read as amounts owed.
 *
 * The same set as the liabilities, and deliberately the same function: the
 * moment "shows as owed" and "counts as a liability" could disagree, one of the
 * two screens would be lying.
 */
export function readsAsOwed(type: AccountGroupType): boolean {
  return sideOfType(type) === 'liability';
}
