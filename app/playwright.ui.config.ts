import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir:'./e2e',timeout:60000,workers:1,use:{...devices['Pixel 7'],channel:'chrome',baseURL:'http://127.0.0.1:4200'} });
