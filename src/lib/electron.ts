// Ponte com o app Windows nativo (Electron) -- so existe quando o site roda dentro do wrapper
// (ver electron/preload.cjs). No navegador comum e no PWA, window.anaElectron e undefined,
// entao tudo aqui vira no-op fora do app Windows.

export type AnaUpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'not-available' }
  | { status: 'downloading'; percent: number; version?: string }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }
  | { status: 'cancelled' }

/**
 * Onde o app Windows realmente esta no disco. Existe por causa de um caso real (09/2026): uma
 * usuaria tinha 3-4 copias do ANA instaladas e usava uma ANTIGA sem perceber -- todas mostravam
 * a mesma versao na tela, porque o numero exibido e o do SITE, e o app e um wrapper que carrega
 * o site ao vivo. Estes caminhos sao a unica coisa que difere de verdade entre as copias.
 */
export interface AnaPaths {
  /** Versao do INSTALADOR nativo. Uso interno (atualizacao, suporte): na tela so aparece APP_VERSION. */
  version: string
  /** Endereco que este wrapper carrega. Copias anteriores a 0.18.30 apontam pro dominio antigo,
   *  e dominio diferente = armazenamento local diferente (login e pendentes separados). */
  appUrl: string
  exePath: string
  /** Pasta de onde o app esta rodando AGORA. */
  installDir: string
  /** Pasta que o instalador registrou como a oficial. `null` se o registro nao existe. */
  registeredInstallDir: string | null
  /** true quando installDir != registeredInstallDir: esta e uma copia fora do lugar. */
  isStaleCopy: boolean
  userDataDir: string
  /** Onde ficam, no disco, as gravacoes guardadas antes de transcrever (rede de seguranca). */
  recordingsBackupDir: string
  logFile: string
  /** Pasta do log. E ela que openPath() aceita -- abrir pasta abre o Explorer, abrir arquivo
   *  executaria algo. */
  logDir: string
  /** Outras pastas do PC que ainda tem um "ANA by Tailor.exe" -- instalacoes sobrando. */
  otherCopies: string[]
}

export interface AnaElectronBridge {
  platform: 'win32'
  /** Versao do instalador nativo instalado. `undefined` em instaladores antigos (anteriores a
   *  este recurso) -- tratados como desatualizados pelo aviso de atualizacao. */
  appVersion?: string
  onRecordHotkey: (cb: () => void) => () => void
  checkForUpdates: () => void
  onUpdateStatus: (cb: (payload: AnaUpdateStatus) => void) => () => void
  /** Instala agora a atualizacao ja baixada e reabre o app. `undefined` em instaladores antigos
   *  (capability-gated) -- nesse caso o aviso cai no fallback de baixar por link. */
  quitAndInstall?: (notice?: {
    title: string
    body: string
    doneTitle?: string
    doneBody?: string
    slowTitle?: string
    slowBody?: string
  }) => void
  /** Pede ao processo principal que reconecte o audio do sistema (loopback) apos o Windows
   *  trocar o aparelho de saida. Precisa passar pelo main porque getDisplayMedia exige uma
   *  ativacao transitoria, e so ele consegue simular o gesto. `undefined` em instaladores
   *  antigos -- ali o aviso de audio mudo de 30s continua sendo a rede de protecao. */
  requestSystemAudioReattach?: () => void
  /** Caminhos reais do app no disco. `undefined` em instaladores anteriores a 0.19.5 -- a tela
   *  de Configuracoes simplesmente nao mostra a secao nesse caso. */
  getPaths?: () => Promise<AnaPaths>
  /** Abre no Explorer uma das pastas devolvidas por getPaths(). Qualquer outro caminho e
   *  recusado pelo processo principal. */
  openPath?: (target: string) => void
}

declare global {
  interface Window {
    anaElectron?: AnaElectronBridge
  }
}

export function isElectron(): boolean {
  return typeof window !== 'undefined' && !!window.anaElectron
}
