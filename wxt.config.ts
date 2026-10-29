import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Klipkord',
    description: 'Screen recorder in the Chrome side panel',
    permissions: ['offscreen', 'desktopCapture', 'storage'],
    // T0: the machine check opens from Details > Extension options.
    options_page: 'check.html',
  },
});
