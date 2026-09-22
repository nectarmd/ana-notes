import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'favicon-48.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'ANA - AI Notes Advisor',
        short_name: 'ANA',
        description: 'IA de anotacoes, transcricoes e analise de reunioes',
        // Claro e o tema padrao do app (ThemeProvider.tsx): a splash screen do PWA instalado
        // usa ESTA cor fixa (nao a dinamica do <meta theme-color>, que so existe depois que o
        // JS roda). Deixar preto aqui fazia todo mundo no tema claro (a maioria) ver um flash
        // preto e a barra de status do Android preta brigando com um app branco.
        theme_color: '#FFFFFF',
        background_color: '#FFFFFF',
        display: 'standalone',
        // Nectar Finance (mesmo dono, PWA comprovadamente 100% tela cheia no iOS) usa exatamente
        // esta forma simples -- start_url/scope, sem id nem display_override. Adicionamos id +
        // display_override numa tentativa anterior sem confirmar que ajudava; removido para bater
        // exatamente com a configuracao que sabemos que funciona, em vez de arriscar que campos
        // extras (nao usados na referencia) atrapalhem o Safari a decidir o modo do app.
        start_url: '/',
        scope: '/',
        orientation: 'portrait-primary',
        lang: 'pt-BR',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Nao precachear os pesados de extracao de PDF/DOCX (carregam sob demanda).
        globIgnores: ['**/pdf-*.js', '**/pdf.worker*', '**/mammoth-*.js', '**/jspdf*.js', '**/html2canvas*.js'],
        navigateFallbackDenylist: [/^\/api/],
        // Atualiza o app imediatamente ao publicar (evita servir versao antiga em cache).
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
  },
})
