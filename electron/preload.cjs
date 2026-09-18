// Ponte segura entre o processo principal (Node/Electron) e o site carregado na janela.
// contextIsolation fica ligado (main.cjs) -- o site nunca ganha acesso direto a Node/IPC,
// so a este objeto explicito e minimo, do jeito que o Electron recomenda.

const { contextBridge, ipcRenderer } = require('electron')

// Copia vinda da Microsoft Store: quem atualiza e a Loja. As funcoes de atualizacao nao sao
// expostas, e o site ja decide pela AUSENCIA delas (`typeof ...checkForUpdates === 'function'`)
// se mostra ou nao o botao de atualizar -- nao precisou de nenhuma mudanca no site.
const isStoreBuild = ipcRenderer.sendSync('ana:is-store-build') === true

const update = isStoreBuild
  ? {}
  : {
      /** Pede pro processo principal checar atualizacoes agora (sempre mostra um resultado,
       *  mesmo "ja esta atualizado" -- o dialogo nativo aparece do lado do main.cjs). */
      checkForUpdates() {
        ipcRenderer.send('ana:check-for-updates')
      },
      /** Instala AGORA a atualizacao ja baixada e reabre o app (botao "Reiniciar e atualizar" do
       *  aviso). So faz efeito depois do status 'downloaded'. */
      quitAndInstall(notice) {
        ipcRenderer.send('ana:quit-and-install', notice)
      },
      /** Chama `cb` a cada mudanca de status da checagem/download de atualizacao (checando,
       *  achou, sem novidade, baixando com %, pronto, erro) -- da o feedback visivel que o
       *  dialogo nativo sozinho nao cobre (ex.: nada aparece enquanto so esta checando). */
      onUpdateStatus(cb) {
        const listener = (_event, payload) => cb(payload)
        ipcRenderer.on('ana:update-status', listener)
        return () => ipcRenderer.removeListener('ana:update-status', listener)
      },
    }

contextBridge.exposeInMainWorld('anaElectron', {
  platform: 'win32',
  /** De onde veio esta copia: Microsoft Store ou instalador baixado do site. */
  isStoreBuild,
  ...update,
  /** Versao do instalador nativo instalado (package.json). Lida uma vez, de forma sincrona,
   *  no carregamento -- o site usa pra decidir se mostra o aviso de "atualizacao disponivel". */
  appVersion: ipcRenderer.sendSync('ana:get-version'),
  /** Chama `cb` quando o atalho global de gravar (Ctrl+Shift+G) e pressionado. Devolve uma
   *  funcao para cancelar a inscricao (mesmo padrao de um addEventListener/useEffect). */
  onRecordHotkey(cb) {
    const listener = () => cb()
    ipcRenderer.on('ana:hotkey-record', listener)
    return () => ipcRenderer.removeListener('ana:hotkey-record', listener)
  },
  /** Pede a reconexao do audio do sistema quando o Windows troca o aparelho de saida no meio
   *  da reuniao (fone bluetooth que conecta). O site nao consegue refazer o getDisplayMedia
   *  sozinho -- falta a ativacao transitoria --, entao o main devolve a chamada com gesto. */
  requestSystemAudioReattach() {
    ipcRenderer.send('ana:reattach-system-audio')
  },
  /** Caminhos reais deste app no disco: de ONDE ele esta rodando, onde ficam as gravacoes
   *  guardadas localmente antes de transcrever, a pasta de logs, e se sobraram copias antigas
   *  instaladas. Usado pela tela de Configuracoes -- e o que permite o usuario CONFERIR que
   *  esta na instalacao certa em vez de confiar so no numero de versao (que vem do site e por
   *  isso e igual em todas as copias). */
  getPaths() {
    return ipcRenderer.invoke('ana:get-paths')
  },
  /** Abre uma das pastas devolvidas por getPaths() no Explorer. O processo principal so aceita
   *  caminhos da propria lista que ele reportou -- o site nunca consegue abrir/executar um
   *  caminho arbitrario no PC. */
  openPath(target) {
    ipcRenderer.send('ana:open-path', target)
  },
})
