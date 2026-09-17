// Processo principal do app Windows (Electron). Wrapper FINO: carrega o site publicado ao
// vivo (mesmo padrao do APK Android via Capacitor, que aponta pra server.url) -- correcoes e
// features novas do site chegam sozinhas, sem precisar gerar/redistribuir um instalador novo.
// So o que precisa mesmo de codigo nativo vive aqui: atalho global e captura de audio do
// sistema sem o dialogo de escolha do SO.

const { app, BrowserWindow, Tray, Menu, globalShortcut, session, desktopCapturer, nativeImage, dialog, ipcMain, shell, Notification } = require('electron')
const { autoUpdater } = require('electron-updater')
const log = require('electron-log/main')
const path = require('node:path')
const fs = require('node:fs')
const { execFile, spawn } = require('node:child_process')

const APP_URL = 'https://ana.nectarmd.com.br'
const RECORD_HOTKEY = 'CommandOrControl+Shift+G'
const ICON_PATH = path.join(__dirname, '..', 'build', 'icon.ico')
const EXE_NAME = 'ANA by Tailor.exe'

/**
 * Chave que o instalador NSIS grava com o caminho da instalacao OFICIAL deste PC. O nome da
 * chave e um GUID derivado do `appId` (br.com.tailorexec.tena.desktop) pelo electron-builder --
 * como o appId nunca muda, o GUID tambem nao. Serve pra responder uma pergunta que o app nao
 * sabia responder: "o .exe que estou rodando e o mesmo que esta instalado?". Foi exatamente
 * isso que pegou uma usuaria em 09/2026 -- ela tinha 3-4 copias do ANA no PC e usava uma
 * ANTIGA, mas a tela mostrava a versao do SITE (v0.19.4, que e igual em todas as copias, ja
 * que o app e um wrapper que carrega o site ao vivo), entao nada denunciava o problema.
 */
const INSTALL_REGISTRY_KEY = 'HKCU\\Software\\c348911e-1f8f-5b7a-87c2-5332a1be9b1b'

/**
 * Todos os lugares onde uma copia do ANA ja foi parar em algum momento da historia do
 * instalador. Ate a v0.18.25 o instalador era "assisted" (`nsis.oneClick: false` +
 * `allowToChangeInstallationDirectory`), o que deixava o usuario escolher a pasta E o modo
 * ("so pra mim" x "todos os usuarios") -- cada escolha diferente virava uma instalacao
 * paralela que a seguinte nao enxergava. Esta lista e o que o app varre pra AVISAR que ha
 * copias sobrando (o instalador novo, em build/installer.nsh, e quem de fato as remove).
 */
function knownInstallDirs() {
  const local = process.env.LOCALAPPDATA || ''
  const pf = process.env.ProgramFiles || ''
  const pf86 = process.env['ProgramFiles(x86)'] || ''
  const dirs = []
  if (local) {
    // "tailor-executive-ai-notes" e o `name` do package.json: versoes antigas do
    // electron-builder usavam ele (e nao o productName) pra nomear a pasta por-usuario --
    // por isso o app "some" de Arquivos de Programas E fica com um nome irreconhecivel.
    dirs.push(path.join(local, 'Programs', 'tailor-executive-ai-notes'))
    dirs.push(path.join(local, 'Programs', 'ANA by Tailor'))
    dirs.push(path.join(local, 'Programs', 'ana-by-tailor'))
    dirs.push(path.join(local, 'ANA by Tailor'))
  }
  if (pf) dirs.push(path.join(pf, 'ANA by Tailor'))
  if (pf86) dirs.push(path.join(pf86, 'ANA by Tailor'))
  return dirs
}

/** Compara caminhos do Windows sem tropecar em maiuscula/minuscula ou barra sobrando. */
function samePath(a, b) {
  if (!a || !b) return false
  const norm = (v) => path.resolve(v).replace(/[\\/]+$/, '').toLowerCase()
  try {
    return norm(a) === norm(b)
  } catch {
    return false
  }
}

/** Le um valor de string do registro do Windows. Devolve null se a chave/valor nao existir. */
function readRegValue(key, name) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', key, '/v', name], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const m = String(stdout).match(new RegExp(`${name}\\s+REG_[A-Z_]+\\s+(.+)`))
      resolve(m ? m[1].trim() : null)
    })
  })
}

/** Pastas (fora a que estamos rodando) que ainda tem um "ANA by Tailor.exe" dentro. */
function findOtherCopies() {
  const here = path.dirname(process.execPath)
  return knownInstallDirs().filter((dir) => {
    if (samePath(dir, here)) return false
    try {
      return fs.existsSync(path.join(dir, EXE_NAME))
    } catch {
      return false
    }
  })
}

/**
 * Onde ficam, NO DISCO, as gravacoes que o app guarda como rede de seguranca antes de
 * transcrever (src/lib/audioStore.ts -> IndexedDB "tailor-audio"). Fica dentro da particao
 * nomeada `persist:ana`; instaladores anteriores a v0.17.0 usavam a sessao padrao, e ate a
 * v0.18.30 o app carregava outro dominio -- cada combinacao dessas e um armazenamento
 * SEPARADO, e e por isso que copias diferentes mostravam "gravacoes retomadas" diferentes
 * na MESMA conta. Mostrar o caminho em Configuracoes deixa isso verificavel pelo usuario.
 */
function recordingsBackupDir() {
  const userData = app.getPath('userData')
  const partition = path.join(userData, 'Partitions', 'ana', 'IndexedDB')
  try {
    if (fs.existsSync(partition)) return partition
  } catch {
    /* segue pro fallback */
  }
  return userData
}

// Grava em arquivo (userData/logs/main.log) -- sem isto, um "buscar atualizacoes" que nao
// mostra nada nunca deixa rastro nenhum pra investigar. Se acontecer de novo, pedir esse
// arquivo pro usuario mostra exatamente onde a checagem parou (rede, GitHub, parse do
// latest.yml, etc.) em vez de adivinhar as cegas.
log.initialize()

// Identidade do app para o Windows. Sem isto a Central de Acoes nao sabe de quem e a
// notificacao e simplesmente NAO a mostra -- era o caso do aviso "Atualizando o ANA...", que
// existe justamente para cobrir o intervalo em que o app esta fechado instalando (~66s medidos
// na atualizacao 0.18.33 -> 0.18.35). Precisa bater com o appId do electron-builder e ser
// chamado antes de qualquer janela ou notificacao.
app.setAppUserModelId('br.com.tailorexec.tena.desktop')
log.transports.file.level = 'info'
autoUpdater.logger = log

// Atualizacao AUTOMATICA e SILENCIOSA (o instalador virou "oneClick", que fecha o app e instala
// sozinho sem o dialogo bloqueante "nao e possivel fechar"). autoDownload: baixa em segundo plano
// assim que acha uma versao nova; autoInstallOnAppQuit: aplica o que ja baixou quando o app fechar
// de verdade (bandeja -> Sair, logoff, desligar). Quem quiser atualizar na hora usa o aviso
// discreto do site (IPC ana:quit-and-install). Nenhum dialogo nativo trava o fluxo.
autoUpdater.autoDownload = true
autoUpdater.autoInstallOnAppQuit = true

log.info(`ANA iniciando -- versao ${app.getVersion()}, plataforma ${process.platform}`)

let mainWindow = null
let tray = null

/**
 * Sem isto, clicar no atalho do app de novo enquanto ele ja esta rodando (minimizado na
 * bandeja -- o usuario so achou que tinha fechado) abre um SEGUNDO processo, que disputa com o
 * primeiro o mesmo arquivo de sessao local no disco. O segundo processo perde essa disputa e
 * abre "deslogado" mesmo com uma sessao valida gravada -- e exatamente o bug de "fechar o app
 * desconecta a conta" relatado, so que o gatilho real e abrir de novo, nao fechar.
 * requestSingleInstanceLock() garante que so existe UM processo: uma segunda tentativa de
 * abrir so foca a janela do processo original, sem nunca competir pelo mesmo storage.
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  // Uma segunda tentativa de abrir (usuario clicou no atalho de novo) so foca a janela que ja
  // existe -- nunca cria um segundo processo.
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 640,
      icon: ICON_PATH,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        // Particao NOMEADA e persistente (gravada em disco no userData) em vez de depender do
        // "default session" implicito -- deixa explicito que login/localStorage devem sobreviver
        // a fechar e reabrir o app, em vez de confiar no comportamento padrao do Electron.
        partition: 'persist:ana',
      },
    })

    mainWindow.loadURL(APP_URL).catch((err) => log.warn('loadURL inicial falhou:', err))

    // Links para FORA do app (entrar na chamada do Meet/Teams pela Agenda, WhatsApp, baixar o APK)
    // abrem no navegador padrao. Sem isto o Electron criava uma janela crua dele mesmo, sem barra
    // de endereco e sem as permissoes de microfone que a chamada precisa. So http(s) e mailto:
    // nunca file:// nem outros esquemas, que o shell executaria.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(APP_URL)) return { action: 'allow' }
      if (/^(https?:\/\/|mailto:)/i.test(url)) {
        shell.openExternal(url).catch((err) => log.warn('openExternal falhou:', err))
      }
      return { action: 'deny' }
    })

    // Wrapper FINO: se o site nao carrega (PC sem internet, DNS, host fora do ar), o Chromium
    // mostra a propria tela de erro crua -- sem marca, sem explicacao e sem como tentar de novo
    // a nao ser fechar o app. Trocamos por um aviso nosso, que ainda RETENTA sozinho ate voltar.
    let retryTimer = null
    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame) return
      // ERR_ABORTED: navegacao trocada de proposito (o proprio app mandou ir pra outra tela).
      if (errorCode === -3) return
      log.warn(`did-fail-load (${errorCode}): ${errorDescription}`)
      showOfflineNotice(errorDescription)
      if (retryTimer) clearTimeout(retryTimer)
      retryTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(APP_URL).catch(() => {})
      }, 6000)
    })

    mainWindow.webContents.on('did-finish-load', () => {
      // So para de retentar quando quem carregou foi o SITE: o proprio aviso de offline tambem
      // dispara este evento e, sem a checagem, cancelaria a retentativa que ele acabou de armar.
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (!mainWindow.webContents.getURL().startsWith(APP_URL)) return
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    })

    // Ctrl+Shift+G com a janela em foco: se o atalho GLOBAL nao registrou (outro app do Windows
    // ja usa esse atalho -- por isso so acontece em ALGUMAS maquinas), a tecla chegava ao Chromium,
    // que a interpreta como "localizar anterior" e abre a barra de busca no topo (bug relatado).
    // Interceptamos AQUI, antes do Chromium, pra sempre disparar a gravacao -- nunca a barra de
    // busca. Tambem barra Ctrl+F/Ctrl+G, que abririam a mesma barra (o app nao e um documento
    // pra buscar texto). Quando o atalho global ESTA registrado, a tecla nem chega aqui (o SO
    // entrega pro globalShortcut), entao nao dispara em dobro.
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return
      const key = (input.key || '').toLowerCase()
      const ctrlOrCmd = input.control || input.meta
      if (ctrlOrCmd && input.shift && key === 'g') {
        // Atalho de gravar (Ctrl+Shift+G) -> inicia a gravacao de reuniao do PC.
        event.preventDefault()
        triggerRecordHotkey()
      } else if (ctrlOrCmd && !input.shift && (key === 'f' || key === 'g')) {
        // Impede a barra de busca do Chromium (Ctrl+F / Ctrl+G) nesse app de tela unica.
        event.preventDefault()
      }
    })

    // Fechar a janela minimiza pra bandeja em vez de encerrar o processo -- e o que permite o
    // atalho global funcionar mesmo com a janela "fechada" (o usuario so quis tirar da tela).
    mainWindow.on('close', (event) => {
      if (app.isQuitting) return
      event.preventDefault()
      mainWindow.hide()
    })

    mainWindow.on('closed', () => {
      mainWindow = null
    })
  }

  /** Tela propria de "nao consegui carregar", no lugar da tela de erro crua do Chromium. */
  function showOfflineNotice(detail) {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const html = [
      '<!doctype html><meta charset="utf-8"><title>ANA</title>',
      '<style>',
      'body{margin:0;height:100vh;display:grid;place-items:center;background:#0b0f14;color:#e6edf3;',
      'font:15px/1.6 "Segoe UI",system-ui,sans-serif;text-align:center;padding:24px}',
      'h1{font-size:20px;margin:0 0 12px}p{margin:0 0 8px;color:#9aa7b2;max-width:34em}',
      'code{color:#6f7d8a;font-size:12px}',
      '</style>',
      '<div><h1>Nao consegui abrir o ANA</h1>',
      '<p>O aplicativo precisa de internet para carregar. Vou tentar de novo sozinho a cada 6 segundos.</p>',
      '<p><code>' + String(detail || '').replace(/[<>&]/g, '') + '</code></p></div>',
    ].join('')
    mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html)).catch(() => {})
  }

  /**
   * Traz a janela pra frente e JA INICIA a gravacao de reuniao do PC.
   * O getDisplayMedia (captura da tela/audio do sistema) exige uma "ativacao transitoria" do
   * usuario -- por isso chamamos via executeJavaScript(code, /*userGesture*\/ true): isso simula
   * o gesto e da ~5s de janela, cobrindo navegar ate a tela de captura + montar + iniciar. Sem
   * isso o navegador recusaria a captura. O site expoe window.__anaStartMeeting (definido no
   * App.tsx) que navega pra /capturar?mode=meeting&autostart=1 e dispara o start.
   */
  function startMeetingWithGesture() {
    if (!mainWindow) return
    mainWindow.webContents
      .executeJavaScript('window.__anaStartMeeting && window.__anaStartMeeting()', true)
      .catch(() => {})
  }

  function triggerRecordHotkey() {
    if (!mainWindow) {
      createWindow()
      mainWindow.webContents.once('did-finish-load', () => startMeetingWithGesture())
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    startMeetingWithGesture()
  }

  function createTray() {
    // Defensivo: se por algum motivo isto rodar de novo com uma tray ja existente, destroi a
    // antiga antes -- nunca deixa duas ativas ao mesmo tempo no mesmo processo.
    if (tray) {
      tray.destroy()
      tray = null
    }
    let icon = nativeImage.createFromPath(ICON_PATH)
    if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 })
    tray = new Tray(icon)
    tray.setToolTip('ANA by Tailor')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Abrir ANA', click: () => (mainWindow ? mainWindow.show() : createWindow()) },
        { label: 'Gravar reunião (Ctrl+Shift+G)', click: triggerRecordHotkey },
        { type: 'separator' },
        { label: 'Buscar atualizações...', click: () => checkForUpdates(true) },
        // Atalhos pras pastas tambem AQUI, e nao so em Configuracoes: quando o site nao
        // carrega, a bandeja e o unico lugar que o usuario ainda alcanca.
        { label: 'Abrir a pasta do app...', click: () => shell.openPath(path.dirname(process.execPath)) },
        { label: 'Abrir a pasta das gravacoes salvas...', click: () => shell.openPath(recordingsBackupDir()) },
        { label: 'Abrir pasta de logs...', click: () => shell.showItemInFolder(log.transports.file.getFile().path) },
        { type: 'separator' },
        {
          label: 'Sair',
          click: () => {
            app.isQuitting = true
            app.quit()
          },
        },
      ]),
    )
    tray.on('click', () => (mainWindow ? mainWindow.show() : createWindow()))
  }

  /**
   * Manda o status pro site (icone de atualizar em Home.tsx) alem dos dialogos nativos --
   * sem isto, clicar em "buscar atualizacoes" nao dava NENHUM feedback visivel ate um dialogo
   * eventualmente aparecer (ou nunca aparecer, se ja estivesse atualizado), parecendo que o
   * botao nao fez nada.
   */
  function sendUpdateStatus(payload) {
    if (mainWindow) mainWindow.webContents.send('ana:update-status', payload)
  }

  /**
   * Instala AGORA a atualizacao ja baixada e reabre o app. Usado pelo caminho "na hora" (o botao
   * "Reiniciar e atualizar" do aviso no site, via IPC ana:quit-and-install). O app vive na bandeja
   * e o handler de 'close' faz hide() em vez de fechar de verdade -- isso travaria o quitAndInstall.
   * Entao antes de instalar: marca que estamos saindo, tira o handler que esconde a janela, destroi
   * a bandeja e libera o atalho global -- nada segurando o processo. Com o instalador oneClick, ele
   * fecha qualquer resto e instala em silencio (sem o dialogo "nao e possivel fechar").
   */
  let installing = false
  function installUpdateNow(notice) {
    if (installing) return
    installing = true
    // A instalacao roda em silencio de proposito (ver o quitAndInstall mais abaixo), e com o app
    // encerrado nenhuma janela nossa sobrevive pra mostrar progresso. A notificacao do Windows e
    // a unica coisa que continua visivel nesse intervalo: sem ela o usuario ve o ANA fechar
    // sozinho e sumir por ~20s, o que parece defeito. Os textos vem do site ja traduzidos.
    try {
      if (Notification.isSupported()) {
        new Notification({
          title: (notice && notice.title) || 'Atualizando o ANA...',
          body:
            (notice && notice.body) ||
            'A janela vai fechar e reabrir sozinha em alguns segundos. E normal -- nao precisa fazer nada.',
        }).show()
      }
    } catch (err) {
      log.warn('nao foi possivel notificar a atualizacao:', err)
    }
    app.isQuitting = true
    try {
      if (mainWindow) mainWindow.removeAllListeners('close')
    } catch (_) {}
    try {
      globalShortcut.unregisterAll()
    } catch (_) {}
    if (tray) {
      try {
        tray.destroy()
      } catch (_) {}
      tray = null
    }
    // setImmediate: deixa o IPC/render responder antes de sair.
    // quitAndInstall(isSilent=TRUE, isForceRunAfter=true): instala em modo SILENCIOSO e reabre o app.
    // O silencioso e o que ACABA com a tela "arquivo em uso / Repetir": na extracao, o template do
    // electron-builder tenta copiar 5x e, se ainda travado, mostra um MessageBox com `/SD IDRETRY`
    // -- em modo silencioso esse default IDRETRY e escolhido sozinho (o dialogo NAO aparece) e a
    // extracao cai no overwrite de ultimo recurso ate concluir. Com isForceRunAfter o app reabre.
    setImmediate(() => {
      try {
        log.info('quitAndInstall: iniciando (silencioso, pedido do usuario)')
        autoUpdater.quitAndInstall(true, true)
      } catch (err) {
        log.error('quitAndInstall falhou:', err)
        app.quit()
      }
    })
  }

  /**
   * Checagem de atualizacao via GitHub Releases (mesmo repositorio, configurado em
   * package.json's build.publish). `manual` distingue quem clicou em "Buscar atualizacoes"
   * (sempre mostra um resultado, mesmo "ja esta atualizado") da checagem automatica silenciosa
   * do startup (so incomoda o usuario quando ha novidade de verdade) -- por isso so os eventos
   * de "checando"/"sem novidade" respeitam esse filtro; "achou"/"baixando"/"pronto" o site sempre
   * mostra, ja que nesse ponto ha algo real acontecendo (e o dialogo nativo tambem aparece nos 2 casos).
   */
  let checkingUpdate = false
  let lastCheckWasManual = false
  function checkForUpdates(manual) {
    log.info(`checkForUpdates chamado (manual=${manual}, ja em andamento=${checkingUpdate})`)
    if (checkingUpdate) return
    checkingUpdate = true
    lastCheckWasManual = manual
    if (manual) sendUpdateStatus({ status: 'checking' })
    autoUpdater
      .checkForUpdates()
      .catch((err) => {
        log.error('checkForUpdates falhou:', err)
        if (manual) {
          sendUpdateStatus({ status: 'error', message: String(err?.message ?? err) })
          dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: 'Buscar atualizações',
            message: 'Não foi possível verificar atualizações agora.',
            detail: String(err?.message ?? err),
          })
        }
      })
      .finally(() => {
        checkingUpdate = false
      })
  }

  // Pedido vindo do site (icone no topo, ao lado de pasta/tema -- ver src/lib/electron.ts +
  // preload.cjs): mesmo comportamento do item de menu da bandeja.
  ipcMain.on('ana:check-for-updates', () => {
    log.info('IPC ana:check-for-updates recebido do site')
    checkForUpdates(true)
  })

  // Aviso discreto do site ("Reiniciar e atualizar"): instala a atualizacao ja baixada na hora.
  ipcMain.on('ana:quit-and-install', (_e, notice) => {
    log.info('IPC ana:quit-and-install recebido do site')
    installUpdateNow(notice)
  })

  // O site percebeu que o Windows trocou o aparelho de saida com a reuniao gravando. O loopback
  // fica preso ao aparelho de quando a captura comecou, entao ele precisa refazer o
  // getDisplayMedia -- e isso exige ativacao transitoria, que o site nao consegue se dar. Aqui
  // devolvemos a chamada com userGesture=true (mesmo truque do atalho global), e o site emenda
  // a captura nova na mistura que ja esta sendo gravada, sem parar o MediaRecorder.
  ipcMain.on('ana:reattach-system-audio', () => {
    if (!mainWindow) return
    log.info('IPC ana:reattach-system-audio: refazendo o loopback no aparelho novo')
    mainWindow.webContents
      .executeJavaScript('window.__anaReattachSystemAudio && window.__anaReattachSystemAudio()', true)
      .catch((err) => log.warn('falha ao reconectar o audio do sistema:', err))
  })

  // Versao do instalador nativo instalado (package.json). O site (carregado ao vivo) compara
  // com a ultima versao publicada pra saber se precisa avisar o usuario a atualizar o app.
  ipcMain.on('ana:get-version', (e) => {
    e.returnValue = app.getVersion()
  })

  /**
   * Caminhos REAIS deste app no disco, pra tela de Configuracoes do site. Existe por causa de
   * um caso concreto (09/2026): a usuaria tinha varias copias do ANA no PC, usava uma antiga, e
   * NADA na tela denunciava isso -- porque a versao mostrada vem do site, que e o mesmo em todas
   * as copias. Com estes valores a tela passa a mostrar de onde o app esta rodando de verdade,
   * onde ficam as gravacoes guardadas localmente, e se ha copias sobrando pra remover.
   */
  ipcMain.handle('ana:get-paths', async () => {
    const exePath = process.execPath
    const installDir = path.dirname(exePath)
    const registeredInstallDir = await readRegValue(INSTALL_REGISTRY_KEY, 'InstallLocation')
    let logFile = ''
    let logDir = ''
    try {
      logFile = log.transports.file.getFile().path
      // O site mostra o ARQUIVO mas so pode mandar abrir a PASTA: abrir pasta abre o Explorer,
      // abrir arquivo executaria algo. Ver a lista de caminhos permitidos em allowedOpenPaths().
      logDir = path.dirname(logFile)
    } catch {
      /* sem log em arquivo: o resto da tela continua util */
    }
    return {
      version: app.getVersion(),
      appUrl: APP_URL,
      exePath,
      installDir,
      registeredInstallDir: registeredInstallDir || null,
      isStaleCopy: !!registeredInstallDir && !samePath(installDir, registeredInstallDir),
      userDataDir: app.getPath('userData'),
      recordingsBackupDir: recordingsBackupDir(),
      logFile,
      logDir,
      otherCopies: findOtherCopies(),
    }
  })

  /**
   * Lista fechada de pastas que o site pode pedir pra abrir no Explorer. O site e carregado de
   * um servidor remoto: sem esta trava, um `ana:open-path` com um caminho qualquer viraria
   * "executar arquivo arbitrario no PC do usuario" (shell.openPath roda .exe). Todos os itens
   * aqui sao PASTAS -- abrir pasta so abre o Explorer, nunca executa nada.
   */
  async function allowedOpenPaths() {
    const list = [app.getPath('userData'), recordingsBackupDir(), path.dirname(process.execPath)]
    for (const dir of findOtherCopies()) list.push(dir)
    try {
      list.push(path.dirname(log.transports.file.getFile().path))
    } catch {
      /* ignora */
    }
    const registered = await readRegValue(INSTALL_REGISTRY_KEY, 'InstallLocation')
    if (registered) list.push(registered)
    return list
  }

  ipcMain.on('ana:open-path', async (_e, target) => {
    if (typeof target !== 'string' || !target) return
    const list = await allowedOpenPaths()
    if (!list.some((allowed) => samePath(allowed, target))) {
      log.warn('ana:open-path recusado (caminho fora da lista permitida):', target)
      return
    }
    shell.openPath(target).catch((err) => log.warn('nao foi possivel abrir a pasta:', err))
  })

  autoUpdater.on('update-available', (info) => {
    // Com autoDownload=true o electron-updater ja comeca a baixar sozinho -- nao chamamos
    // downloadUpdate() de novo (duplicaria). Sem dialogo bloqueante: so avisa o site (aviso discreto).
    log.info('update-available (baixando em segundo plano):', info.version)
    sendUpdateStatus({ status: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', (info) => {
    log.info('update-not-available (versao atual ja e a mais nova):', info?.version)
    if (lastCheckWasManual) {
      sendUpdateStatus({ status: 'not-available' })
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Buscar atualizações',
        message: 'Você já está usando a versão mais recente.',
      })
    }
  })

  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) mainWindow.setProgressBar(p.percent / 100)
    sendUpdateStatus({ status: 'downloading', percent: p.percent })
  })

  autoUpdater.on('update-downloaded', (info) => {
    // Sem dialogo bloqueante. A instalacao acontece sozinha no proximo quit (autoInstallOnAppQuit),
    // ou na hora se o usuario clicar em "Reiniciar e atualizar" no aviso do site (installUpdateNow).
    if (mainWindow) mainWindow.setProgressBar(-1)
    log.info('update-downloaded (pronto; instala ao sair ou quando o usuario pedir):', info.version)
    sendUpdateStatus({ status: 'downloaded', version: info.version })
  })

  /**
   * Impede o cenario que originou esta correcao: o usuario clica num atalho ANTIGO (area de
   * trabalho, barra de tarefas, menu iniciar) que aponta pra uma copia do ANA que nao e mais a
   * instalada. Como o app carrega o site ao vivo, a copia velha ABRE e parece normal -- mas usa
   * um armazenamento local separado (login e gravacoes pendentes diferentes) e um Chromium
   * antigo, o que quebrava a gravacao. Aqui a gente compara o .exe que esta rodando com o
   * caminho que o instalador registrou e, se forem diferentes, avisa e oferece abrir o certo.
   * Devolve true se decidimos sair (quem chama nao deve seguir criando janela/bandeja).
   */
  async function guardAgainstStaleCopy() {
    const registered = await readRegValue(INSTALL_REGISTRY_KEY, 'InstallLocation')
    if (!registered) return false
    const here = path.dirname(process.execPath)
    if (samePath(here, registered)) return false
    const target = path.join(registered, EXE_NAME)
    // Se o caminho registrado nao existe mais, o registro e que esta velho -- nao incomoda.
    if (!fs.existsSync(target)) return false

    log.warn(`copia fora do lugar: rodando de "${here}", instalado em "${registered}"`)
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Abrir a versao instalada', 'Continuar nesta mesmo assim'],
      defaultId: 0,
      cancelId: 1,
      title: 'Esta nao e a versao instalada do ANA',
      message: 'Voce abriu uma copia antiga do ANA.',
      detail: [
        'Copia aberta:',
        here,
        '',
        'Versao instalada:',
        registered,
        '',
        'Copias antigas guardam login e gravacoes em um lugar SEPARADO -- e por isso que ' +
          'aparecem gravacoes diferentes em cada uma. Abra a versao instalada e apague o ' +
          'atalho antigo.',
      ].join('\n'),
    })
    if (response !== 0) return false

    // Sair primeiro, abrir depois: enquanto ESTE processo vive, ele segura a trava de instancia
    // unica -- a copia certa subiria e so mandaria foco pra esta janela aqui, sem resolver nada.
    // A espera de ~2s da o intervalo pra este processo morrer antes da outra subir. Usamos `ping`
    // e nao `timeout`: o `timeout` do Windows aborta ("input redirection is not supported")
    // quando a entrada padrao esta redirecionada, que e exatamente o caso aqui (stdio: 'ignore').
    try {
      spawn('cmd.exe', ['/c', `ping -n 3 127.0.0.1 >nul & start "" "${target}"`], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      }).unref()
    } catch (err) {
      log.error('nao foi possivel abrir a versao instalada:', err)
      return false
    }
    app.isQuitting = true
    app.quit()
    return true
  }

  app.whenReady().then(async () => {
    if (await guardAgainstStaleCopy()) return

    // Autoriza getDisplayMedia() (usado pelo "Gravar Meet" do site) SEM o dialogo de escolha
    // do sistema operacional: grava a tela toda + audio do sistema (loopback) direto. Resolve o
    // maior ponto de atrito da gravacao de reuniao (escolher a aba certa, lembrar de marcar
    // "compartilhar audio") -- so acontece aqui dentro do app nativo, um navegador comum sempre
    // exige esse dialogo por seguranca. Tem que ser na MESMA particao da janela (persist:ana),
    // senao o handler fica registrado numa sessao que a janela nem usa.
    session.fromPartition('persist:ana').setDisplayMediaRequestHandler(
      (_request, callback) => {
        desktopCapturer
          .getSources({ types: ['screen'] })
          .then((sources) => {
            // Sem esta checagem, uma lista VAZIA virava `video: undefined` e o getDisplayMedia
            // estourava sem mensagem -- do lado do usuario a gravacao de reuniao simplesmente
            // "nao acontecia", sem erro nenhum pra investigar. Acontece quando o Windows nega a
            // captura de tela (politica/privacidade) ou nao ha sessao grafica disponivel.
            if (!sources || sources.length === 0) {
              log.error('desktopCapturer nao devolveu nenhuma tela -- captura do audio do sistema cancelada')
              return callback({})
            }
            callback({ video: sources[0], audio: 'loopback' })
          })
          .catch((err) => {
            log.error('desktopCapturer.getSources falhou:', err)
            callback({})
          })
      },
      { useSystemPicker: false },
    )

    createWindow()
    createTray()

    const registered = globalShortcut.register(RECORD_HOTKEY, triggerRecordHotkey)
    if (!registered) {
      // Outro programa ja usa este atalho no Windows do usuario -- nao trava o app por isso,
      // so fica sem o atalho global (a bandeja/menu ainda funcionam).
      console.warn(`Nao foi possivel registrar o atalho ${RECORD_HOTKEY} (em uso por outro app).`)
    }

    // Checagem automatica e silenciosa ao abrir + a cada ~3h. O app vive na bandeja por dias, entao
    // sem o reintervalo ele nunca acharia uma release publicada depois que ja estava aberto. Com
    // autoDownload=true, achar = baixar em segundo plano; instala sozinho ao sair (autoInstallOnAppQuit).
    setTimeout(() => checkForUpdates(false), 5000)
    setInterval(() => checkForUpdates(false), 3 * 60 * 60 * 1000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    app.isQuitting = true
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    // Sem isto, o Windows deixava o icone "fantasma" na bandeja depois de fechar (o Electron
    // nao remove sozinho) -- so sumia de vez ao passar o mouse em cima ou reiniciar o Explorer.
    if (tray) {
      tray.destroy()
      tray = null
    }
  })

  // Continua rodando na bandeja no Windows mesmo com todas as janelas fechadas -- so encerra
  // mesmo via "Sair" no menu da bandeja (app.isQuitting).
  app.on('window-all-closed', () => {})
}
