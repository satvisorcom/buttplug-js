import { fileURLToPath, URL } from "url";
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// The WASM binary imports env.now (performance.now shim from the `instant` crate).
function wasmEnvPlugin() {
  const VIRTUAL_ENV = '\0wasm-env';
  const VIRTUAL_WS = '\0stub-ws';
  return {
    name: 'wasm-env-and-stubs',
    resolveId(id) {
      if (id === 'env') return VIRTUAL_ENV;
      // Stub out the Node `ws` module — not needed in browser
      if (id === 'ws') return VIRTUAL_WS;
    },
    load(id) {
      if (id === VIRTUAL_ENV) {
        return 'export function now() { return performance.now(); }';
      }
      if (id === VIRTUAL_WS) {
        return 'export const WebSocket = globalThis.WebSocket;';
      }
    },
  };
}

export default defineConfig({
  plugins: [
    wasmEnvPlugin(),
    wasm(),
    topLevelAwait(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  server: {
    port: 5177,
  },
});
