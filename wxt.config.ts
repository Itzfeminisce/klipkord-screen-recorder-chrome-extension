import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Klipkord',
    description: 'Screen recorder in the Chrome side panel',
    permissions: ['offscreen', 'desktopCapture', 'storage'],
    // T0: the machine check opens from Details > Extension options.
    options_page: 'check.html',
    // ONNX Runtime compiles its bundled wasm; MV3 blocks that without 'wasm-unsafe-eval'.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // Cross-origin isolation lets ONNX Runtime use wasm threads on CPU-only machines.
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
  },
});
