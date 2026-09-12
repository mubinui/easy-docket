import { Account } from '../models/domain';

/**
 * Whether an account is part of "what am I worth".
 *
 * The single place that decides it, so the accounts screen, the summary and the
 * service cannot drift apart on a question the user has answered once.
 *
 * The absent field means counted: every account written before the setting
 * existed, and every newly created one, is included until someone says
 * otherwise.
 */
export function countsInTotals(account: Account): boolean {
  return account.excludedFromTotals !== true;
}
