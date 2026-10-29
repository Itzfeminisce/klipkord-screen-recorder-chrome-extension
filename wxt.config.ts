import { defineConfig } from 'wxt';

// A stable extension ID fixes the Penv Cloud redirect URL; set WXT_EXTENSION_KEY for release builds.
const extensionKey = process.env.WXT_EXTENSION_KEY || undefined;
// Release = `wxt zip` or `--mode release`. Plain dev builds work without the key.
const release = process.argv.includes('zip') || process.argv.includes('release');
if (release && !extensionKey) {
  throw new Error('Release build needs WXT_EXTENSION_KEY, the key that fixes the Penv Cloud redirect URL. Set it in .env.local or the environment.');
}

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
    // O1: the Web Store item's public key goes in `manifest.key` (until then WXT_EXTENSION_KEY sets it).
    ...(extensionKey ? { key: extensionKey } : {}),
    name: 'Klipkord',
    description: 'Screen recorder in the Chrome side panel',
    // activeTab (granted by a shortcut) + scripting draw the marker toast in the active tab.
    permissions: ['sidePanel', 'offscreen', 'desktopCapture', 'storage', 'unlimitedStorage', 'identity', 'activeTab', 'scripting'],
    // Requested only when the user turns on Penv Cloud, a cloud key, Ollama or Google Drive.
    optional_host_permissions: [
      'https://penv.cloud/*',
      'https://api.groq.com/*',
      'https://openrouter.ai/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'http://localhost:11434/*',
      'https://www.googleapis.com/*',
    ],
    action: { default_title: 'Open Klipkord' },
    commands: {
      'toggle-recording': { suggested_key: { default: 'Alt+Shift+R' }, description: 'Start or stop recording' },
      'toggle-pause': { suggested_key: { default: 'Alt+Shift+P' }, description: 'Pause or resume recording' },
      'add-marker': { suggested_key: { default: 'Alt+Shift+M' }, description: 'Add a marker' },
    },
    // ONNX Runtime compiles its bundled wasm; MV3 blocks that without 'wasm-unsafe-eval'.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // The Whisper check fetches models from Hugging Face, which redirects to its CDN hosts.
    host_permissions: ['https://huggingface.co/*', 'https://*.hf.co/*'],
  },
});
