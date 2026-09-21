import { BrandMarkComponent } from '../../shared/brand-mark.component';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Component } from '@angular/core';
import { addIcons } from 'ionicons';
import { listOutline, pieChartOutline, settingsOutline, walletOutline, barChartOutline, repeatOutline, shieldCheckmarkOutline, layersOutline } from 'ionicons/icons';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [BrandMarkComponent, RouterLink, RouterLinkActive, IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs],
  styles: [`
    .sidebar { display: none; }
    @media (min-width: 900px) {
      .sidebar { display: flex; flex-direction: column; position: absolute; inset: 0 auto 0 0; width: 232px; z-index: 5; background: var(--docket-sidebar); border-right: 1px solid var(--docket-line); padding: 36px 16px 24px; }
      .identity { display: flex; align-items: center; gap: 11px; padding: 0 12px 36px; color: var(--ion-text-color); text-decoration: none; font-size: 18px; font-weight: 650; letter-spacing: -.025em; }
      .identity img { width: 31px; height: 31px; }
      nav { display: grid; gap: 5px; }
      nav a { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 11px; color: var(--ion-text-color); font-size: 14px; text-decoration: none; transition: background 160ms ease-out; }
      nav a:hover { background: var(--docket-hover); }
      nav a.active { box-shadow: var(--docket-surface-light), var(--docket-control-elevation); background: var(--ion-card-background); color: var(--ion-color-primary); font-weight: 600; }
      nav ion-icon { font-size: 20px; }
      .nav-caption { font-size: 11px; font-weight: 600; color: var(--docket-secondary); margin: 28px 14px 10px; }
      .sidebar-footer { margin-top: auto; border-top: 1px solid var(--docket-line); padding: 20px 12px 0; display: flex; gap: 10px; color: var(--docket-secondary); font-size: 12px; line-height: 1.6; }
      .sidebar-footer ion-icon { font-size: 20px; margin-top: 2px; }
      .sidebar-footer strong { display: block; color: var(--ion-text-color); font-weight: 550; }
    }
  `],
  template: `
    <aside class="sidebar" aria-label="Main navigation">
      <a class="identity" routerLink="/tabs/dashboard"><app-brand-mark />Easy Docket</a>
      <nav>
        <a routerLink="/tabs/dashboard" routerLinkActive="active" ariaCurrentWhenActive="page"><ion-icon name="pie-chart-outline" />Summary</a>
        <a routerLink="/tabs/transactions" routerLinkActive="active" ariaCurrentWhenActive="page"><ion-icon name="list-outline" />Activity</a>
        <a routerLink="/tabs/accounts" routerLinkActive="active" ariaCurrentWhenActive="page"><ion-icon name="wallet-outline" />Accounts</a>
      </nav>
      <p class="nav-caption">Planning</p>
      <nav>
        <a routerLink="/budgets"><ion-icon name="layers-outline" />Budgets</a>
        <a routerLink="/reports"><ion-icon name="bar-chart-outline" />Reports</a>
        <a routerLink="/recurring"><ion-icon name="repeat-outline" />Recurring</a>
      </nav>
      <p class="nav-caption">Preferences</p>
      <nav><a routerLink="/tabs/settings" routerLinkActive="active" ariaCurrentWhenActive="page"><ion-icon name="settings-outline" />Settings</a></nav>
      <div class="sidebar-footer"><ion-icon name="shield-checkmark-outline" /><div><strong>Your money. Your business.</strong>Stored on this device.</div></div>
    </aside>

    <!--
      No <ion-router-outlet> here: IonTabs renders its own inside .tabs-inner.
      Declaring a second one projects an empty, absolutely-positioned outlet
      over the tab content, which silently swallows taps in the area it covers —
      the floating action buttons among them.
    -->
    <ion-tabs>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="dashboard" href="/tabs/dashboard">
          <ion-icon name="pie-chart-outline" />
          <ion-label>Summary</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="transactions" href="/tabs/transactions">
          <ion-icon name="list-outline" />
          <ion-label>Activity</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="accounts" href="/tabs/accounts">
          <ion-icon name="wallet-outline" />
          <ion-label>Accounts</ion-label>
        </ion-tab-button>

        <ion-tab-button tab="settings" href="/tabs/settings">
          <ion-icon name="settings-outline" />
          <ion-label>Settings</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  `,
})
export class TabsPage {
  constructor() {
    addIcons({ pieChartOutline, listOutline, walletOutline, settingsOutline, barChartOutline, repeatOutline, shieldCheckmarkOutline, layersOutline });
  }
}
