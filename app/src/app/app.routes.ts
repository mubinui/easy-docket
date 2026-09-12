import { Routes } from '@angular/router';
import { unlockedRedirectGuard, vaultGuard } from './core/keys/vault.guard';

/**
 * Every route is lazily loaded. On a phone over a slow connection the first
 * paint should be the unlock screen and nothing else; the ledger screens and
 * the S3/Git adapters they pull in can arrive afterwards.
 */
export const routes: Routes = [
  {
    path: 'vault',
    canActivate: [unlockedRedirectGuard],
    loadComponent: () => import('./features/vault/vault.page').then((m) => m.VaultPage),
  },
  {
    path: 'tabs',
    canActivate: [vaultGuard],
    loadComponent: () => import('./features/shell/tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'transactions',
        loadComponent: () =>
          import('./features/transactions/transactions.page').then((m) => m.TransactionsPage),
      },
      {
        path: 'accounts',
        loadComponent: () =>
          import('./features/accounts/accounts.page').then((m) => m.AccountsPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/settings/settings.page').then((m) => m.SettingsPage),
      },
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
    ],
  },
  {
    // Reached from the Summary screen rather than the tab bar: four tabs stay
    // uncluttered, and budgets are a glance-then-leave screen.
    path: 'budgets',
    canActivate: [vaultGuard],
    loadComponent: () => import('./features/budgets/budgets.page').then((m) => m.BudgetsPage),
  },
  {
    // Set up once, then mostly left alone — so it hangs off the Accounts
    // screen rather than taking a fifth tab.
    path: 'account-groups',
    canActivate: [vaultGuard],
    loadComponent: () =>
      import('./features/accounts/groups.page').then((m) => m.AccountGroupsPage),
  },
  {
    path: 'recurring',
    canActivate: [vaultGuard],
    loadComponent: () => import('./features/recurring/rules.page').then((m) => m.RulesPage),
  },
  {
    path: 'data',
    canActivate: [vaultGuard],
    loadComponent: () => import('./features/data/data.page').then((m) => m.DataPage),
  },
  {
    path: 'rates',
    canActivate: [vaultGuard],
    loadComponent: () => import('./features/rates/rates.page').then((m) => m.RatesPage),
  },
  {
    path: 'reports',
    canActivate: [vaultGuard],
    loadComponent: () => import('./features/reports/reports.page').then((m) => m.ReportsPage),
  },
  {
    path: 'settings/sync',
    canActivate: [vaultGuard],
    loadComponent: () =>
      import('./features/settings/sync-settings.page').then((m) => m.SyncSettingsPage),
  },
  {
    path: 'settings/totals',
    canActivate: [vaultGuard],
    loadComponent: () =>
      import('./features/settings/totals.page').then((m) => m.TotalsSettingsPage),
  },
  {
    path: 'settings/security',
    canActivate: [vaultGuard],
    loadComponent: () =>
      import('./features/settings/security.page').then((m) => m.SecurityPage),
  },
  { path: '', redirectTo: 'tabs/dashboard', pathMatch: 'full' },
  { path: '**', redirectTo: 'tabs/dashboard' },
];
