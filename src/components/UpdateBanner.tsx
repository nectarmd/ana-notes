import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpCircle, Loader2, X } from 'lucide-react'
import { isElectron, type AnaUpdateStatus } from '../lib/electron'
import { isOlderVersion, WINDOWS_REQUIRED_BUILD } from '../lib/version'
import { WINDOWS_INSTALLER_URL } from '../lib/windowsApp'
import { useToast } from './Toast'
import { useT } from '../lib/i18n'

const DISMISS_KEY = 'tailor.updateBanner.dismissed'
/** Ultima versao do instalador que este aparelho viu -- fecha o ciclo do "deu certo?". */
const LAST_SEEN_KEY = 'tailor.lastSeenAppVersion'

/**
 * Aviso fino no topo, so no app Windows (Electron), quando o instalador nativo instalado esta
 * atras da ultima versao publicada -- ou quando nem reporta versao (instalador antigo, anterior
 * a este recurso), que tambem tratamos como desatualizado. "Atualizar agora" dispara o
 * auto-updater (se o instalador suportar) ou abre o link de download direto.
 */
export function UpdateBanner() {
  const t = useT()
  const toast = useToast()
  const [dismissed, setDismissed] = useState(() => {
    try {
      // Dispensa so pela sessao (some ao reabrir o app), pra nao esconder pra sempre.
      return sessionStorage.getItem(DISMISS_KEY) === WINDOWS_REQUIRED_BUILD
    } catch {
      return false
    }
  })
  // Acompanha o auto-update em segundo plano: quando fica 'downloaded', o aviso vira o botao
  // "Reiniciar e atualizar" (instala na hora). Do contrario a instalacao acontece sozinha ao sair.
  const [status, setStatus] = useState<AnaUpdateStatus['status'] | null>(null)
  const [percent, setPercent] = useState<number | null>(null)
  /** Instalando: a janela vai sumir em instantes e o usuario precisa saber disso. */
  const [installing, setInstalling] = useState(false)
  /** Segundos ate o app fechar para instalar (o aviso precisa ficar legivel antes de sumir). */
  const [countdown, setCountdown] = useState<number | null>(null)

  // Depois de atualizar, o app so "sumiu e voltou": nada confirma que deu certo. Comparar a
  // versao instalada com a ultima que este aparelho viu fecha esse ciclo com um aviso curto.
  useEffect(() => {
    if (!isElectron()) return
    const now = window.anaElectron?.appVersion
    if (!now) return
    try {
      const prev = localStorage.getItem(LAST_SEEN_KEY)
      localStorage.setItem(LAST_SEEN_KEY, now)
      // Sem numero no aviso: a unica versao que o usuario ve e a do app (APP_VERSION).
      if (prev && isOlderVersion(prev, now)) toast(t('update.done'))
    } catch {
      /* ignore */
    }
  }, [toast, t])

  useEffect(() => {
    if (!isElectron() || typeof window.anaElectron!.onUpdateStatus !== 'function') return
    return window.anaElectron!.onUpdateStatus((p) => {
      setStatus(p.status)
      // Guarda o % so enquanto baixa; zera nos estados finais pra nao "grudar" um numero velho.
      if (p.status === 'downloading') setPercent(Math.round(p.percent))
      else if (p.status !== 'available' && p.status !== 'checking') setPercent(null)
    })
  }, [])

  // Contagem antes de fechar para instalar (fica ANTES dos returns: regra dos hooks).
  useEffect(() => {
    if (countdown === null) return
    if (countdown > 0) {
      const id = setTimeout(() => setCountdown(countdown - 1), 1000)
      return () => clearTimeout(id)
    }
    window.anaElectron!.quitAndInstall!({
      title: t('update.installing.title'),
      body: t('update.splash.body'),
      doneTitle: t('update.splash.doneTitle'),
      doneBody: t('update.splash.doneBody'),
      slowTitle: t('update.splash.slowTitle'),
      slowBody: t('update.splash.slowBody'),
    })
  }, [countdown, t])

  // Copia da Loja: o Windows atualiza sozinho -- mandar a pessoa baixar instalador seria errado.
  if (!isElectron() || dismissed || window.anaElectron!.isStoreBuild) return null

  const installed = window.anaElectron!.appVersion
  const outdated = !installed || isOlderVersion(installed, WINDOWS_REQUIRED_BUILD)
  if (!outdated) return null

  const ready = status === 'downloaded' && typeof window.anaElectron!.quitAndInstall === 'function'
  const downloading = status === 'downloading' || status === 'available' || status === 'checking'

  function update() {
    if (typeof window.anaElectron!.checkForUpdates === 'function') {
      // Com autoDownload no app, isto so adianta a busca -- o download roda sozinho em segundo plano.
      window.anaElectron!.checkForUpdates()
      toast(t('update.checking'))
    } else {
      // Instalador antigo sem auto-updater: so resta baixar o novo manualmente.
      window.open(WINDOWS_INSTALLER_URL, '_blank')
    }
  }

  function restart() {
    // O instalador roda em SILENCIO de proposito (ver main.cjs: o modo visivel traz de volta a
    // tela "arquivo em uso / Repetir" que a v0.18.26 matou). Relato de 17/09/2026: o app sumia e
    // nada aparecia por ~2 minutos, e parecia preciso clicar no icone de novo. Agora o aviso fica
    // alguns segundos na tela, com contagem, ANTES de fechar (antes sumia em meio segundo); a
    // partir do instalador 0.20.2 uma janela propria assume enquanto a instalacao roda.
    if (installing) return
    setInstalling(true)
    setCountdown(4)
  }

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, WINDOWS_REQUIRED_BUILD)
    } catch {
      /* ignore */
    }
    setDismissed(true)
  }

  return (
    <>
      {installing &&
        createPortal(
          // Portal: a barra vive dentro de containers com stacking context proprio, e um overlay
          // preso ali dentro ficaria atras do resto da tela.
          <div className="fixed inset-0 z-[90] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" />
            <div className="relative w-full max-w-sm mx-5 bg-surface-card border border-surface-border rounded-3xl shadow-float px-6 py-7 text-center">
              <Loader2 size={32} className="mx-auto text-accent animate-spin" />
              <h2 className="font-display font-semibold text-lg mt-4">{t('update.installing.title')}</h2>
              <p className="text-sm text-content-secondary mt-2">{t('update.installing.body')}</p>
              {countdown !== null && countdown > 0 && (
                <p className="text-xs text-content-muted mt-3 tabular-nums">
                  {t('update.installing.closingIn').replace('{n}', String(countdown))}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
      {/* max-w + alinhado a esquerda: aviso curto, nao precisa atravessar a tela inteira (ate
          17/09/2026 tambem evitava os controles flutuantes da Home, que hoje ficam no cabecalho). */}
      <div className="flex items-center gap-2.5 border border-accent/30 bg-accent/10 rounded-2xl px-4 py-2 mx-5 mt-4 max-w-xl text-sm">
      <ArrowUpCircle size={16} className="text-accent shrink-0" />
      <span className="flex-1 min-w-0 text-content-primary">
        {ready
          ? t('update.ready')
          : status === 'downloading' && percent != null
            ? `${t('update.downloading')} ${percent}%`
            : downloading
              ? t('update.downloading')
              : t('update.available')}
      </span>
      {ready ? (
        <button onClick={restart} className="btn-primary h-8 px-3 text-sm shrink-0">
          {t('update.restart')}
        </button>
      ) : (
        <button onClick={update} disabled={downloading} className="btn-primary h-8 px-3 text-sm shrink-0 disabled:opacity-60">
          {t('update.now')}
        </button>
      )}
      <button onClick={dismiss} aria-label={t('update.dismiss')} className="shrink-0 text-content-muted hover:text-content-primary">
        <X size={16} />
      </button>
      </div>
    </>
  )
}
