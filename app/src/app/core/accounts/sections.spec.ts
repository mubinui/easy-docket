import { describe, expect, it } from 'vitest';
import { anAccount, anAccountGroup } from '../testing/factories';
import { AccountSection, buildSections, displayBalance } from './sections';

/** A rate table stated as "one unit of X buys this many USD". */
function rates(table: Record<string, number>) {
  return (currency: string) => table[currency.toUpperCase()] ?? null;
}

function sections(
  accounts: Parameters<typeof buildSections>[0]['accounts'],
  groups: Parameters<typeof buildSections>[0]['groups'],
  balances: Record<string, number>,
  rateFor: (c: string) => number | null = () => null,
  reporting = 'USD',
): AccountSection[] {
  return buildSections({
    accounts,
    groups,
    balances: new Map(Object.entries(balances)),
    reporting,
    rateFor,
  });
}

describe('displayBalance', () => {
  it('leaves an ordinary balance alone', () => {
    expect(displayBalance(4_100_00, false)).toBe(4_100_00);
    expect(displayBalance(-25_00, false)).toBe(-25_00);
  });

  it('flips a card balance so a debt reads as a positive amount owed', () => {
    expect(displayBalance(-1_240_00, true)).toBe(1_240_00);
  });

  it('shows a card in credit as a negative amount owed', () => {
    // Overpaying a card is unusual but real, and "−50 owed" is the honest way
    // to say the card owes you.
    expect(displayBalance(50_00, true)).toBe(-50_00);
  });
});

describe('buildSections', () => {
  it('puts each account under its group', () => {
    const result = sections(
      [
        anAccount({ id: 'a-visa', name: 'Visa', groupId: 'g-cards' }),
        anAccount({ id: 'a-cash', name: 'Everyday', groupId: 'g-day' }),
      ],
      [
        anAccountGroup({ id: 'g-cards', name: 'Cards', type: 'credit-card', order: 0 }),
        anAccountGroup({ id: 'g-day', name: 'Everyday', type: 'default', order: 1 }),
      ],
      { 'a-visa': -1_240_00, 'a-cash': 4_100_00 },
    );

    expect(result.map((s) => s.group?.name)).toEqual(['Cards', 'Everyday']);
    expect(result[0].accounts.map((a) => a.id)).toEqual(['a-visa']);
    expect(result[1].accounts.map((a) => a.id)).toEqual(['a-cash']);
  });

  it('keeps the group order it was given', () => {
    const result = sections(
      [
        anAccount({ id: 'a-1', groupId: 'g-2' }),
        anAccount({ id: 'a-2', groupId: 'g-1' }),
      ],
      [
        anAccountGroup({ id: 'g-1', name: 'First', order: 0 }),
        anAccountGroup({ id: 'g-2', name: 'Second', order: 1 }),
      ],
      {},
    );

    expect(result.map((s) => s.group?.name)).toEqual(['First', 'Second']);
  });

  it('puts ungrouped accounts last, in a section with no group', () => {
    const result = sections(
      [
        anAccount({ id: 'a-loose', groupId: null }),
        anAccount({ id: 'a-filed', groupId: 'g-1' }),
      ],
      [anAccountGroup({ id: 'g-1', name: 'Cards' })],
      {},
    );

    expect(result).toHaveLength(2);
    expect(result[1].group).toBeNull();
    expect(result[1].accounts.map((a) => a.id)).toEqual(['a-loose']);
  });

  it('treats an account with no groupId at all as ungrouped', () => {
    const result = sections([anAccount({ id: 'a-legacy' })], [], {});
    expect(result[0].group).toBeNull();
  });

  it('treats an account pointing at an unknown group as ungrouped', () => {
    // The normal state for a few seconds after another device deletes a group.
    const result = sections([anAccount({ id: 'a-1', groupId: 'g-gone' })], [], {});

    expect(result).toHaveLength(1);
    expect(result[0].group).toBeNull();
    expect(result[0].accounts.map((a) => a.id)).toEqual(['a-1']);
  });

  it('omits a group with nothing in it', () => {
    const result = sections([], [anAccountGroup({ id: 'g-1', name: 'Cards' })], {});
    expect(result).toEqual([]);
  });

  it('omits the ungrouped section when every account is filed', () => {
    const result = sections(
      [anAccount({ id: 'a-1', groupId: 'g-1' })],
      [anAccountGroup({ id: 'g-1' })],
      {},
    );

    expect(result).toHaveLength(1);
    expect(result[0].group).not.toBeNull();
  });

  describe('subtotals', () => {
    it('adds up the accounts in a section', () => {
      const result = sections(
        [
          anAccount({ id: 'a-1', groupId: 'g-1' }),
          anAccount({ id: 'a-2', groupId: 'g-1' }),
        ],
        [anAccountGroup({ id: 'g-1', type: 'default' })],
        { 'a-1': 300_00, 'a-2': 125_50 },
      );

      expect(result[0].subtotal).toBe(425_50);
      expect(result[0].owed).toBe(false);
    });

    it('falls back to the opening balance for an account with no computed one', () => {
      const result = sections(
        [anAccount({ id: 'a-1', openingBalance: 75_00, groupId: null })],
        [],
        {},
      );

      expect(result[0].subtotal).toBe(75_00);
    });

    it('reports a credit-card section as the total owed', () => {
      const result = sections(
        [
          anAccount({ id: 'a-visa', groupId: 'g-cards' }),
          anAccount({ id: 'a-amex', groupId: 'g-cards' }),
        ],
        [anAccountGroup({ id: 'g-cards', type: 'credit-card' })],
        { 'a-visa': -1_240_00, 'a-amex': -310_00 },
      );

      expect(result[0].owed).toBe(true);
      expect(result[0].subtotal).toBe(1_550_00);
    });

    it('does not flip a debit-card section', () => {
      // A debit card draws on money already held, so its balance reads the
      // ordinary way. Only credit changes the framing.
      const result = sections(
        [anAccount({ id: 'a-1', groupId: 'g-1' })],
        [anAccountGroup({ id: 'g-1', type: 'debit-card' })],
        { 'a-1': 820_00 },
      );

      expect(result[0].owed).toBe(false);
      expect(result[0].subtotal).toBe(820_00);
    });

    it('converts foreign balances into the reporting currency', () => {
      const result = sections(
        [
          anAccount({ id: 'a-usd', currency: 'USD', groupId: 'g-1' }),
          anAccount({ id: 'a-eur', currency: 'EUR', groupId: 'g-1' }),
        ],
        [anAccountGroup({ id: 'g-1' , type: 'default' })],
        { 'a-usd': 100_00, 'a-eur': 100_00 },
        rates({ EUR: 1.1 }),
      );

      expect(result[0].subtotal).toBe(210_00);
      expect(result[0].unconverted).toEqual([]);
    });

    it('leaves out a currency with no rate and names it', () => {
      const result = sections(
        [
          anAccount({ id: 'a-usd', currency: 'USD', groupId: 'g-1' }),
          anAccount({ id: 'a-gbp', currency: 'GBP', groupId: 'g-1' }),
        ],
        [anAccountGroup({ id: 'g-1', type: 'default' })],
        { 'a-usd': 100_00, 'a-gbp': 999_00 },
      );

      // Adding £999 to a dollar total as if it were $999 would be a plainly
      // wrong number presented confidently.
      expect(result[0].subtotal).toBe(100_00);
      expect(result[0].unconverted).toEqual(['GBP']);
    });

    it('names each missing currency once', () => {
      const result = sections(
        [
          anAccount({ id: 'a-1', currency: 'gbp', groupId: 'g-1' }),
          anAccount({ id: 'a-2', currency: 'GBP', groupId: 'g-1' }),
        ],
        [anAccountGroup({ id: 'g-1', type: 'default' })],
        { 'a-1': 10_00, 'a-2': 20_00 },
      );

      expect(result[0].unconverted).toEqual(['GBP']);
    });

    it('converts a card debt before reporting what is owed', () => {
      const result = sections(
        [anAccount({ id: 'a-eur', currency: 'EUR', groupId: 'g-cards' })],
        [anAccountGroup({ id: 'g-cards', type: 'credit-card' })],
        { 'a-eur': -100_00 },
        rates({ EUR: 1.1 }),
        'USD',
      );

      expect(result[0].subtotal).toBe(110_00);
      expect(result[0].owed).toBe(true);
    });
  });

  describe('accounts left out of totals', () => {
    it('still lists the account, but does not add it in', async () => {
      const result = sections(
        [
          anAccount({ id: 'a-mine', groupId: 'g-1' }),
          anAccount({ id: 'a-theirs', groupId: 'g-1', excludedFromTotals: true }),
        ],
        [anAccountGroup({ id: 'g-1', type: 'default' })],
        { 'a-mine': 100_00, 'a-theirs': 900_00 },
      );

      // The row is there — it is a real account with a real balance.
      expect(result[0].accounts.map((a) => a.id)).toEqual(['a-mine', 'a-theirs']);
      // The subtotal is not.
      expect(result[0].subtotal).toBe(100_00);
      expect(result[0].excluded).toBe(1);
    });

    it('counts an account with the field absent, as every old ledger has', () => {
      const result = sections(
        [anAccount({ id: 'a-1', groupId: 'g-1' })],
        [anAccountGroup({ id: 'g-1', type: 'default' })],
        { 'a-1': 100_00 },
      );

      expect(result[0].subtotal).toBe(100_00);
      expect(result[0].excluded).toBe(0);
    });

    it('leaves a section headed but empty-totalled when everything in it is excluded', () => {
      const result = sections(
        [anAccount({ id: 'a-1', groupId: 'g-1', excludedFromTotals: true })],
        [anAccountGroup({ id: 'g-1', type: 'default' })],
        { 'a-1': 100_00 },
      );

      expect(result[0].accounts).toHaveLength(1);
      expect(result[0].subtotal).toBe(0);
      expect(result[0].excluded).toBe(1);
    });

    it('does not report an excluded currency as unconverted', () => {
      // It is left out because the user said so, not because a rate is missing;
      // telling them to add a rate would be a red herring.
      const result = sections(
        [anAccount({ id: 'a-gbp', currency: 'GBP', groupId: 'g-1', excludedFromTotals: true })],
        [anAccountGroup({ id: 'g-1', type: 'default' })],
        { 'a-gbp': 100_00 },
      );

      expect(result[0].unconverted).toEqual([]);
      expect(result[0].excluded).toBe(1);
    });

    it('leaves an excluded card out of what a card section says is owed', () => {
      const result = sections(
        [
          anAccount({ id: 'a-visa', groupId: 'g-cards' }),
          anAccount({ id: 'a-old', groupId: 'g-cards', excludedFromTotals: true }),
        ],
        [anAccountGroup({ id: 'g-cards', type: 'credit-card' })],
        { 'a-visa': -100_00, 'a-old': -900_00 },
      );

      expect(result[0].subtotal).toBe(100_00);
    });
  });
});
