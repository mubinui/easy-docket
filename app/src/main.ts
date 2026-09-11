import { enableProdMode, isDevMode, provideAppInitializer } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  PreloadAllModules,
  RouteReuseStrategy,
  provideRouter,
  withPreloading,
} from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { bootstrapApp } from './app/core/app-bootstrap';
import { SecureStore, secureStoreFactory } from './app/core/keys/secure-store';
import { environment } from './environments/environment';
import { provideServiceWorker } from '@angular/service-worker';

if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    // Material styling on every platform: a ledger should look the same on the
    // phone and the laptop it is reconciled on.
    provideIonicAngular({ mode: 'md' }),
    // Preloading the remaining routes after the first paint keeps navigation
    // instant offline, which is the state this app is designed around.
    provideRouter(routes, withPreloading(PreloadAllModules)),
    // Resolved once, at startup: a hardware keystore on Android, memory-only in
    // a browser. See secure-store.ts for why the web has no durable option.
    { provide: SecureStore, useFactory: secureStoreFactory },
    provideAppInitializer(bootstrapApp),
    // The service worker is what makes the PWA genuinely offline-capable:
    // the app shell is cached on install, so a cold start with no network
    // reaches the unlock screen exactly as fast as an online one.
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
}).catch((error) => console.error('Easy Docket failed to start', error));
