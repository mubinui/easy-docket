import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { liveQuery } from 'dexie';
import { from } from 'rxjs';
import { DOCKET_DB } from '../db/db.token';
import { DocketDb } from '../db/docket-db';
import { Account, AccountGroup, AccountGroupType } from '../models/domain';
import { AccountsService } from './accounts.service';
import { LedgerService } from './ledger.service';

/** The fields a caller must supply; the rest default. */
export type AccountGroupDraft = Pick<AccountGroup, 'id' | 'name' | 'type'> &
  Partial<AccountGroup>;

/**
 * Groups are ordered by the position the user gave them, then by name.
 *
 * The name tiebreak is not decoration. `order` is assigned per device, so two
 * devices that each add a group offline can easily agree on the same number;
 * without a second key the list would reorder itself on every sync depending on
 * which row Dexie happened to return first.
 */
export function compareGroups(a: AccountGroup, b: AccountGroup): number {
  return a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

/**
 * Read and write access to account groups.
 *
 * A group owns nothing. Accounts point at it, which is what makes deleting one
 * safe: the accounts stay, they simply stop being filed anywhere.
 */
@Injectable({ providedIn: 'root' })
export class AccountGroupsService {
  private readonly db: DocketDb = inject(DOCKET_DB);
  private readonly ledger = inject(LedgerService);
  private readonly accounts = inject(AccountsService);

  readonly all = toSignal(from(liveQuery(() => this.db.accountGroups.toArray())), {
    initialValue: [] as AccountGroup[],
  });

  /** Every group, in display order. */
  readonly ordered = computed(() => [...this.all()].sort(compareGroups));

  readonly active = computed(() => this.ordered().filter((group) => !group.archived));

  byId(id: string | null | undefined): AccountGroup | undefined {
    return id ? this.all().find((group) => group.id === id) : undefined;
  }

  /**
   * What an account *is*, which its group decides.
   *
   * An account with no group — or one whose group has been deleted on another
   * device and not yet replaced — is `default`. That fallback is what makes a
   * dangling `groupId` harmless rather than a broken screen.
   */
  typeOf(account: Account): AccountGroupType {
    return this.byId(account.groupId)?.type ?? 'default';
  }

  isCreditCard(account: Account): boolean {
    return this.typeOf(account) === 'credit-card';
  }

  /** The accounts filed in a group, in the order the accounts list uses. */
  accountsIn(groupId: string): Account[] {
    return this.accounts.all().filter((account) => account.groupId === groupId);
  }

  /** Accounts in no group, or in a group this device has never heard of. */
  readonly ungrouped = computed(() => {
    const known = new Set(this.all().map((group) => group.id));
    return this.accounts.all().filter((a) => !a.groupId || !known.has(a.groupId));
  });

  async get(id: string): Promise<AccountGroup | undefined> {
    return this.db.accountGroups.get(id);
  }

  async save(draft: AccountGroupDraft): Promise<AccountGroup> {
    return this.ledger.put('accountGroups', {
      order: this.nextOrder(),
      colour: '#3880ff',
      icon: 'folder-outline',
      archived: false,
      createdAt: Date.now(),
      updatedAt: '',
      ...draft,
    } as AccountGroup);
  }

  /** One past the last group, so a new group lands at the bottom of the list. */
  private nextOrder(): number {
    const groups = this.all();
    return groups.length ? Math.max(...groups.map((g) => g.order)) + 1 : 0;
  }

  async setArchived(id: string, archived: boolean): Promise<void> {
    const group = await this.get(id);
    if (!group) return;
    await this.ledger.put('accountGroups', { ...group, archived });
  }

  /**
   * Delete a group and leave its accounts ungrouped.
   *
   * The members are cleared explicitly, before the group goes, for two reasons.
   * The ledger deliberately does not cascade — a delete that could take accounts
   * with it would be a terrifying thing to have in a financial app — and an
   * explicit clear replicates as an ordinary account edit, so another device
   * learns the accounts moved rather than inferring it from an absence.
   */
  async remove(id: string): Promise<void> {
    for (const account of this.accountsIn(id)) {
      await this.ledger.put('accounts', { ...account, groupId: null });
    }
    await this.ledger.remove('accountGroups', id);
  }

  /** File an account into a group, or out of every group with `null`. */
  async moveAccount(accountId: string, groupId: string | null): Promise<void> {
    const account = await this.db.accounts.get(accountId);
    if (!account || (account.groupId ?? null) === groupId) return;
    await this.ledger.put('accounts', { ...account, groupId });
  }

  /**
   * Rewrite the display order to match `ids`.
   *
   * Only groups whose position actually changed are written: reordering three
   * groups should not put every group in the vault into the replication log.
   */
  async reorder(ids: readonly string[]): Promise<void> {
    for (const [index, id] of ids.entries()) {
      const group = this.byId(id);
      if (!group || group.order === index) continue;
      await this.ledger.put('accountGroups', { ...group, order: index });
    }
  }
}
