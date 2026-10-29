import { defineConfig } from 'wxt';

// Klipkord's public key fixes the extension id (iapgbifdchhmidblniddncnagghloepi) for Penv Cloud, Google and the Web Store.
// It is public; the private key stays with the owner and is uploaded once, with the first Web Store zip.
const KLIPKORD_KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsgE5EguZ5k4ildTMikSj16eCiu4JLqrcIcvovWNeR7f5AYXIeaZmunEwQm1S+f0f02OrkjTGjqnN5kWi9spIk+uhVIYYpT7Jn38uE9g51/0Gz8dgPeFpQnW8xdC6YJMjLangx8C1U5izTRWK7GuGl6ORDC7GsBLlcMZsajhbhBozCfVsmvBEujinqr/b/nIY/OvMTVlnMkGTSDA+8OT0SKoSPm9F742wITYjkSrbG4XRqrmRxYGebR6oi6pQ1e+LGkcjragX/KuiM3qgI7/YGRkRCspV0IG1L7x8THxYF8mn8gA6weVIWNo6BkuS1cpzUGDhnbpXc86NBoO6DVpKewIDAQAB';
const extensionKey = process.env.WXT_EXTENSION_KEY || KLIPKORD_KEY;
// Release = `wxt zip` or `--mode release`.
const release = process.argv.includes('zip') || process.argv.includes('release');

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    // The machine check is a developer page; it stays out of the release zip.
    'entrypoints:found': (_wxt, infos) => {
      if (!release) return;
      const at = infos.findIndex((info) => info.name === 'check');
      if (at >= 0) infos.splice(at, 1);
    },
  },
  manifest: {
    key: extensionKey,
    name: 'Klipkord',
    description: 'Screen recorder in the Chrome side panel',
    // activeTab (granted by a shortcut) + scripting draw the marker toast in the active tab.
    permissions: ['sidePanel', 'offscreen', 'desktopCapture', 'storage', 'unlimitedStorage', 'identity', 'activeTab', 'scripting'],
    // Requested only when the user turns on Penv Cloud, a cloud key, Ollama or Google Drive, or allows drawing on a site.
    optional_host_permissions: [
      'https://penv.cloud/*',
      'https://api.groq.com/*',
      'https://openrouter.ai/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'http://localhost:11434/*',
      'https://www.googleapis.com/*',
      '<all_urls>',
    ],
    action: { default_title: 'Open Klipkord' },
    commands: {
      'toggle-recording': { suggested_key: { default: 'Alt+Shift+R' }, description: 'Start or stop recording' },
      'toggle-pause': { suggested_key: { default: 'Alt+Shift+P' }, description: 'Pause or resume recording' },
      'add-marker': { suggested_key: { default: 'Alt+Shift+M' }, description: 'Add a marker' },
      'toggle-draw': { suggested_key: { default: 'Alt+Shift+D' }, description: 'Draw on this page' },
    },
    // ONNX Runtime compiles its bundled wasm; MV3 blocks that without 'wasm-unsafe-eval'.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // The Whisper check fetches models from Hugging Face, which redirects to its CDN hosts.
    host_permissions: ['https://huggingface.co/*', 'https://*.hf.co/*'],
  },
});
