import { convert, sameCurrency } from '../money/conversion';
import { Account, AccountGroup, Minor } from '../models/domain';
import { BalanceSheetSide, readsAsOwed, sideOfType } from './classification';
import { countsInTotals } from './totals';

/**
 * The accounts screen, arranged.
 *
 * Kept pure and away from Angular so the arithmetic can be tested by stating
 * balances and rates rather than by rendering a screen — the same split the
 * budget and report layers use.
 */
export interface AccountSection {
  /** The group these accounts are filed in, or null for the ungrouped tail. */
  group: AccountGroup | null;
  accounts: Account[];
  /**
   * The section total in the reporting currency.
   *
   * For a credit-card section this is the amount **owed**: a positive number
   * standing for a debt. Everywhere else it is what the accounts hold.
   */
  subtotal: Minor;
  /** True when `subtotal` means "owed" rather than "held". */
  owed: boolean;
  /** Which half of the balance sheet this section belongs to. */
  side: BalanceSheetSide;
  /** Currencies left out of `subtotal` because no rate is known. */
  unconverted: string[];
  /** Accounts in this section the user has excluded from totals. */
  excluded: number;
}

export interface SectionInput {
  accounts: readonly Account[];
  groups: readonly AccountGroup[];
  balances: ReadonlyMap<string, Minor>;
  reporting: string;
  /** Units of the reporting currency per one unit of `currency`, or null. */
  rateFor(currency: string): number | null;
}

/**
 * What a balance means on screen.
 *
 * A credit card's balance is negative when money is owed, which is correct in
 * the ledger and backwards to read on a card. `displayBalance` flips it so the
 * card shows what a statement would: 1,240 owed rather than −1,240 held. The
 * stored balance is untouched, and net worth still subtracts the debt.
 */
export function displayBalance(balance: Minor, owed: boolean): Minor {
  if (!owed) return balance;
  // `-0` is normalised away: negating a zero balance produces it, and a card
  // with nothing on it would otherwise read "−$0.00 owed".
  return balance === 0 ? 0 : -balance;
}

/**
 * Group the accounts for display.
 *
 * Ungrouped accounts come last, in a section with no group rather than a
 * synthetic one — an invented "Other" group would show up in the group picker
 * and in the group management screen, where nobody put it.
 *
 * An account whose `groupId` points at a group this device does not have counts
 * as ungrouped. That is the normal state of affairs for a few seconds after
 * another device deletes a group, and the account has to appear somewhere.
 */
export function buildSections(input: SectionInput): AccountSection[] {
  const { accounts, groups, balances, reporting, rateFor } = input;

  const byId = new Map(groups.map((group) => [group.id, group]));
  const members = new Map<string, Account[]>(groups.map((group) => [group.id, []]));
  const ungrouped: Account[] = [];

  for (const account of accounts) {
    const group = account.groupId ? byId.get(account.groupId) : undefined;
    if (group) members.get(group.id)!.push(account);
    else ungrouped.push(account);
  }

  const sections: AccountSection[] = [];

  for (const group of groups) {
    const inGroup = members.get(group.id) ?? [];
    // An empty group is not shown: the accounts screen answers "where is my
    // money", and a heading with nothing under it answers nothing. The group
    // still exists and is managed on its own screen.
    if (!inGroup.length) continue;
    sections.push(sectionFor(group, inGroup, sideOfType(group.type)));
  }

  // Ungrouped accounts are assets: see `sideOf` for why that is the safe way
  // round to be wrong.
  if (ungrouped.length) sections.push(sectionFor(null, ungrouped, 'asset'));

  return sections;

  function sectionFor(
    group: AccountGroup | null,
    inSection: Account[],
    side: BalanceSheetSide,
  ): AccountSection {
    const owed = group ? readsAsOwed(group.type) : false;
    let total = 0;
    let excluded = 0;
    const missing: string[] = [];

    for (const account of inSection) {
      // An account left out of totals still appears in its group — it is a real
      // account with a real balance — but it is not added in. A subtotal that
      // disagreed with the net worth above it would be worse than either.
      if (!countsInTotals(account)) {
        excluded++;
        continue;
      }

      const balance = balances.get(account.id) ?? account.openingBalance;

      if (sameCurrency(account.currency, reporting)) {
        total += balance;
        continue;
      }

      const rate = rateFor(account.currency);
      if (rate === null) {
        // Left out rather than added as if it were already in the reporting
        // currency, and named so the screen can say the total is partial.
        missing.push(account.currency.toUpperCase());
        continue;
      }
      total += convert(balance, rate, account.currency, reporting);
    }

    return {
      group,
      accounts: inSection,
      subtotal: displayBalance(total, owed),
      owed,
      side,
      unconverted: [...new Set(missing)],
      excluded,
    };
  }
}

/**
 * The balance sheet: what is held, what is owed, and the difference.
 *
 * `liabilities` is a positive number standing for a debt, matching how the
 * sections read. `net` is assets minus liabilities, which is the same figure
 * net worth has always shown — presenting the two halves does not change the
 * arithmetic, it explains it.
 */
export interface BalanceSheet {
  assets: Minor;
  liabilities: Minor;
  net: Minor;
}

export function balanceSheet(sections: readonly AccountSection[]): BalanceSheet {
  let assets = 0;
  let liabilities = 0;

  for (const section of sections) {
    if (section.side === 'liability') liabilities += section.subtotal;
    else assets += section.subtotal;
  }

  return { assets, liabilities, net: assets - liabilities };
}
