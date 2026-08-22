import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:5001'
  const effectiveMode = env.VITE_THERMO_DATA_MODE || (mode === 'demo' ? 'demo' : 'proxy')
  const useProxy = effectiveMode === 'proxy'

  return {
    base: '/thermo/',
    plugins: [react(), tailwindcss()],
    server: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy: useProxy
        ? {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/setupTests.ts',
    },
  }
})
