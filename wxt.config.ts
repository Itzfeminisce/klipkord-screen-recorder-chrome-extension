import { defineConfig } from 'wxt';

// A stable extension ID fixes the Penv Cloud redirect URL; set WXT_EXTENSION_KEY for release builds.
const extensionKey = process.env.WXT_EXTENSION_KEY || undefined;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    ...(extensionKey ? { key: extensionKey } : {}),
    name: 'Klipkord',
    description: 'Screen recorder in the Chrome side panel',
    permissions: ['sidePanel', 'offscreen', 'desktopCapture', 'storage', 'unlimitedStorage', 'identity'],
    // Requested only when the user turns on Penv Cloud, a cloud key or Ollama.
    optional_host_permissions: [
      'https://penv.cloud/*',
      'https://api.groq.com/*',
      'https://openrouter.ai/*',
      'https://api.openai.com/*',
      'https://api.anthropic.com/*',
      'http://localhost:11434/*',
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
    // Cross-origin isolation lets ONNX Runtime use wasm threads on CPU-only machines.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
  },
});
