import { Component } from '@angular/core';
import { addIcons } from 'ionicons';
import { listOutline, pieChartOutline, settingsOutline, walletOutline } from 'ionicons/icons';
import { IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular';

@Component({
  selector: 'app-tabs',
  standalone: true,
  imports: [IonIcon, IonLabel, IonTabBar, IonTabButton, IonTabs],
  template: `
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
    addIcons({ pieChartOutline, listOutline, walletOutline, settingsOutline });
  }
}
