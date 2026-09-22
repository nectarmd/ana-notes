import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'br.com.tailorexec.tena',
  appName: 'ANA',
  webDir: 'dist',
  // Carrega o app publicado: cada deploy web atualiza o app sem gerar novo APK.
  // Para uma build "offline"/loja, remova o bloco server e use os assets de webDir.
  server: {
    url: 'https://ana.nectarmd.com.br',
    androidScheme: 'https',
  },
  android: {
    // permite getUserMedia (microfone) na WebView
    allowMixedContent: false,
  },
}

export default config
