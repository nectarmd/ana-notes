import { useCallback, useRef, useState } from 'react'
import { config } from './config'
import { isElectron } from './electron'

/** Gancho global que o processo principal do Electron chama com gesto simulado. */
function reattachHook(): { __anaReattachSystemAudio?: () => void } {
  return window as unknown as { __anaReattachSystemAudio?: () => void }
}

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped'

interface RecorderResult {
  blob: Blob
  durationSeconds: number
  url: string
}

interface StartOptions {
  /** Tambem captura o audio da aba/sistema (reuniao) e mistura com o microfone. */
  system?: boolean
}

/**
 * Opcoes do seletor de compartilhamento. Elas existem para o usuario errar menos:
 *
 * - `displaySurface: 'browser'` abre o dialogo ja na aba "Guia do Chrome". Compartilhando uma
 *   guia, o "compartilhar audio" vem MARCADO por padrao; na tela inteira vem desmarcado. Ou
 *   seja, empurrar para a guia resolve tambem o esquecimento do som.
 * - `selfBrowserSurface: 'exclude'` tira a propria aba do ANA da lista de escolhas.
 * - `systemAudio: 'include'` pede o audio do sistema para quem escolher tela/janela mesmo assim.
 *
 * Sao dicas: o usuario continua livre para escolher tela inteira e desmarcar o audio — por isso
 * o `start()` abaixo trata a falta de audio como aviso, nunca como motivo para abortar.
 */
const DISPLAY_OPTIONS = {
  video: { displaySurface: 'browser' },
  audio: true,
  systemAudio: 'include',
  selfBrowserSurface: 'exclude',
} as unknown as DisplayMediaStreamOptions

/** Silencio digital absoluto por tanto tempo = a fonte escolhida quase certamente esta errada. */
const SILENCE_MS = 30_000
/** Acima disto ja consideramos que ouvimos a reuniao (ruido de fundo passa longe do zero). */
const SILENCE_RMS = 0.002
/**
 * Gravando ha tanto tempo sem UM BYTE entregue pelo MediaRecorder = o arquivo final sera
 * vazio. Com o timeslice de 1s, qualquer captura sadia ja entregou dados muito antes disso.
 */
const NO_DATA_MS = 20_000

/** Identidade do aparelho de SAIDA padrao. Muda quando o Windows troca (fone que conecta). */
async function defaultOutputKey(): Promise<string> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    const out = devices.find((d) => d.kind === 'audiooutput' && d.deviceId === 'default')
    return out ? `${out.groupId}|${out.label}` : ''
  } catch {
    return ''
  }
}

/**
 * Pede ao processo principal do Electron que reconecte o audio do sistema. Tem que passar por
 * ele: getDisplayMedia exige ativacao transitoria e o site nao consegue se dar um gesto -- o
 * main devolve a chamada em __anaReattachSystemAudio com userGesture=true. Fora do app Windows,
 * ou em instalador antigo (sem o metodo), nao ha o que fazer sozinho e a rede de protecao segue
 * sendo o aviso de audio mudo de 30s.
 */
function requestSystemReattach(): void {
  const bridge = window.anaElectron
  if (typeof bridge?.requestSystemAudioReattach === 'function') bridge.requestSystemAudioReattach()
}

export function isMobileBrowser(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

/**
 * O navegador consegue segurar a tela acesa (Screen Wake Lock)? Safari iOS 16.4+, Chrome e
 * Edge sim. E o que evita o caso mais comum de gravacao perdida no celular: a tela apaga
 * sozinha, o sistema poe o app em segundo plano e tira o microfone dele.
 */
export function canKeepScreenAwake(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

/** Captura de audio interno (aba/sistema) so existe no desktop via getDisplayMedia. */
export function canCaptureSystemAudio(): boolean {
  const md = navigator.mediaDevices as MediaDevices | undefined
  return !!md && typeof md.getDisplayMedia === 'function' && !isMobileBrowser()
}

/**
 * Somente navegadores Chromium (Chrome, Edge, Opera, Brave) entregam o AUDIO da aba
 * no getDisplayMedia. Safari e Firefox implementam a API mas devolvem apenas o video —
 * a gravacao sairia com o seu microfone e SEM a outra ponta da reuniao.
 */
export function supportsTabAudio(): boolean {
  if (isMobileBrowser()) return false
  const ua = navigator.userAgent
  const isChromium = /Chrome|Chromium|Edg\//i.test(ua) && !/Firefox\//i.test(ua)
  return isChromium
}

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  /** Fica true quando a captura termina sozinha: usuario clicou em "Parar compartilhamento", ou
   *  o proprio MediaRecorder morreu (pagina suspensa pelo sistema). A tela encerra e fica com
   *  o que foi gravado ate ali. */
  const [ended, setEnded] = useState(false)
  /** Gravando, mas sem o audio da reuniao: so a voz do usuario. Ele pode anexar depois. */
  const [systemAudioMissing, setSystemAudioMissing] = useState(false)
  /** O audio da reuniao esta anexado, porem mudo ha mais de 30s: fonte provavelmente errada. */
  const [systemSilent, setSystemSilent] = useState(false)
  /** Gravando ha 20s+ sem NENHUM byte gravado: o arquivo vai sair vazio (0 byte). */
  const [noAudioData, setNoAudioData] = useState(false)
  /** O microfone caiu e (ainda) NAO deu pra recuperar: a voz do usuario nao esta entrando.
   *  Volta a false sozinho quando o mic original retorna (unmute) ou um novo e costurado. */
  const [micLost, setMicLost] = useState(false)

  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const micStreamRef = useRef<MediaStream | null>(null)
  const displayStreamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  /**
   * Destino da mistura: e a faixa DELE que o MediaRecorder grava, nos dois modos. Ela nunca
   * morre nem e silenciada pelo sistema -- so as fontes ligadas nela (mic, reuniao) -- entao
   * trocar o microfone por baixo, ou anexar a reuniao depois, e invisivel para o gravador.
   */
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  /** Modo reuniao (mic + audio do sistema)? Decide o que faz sentido reconectar. */
  const meetingRef = useRef(false)
  /** Analyser exclusivo da reuniao: o do nivel mistura o microfone e nunca ficaria mudo. */
  const sysAnalyserRef = useRef<AnalyserNode | null>(null)
  const sysSilentSinceRef = useRef<number | null>(null)
  const sysHeardRef = useRef(false)
  /** Ja existe audio da reuniao na mistura? Uma troca de fonte que falha nao pode desmentir isso. */
  const sysAttachedRef = useRef(false)
  const resolveRef = useRef<((r: RecorderResult) => void) | null>(null)
  const startedAtRef = useRef<number>(0)
  const elapsedBeforePauseRef = useRef<number>(0)
  const mimeRef = useRef<string>('audio/webm')
  /** Bytes ja entregues pelo MediaRecorder. Zero com a gravacao andando = arquivo vazio. */
  const bytesRef = useRef(0)
  /** Quando chegou o ultimo pedaco de audio. Parado ha 20s+ = a captura travou (ou nunca andou). */
  const lastDataAtRef = useRef(0)
  /** No do microfone dentro da cadeia. Guardado para poder desligar na troca de aparelho. */
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  /** As mesmas restricoes do start(), para reaquirir o mic identico ao original. */
  const micConstraintsRef = useRef<MediaTrackConstraints>({})
  const recoveringRef = useRef(false)
  const recoverMicRef = useRef<(() => Promise<void>) | null>(null)
  /** Aparelho de saida padrao de quando o loopback foi capturado. */
  const outputKeyRef = useRef<string>('')
  /** Segura a tela acesa enquanto grava (ver canKeepScreenAwake). */
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const visibleTimerRef = useRef<number | null>(null)

  const rms = (analyser: AnalyserNode) => {
    const data = new Uint8Array(analyser.frequencyBinCount)
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128
      sum += v * v
    }
    return Math.sqrt(sum / data.length)
  }

  /**
   * Vigia o audio da reuniao. Nenhuma reuniao fica em silencio absoluto por 30s, entao isso
   * denuncia a aba errada ou o audio desmarcado. So avisa; nunca interrompe a gravacao.
   */
  const watchSilence = useCallback(() => {
    const sys = sysAnalyserRef.current
    if (!sys || sysHeardRef.current) return
    // Pausado nao conta como silencio.
    if (mediaRef.current?.state !== 'recording') {
      sysSilentSinceRef.current = null
      return
    }
    if (rms(sys) > SILENCE_RMS) {
      sysHeardRef.current = true
      sysSilentSinceRef.current = null
      setSystemSilent(false)
      return
    }
    const since = sysSilentSinceRef.current ?? Date.now()
    sysSilentSinceRef.current = since
    if (Date.now() - since >= SILENCE_MS) setSystemSilent(true)
  }, [])

  /**
   * Vigia se o MediaRecorder esta REALMENTE recebendo audio. Sem isto, uma captura que morre
   * no meio (ver onstatechange no start) so aparece na hora de transcrever, quando o provedor
   * recusa o arquivo de 0 byte -- tarde demais. Entre 07/08 e 21/08 isso custou 4 reunioes,
   * uma delas de 44 min. Vale tanto para "nunca chegou nada" quanto para "parou de chegar"
   * (contexto de audio que ficou suspenso depois de voltar do segundo plano no celular).
   * So avisa; nunca interrompe a gravacao.
   */
  const watchNoData = useCallback(() => {
    if (mediaRef.current?.state !== 'recording') return
    if (Date.now() - lastDataAtRef.current < NO_DATA_MS) {
      setNoAudioData(false)
      return
    }
    // Contexto suspenso e o motivo classico de a faixa gravada parar de produzir: tenta
    // religar antes de so avisar.
    const ctx = audioCtxRef.current
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {})
    setNoAudioData(true)
  }, [])

  const tickLevel = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    setLevel(Math.min(1, rms(analyser) * 3))
    watchSilence()
    watchNoData()
    rafRef.current = requestAnimationFrame(tickLevel)
  }, [watchSilence, watchNoData])

  /**
   * Liga o audio da reuniao na mistura que ja esta sendo gravada. Devolve false quando o
   * usuario compartilhou algo sem marcar a caixa de audio (o caso comum): ai a gravacao segue
   * so com o microfone e a tela avisa, em vez de jogar fora o que ja foi gravado.
   */
  const attachDisplay = useCallback((display: MediaStream): boolean => {
    const ctx = audioCtxRef.current
    const dest = destRef.current
    const analyser = analyserRef.current
    const sysTracks = display.getAudioTracks()

    if (!ctx || !dest || !analyser || sysTracks.length === 0) {
      display.getTracks().forEach((t) => t.stop())
      // Numa troca de fonte que deu errado, a fonte anterior continua valendo.
      if (!sysAttachedRef.current) setSystemAudioMissing(true)
      return false
    }

    // Trocando de fonte: descarta a captura anterior.
    displayStreamRef.current?.getTracks().forEach((t) => t.stop())
    displayStreamRef.current = display
    // Nao precisamos do video: encerra a faixa de video.
    display.getVideoTracks().forEach((t) => t.stop())

    const sysSource = ctx.createMediaStreamSource(new MediaStream(sysTracks))
    sysSource.connect(dest)
    sysSource.connect(analyser)

    const sysAnalyser = ctx.createAnalyser()
    sysAnalyser.fftSize = 512
    sysSource.connect(sysAnalyser)
    sysAnalyserRef.current = sysAnalyser
    sysHeardRef.current = false
    sysSilentSinceRef.current = null
    sysAttachedRef.current = true
    setSystemSilent(false)
    setSystemAudioMissing(false)

    // Se o usuario parar o compartilhamento pelo navegador, encerramos.
    // No navegador isto e o usuario clicando em "Parar compartilhamento" -- encerrar e o certo.
    // No app Windows esse botao nao existe: a faixa so morre se o aparelho de saida sumiu (fone
    // que conecta/desconecta). Ali pedimos a reconexao em vez de encerrar a reuniao inteira.
    sysTracks[0].onended = () => {
      if (isElectron()) {
        sysAttachedRef.current = false
        requestSystemReattach()
      } else {
        setEnded(true)
      }
    }
    // Guarda em qual aparelho de saida este loopback foi capturado, para detectar a troca.
    void defaultOutputKey().then((k) => {
      outputKeyRef.current = k
    })
    return true
  }, [])

  /** Anexa (ou troca) o audio da reuniao com a gravacao ja rolando. */
  const addSystemAudio = useCallback(async (): Promise<boolean> => {
    if (!destRef.current || !meetingRef.current) return false
    try {
      const display = await navigator.mediaDevices.getDisplayMedia(DISPLAY_OPTIONS)
      return attachDisplay(display)
    } catch {
      return false // usuario fechou o dialogo
    }
  }, [attachDisplay])

  /**
   * Liga um microfone na cadeia de audio: medidor de nivel, mistura da reuniao (quando ela
   * existe) e os vigias da propria track. Serve tanto para o start() quanto para a troca de
   * aparelho -- e o que permite trocar o microfone SEM parar a gravacao, porque no modo
   * reuniao o MediaRecorder grava o DESTINO da mistura, nunca a track do mic.
   */
  const wireMic = useCallback((mic: MediaStream, ctx: AudioContext) => {
    micStreamRef.current = mic
    const source = ctx.createMediaStreamSource(mic)
    micSourceRef.current = source
    if (analyserRef.current) source.connect(analyserRef.current)
    if (destRef.current) source.connect(destRef.current)

    const track = mic.getAudioTracks()[0]
    if (!track) return
    // Fone bluetooth que conecta, dispositivo padrao que o Windows troca, outro app que toma
    // o microfone, iPhone que bloqueia a tela ou abre a camera: a track MORRE (ended) ou o
    // sistema a silencia (mute). Sem estes ganchos nada percebia -- a gravacao seguia
    // "gravando" de uma fonte morta, e o usuario so descobria no fim, com tudo perdido.
    track.onended = () => void recoverMicRef.current?.()
    track.onmute = () => void recoverMicRef.current?.()
    // No celular o mute e o caso normal de ir pra segundo plano: ao voltar, o proprio sistema
    // devolve o som (unmute) sem precisar de mic novo -- e o aviso de "perdemos o microfone"
    // tem que sumir sozinho.
    track.onunmute = () => {
      if (track.readyState === 'live' && !track.muted) setMicLost(false)
    }
  }, [])

  /**
   * Pega o microfone de novo e o costura na mistura que JA esta sendo gravada. Funciona nos
   * dois modos porque a faixa gravada e sempre o destino da mistura: trocar a fonte por baixo
   * e invisivel para o MediaRecorder. (Ate a v0.19.3 a gravacao padrao gravava a PROPRIA track
   * do mic; quando o iPhone a matava -- tela bloqueada, foto tirada no meio -- o gravador
   * parava sozinho e o stop() devolvia um arquivo de 0 byte depois de 49 min, 2026-09-04.)
   */
  const recoverMic = useCallback(async () => {
    const ctx = audioCtxRef.current
    if (!ctx || !mediaRef.current || mediaRef.current.state === 'inactive') return
    if (recoveringRef.current) return
    const old = micStreamRef.current
    const oldTrack = old?.getAudioTracks()[0]
    // Se a track original ja se recuperou sozinha (unmute ao voltar pro app), nao ha o que
    // trocar -- reabrir o mic a toa cortaria um instante de audio sem motivo.
    if (oldTrack && oldTrack.readyState === 'live' && !oldTrack.muted) {
      setMicLost(false)
      return
    }
    recoveringRef.current = true
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ audio: micConstraintsRef.current })
      micSourceRef.current?.disconnect()
      old?.getTracks().forEach((t) => t.stop())
      wireMic(fresh, ctx)
      setMicLost(false)
    } catch {
      // Sem microfone disponivel AGORA. No celular isso e o app em segundo plano (o sistema
      // nao entrega o mic a quem nao esta na tela): o vigia de visibilidade tenta de novo
      // assim que o usuario volta. A gravacao continua (no modo reuniao o audio do sistema
      // ainda entra); o que se perde e so a voz enquanto isso -- avisamos, nunca interrompemos.
      setMicLost(true)
    } finally {
      recoveringRef.current = false
    }
  }, [wireMic])
  recoverMicRef.current = recoverMic

  /** Segura a tela acesa. Sem suporte ou negado (bateria baixa), segue sem -- e so conforto. */
  const acquireWakeLock = useCallback(async () => {
    if (!canKeepScreenAwake() || document.visibilityState !== 'visible') return
    if (wakeLockRef.current && !wakeLockRef.current.released) return
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen')
    } catch {
      wakeLockRef.current = null
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    wakeLockRef.current?.release().catch(() => {})
    wakeLockRef.current = null
  }, [])

  /**
   * O usuario voltou para o app (tela desbloqueada, saiu da camera, trocou de app de volta).
   * No celular e SO AQUI que da pra consertar o que o sistema desfez em segundo plano: o
   * AudioContext que ficou "interrupted"/suspenso, o wake lock que o sistema solta ao esconder
   * a pagina, e o microfone que morreu. Espera 1s porque o iOS devolve o mic original (unmute)
   * logo depois de mostrar a pagina -- reabrir antes disso trocaria um mic bom por outro.
   */
  const onVisibilityChange = useCallback(() => {
    if (document.visibilityState !== 'visible') return
    const rec = mediaRef.current
    if (!rec || rec.state === 'inactive') return
    const ctx = audioCtxRef.current
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {})
    void acquireWakeLock()
    // Em segundo plano nada chega mesmo: o vigia de dados recomeca a contar daqui, senao
    // avisaria "nao esta capturando" no instante em que o usuario volta.
    lastDataAtRef.current = Date.now()
    if (visibleTimerRef.current) window.clearTimeout(visibleTimerRef.current)
    visibleTimerRef.current = window.setTimeout(() => {
      visibleTimerRef.current = null
      if (!mediaRef.current || mediaRef.current.state === 'inactive') return
      const track = micStreamRef.current?.getAudioTracks()[0]
      if (!track || track.readyState !== 'live' || track.muted) void recoverMicRef.current?.()
      else setMicLost(false)
    }, 1000)
  }, [acquireWakeLock])

  /**
   * O Windows mexeu na lista de aparelhos. So reagimos quando a track REALMENTE morreu: o
   * evento dispara a cada fone que entra ou sai, e reaquirir a toa cortaria audio sem motivo
   * (com a track viva, o proprio Chrome ja acompanha a troca do dispositivo padrao).
   */
  /**
   * O aparelho de SAIDA padrao mudou com a reuniao gravando? O loopback continua preso ao
   * aparelho de quando a captura comecou -- e a razao de "conectei o fone e a reuniao saiu muda".
   * Refazer a captura emenda no destino da mistura sem parar o MediaRecorder.
   */
  const checkOutputChanged = useCallback(async () => {
    if (!sysAttachedRef.current || mediaRef.current?.state !== 'recording') return
    const key = await defaultOutputKey()
    if (!key || !outputKeyRef.current || key === outputKeyRef.current) return
    outputKeyRef.current = key
    requestSystemReattach()
  }, [])

  const onDeviceChange = useCallback(() => {
    const track = micStreamRef.current?.getAudioTracks()[0]
    if (!track || track.readyState !== 'live' || track.muted) void recoverMicRef.current?.()
    void checkOutputChanged()
  }, [checkOutputChanged])

  const startTimer = useCallback(() => {
    startedAtRef.current = Date.now()
    timerRef.current = window.setInterval(() => {
      const elapsed = elapsedBeforePauseRef.current + (Date.now() - startedAtRef.current) / 1000
      setSeconds(Math.floor(elapsed))
    }, 250)
  }, [])

  const start = useCallback(
    async (opts?: StartOptions) => {
      setError(null)
      setEnded(false)
      setSystemAudioMissing(false)
      setSystemSilent(false)
      setNoAudioData(false)
      setMicLost(false)
      bytesRef.current = 0
      sysHeardRef.current = false
      sysSilentSinceRef.current = null
      sysAttachedRef.current = false
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioCtx()
        audioCtxRef.current = ctx
        // Um AudioContext pode nascer "suspended" (politica de autoplay). Suspenso, o
        // MediaStreamDestination (a faixa que o MediaRecorder grava) nao recebe audio nenhum --
        // a gravacao sai muda/vazia e o provedor devolve "could not process file". resume()
        // e no-op se ja estiver rodando.
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
        // O sistema pode SUSPENDER o contexto no meio da gravacao (bloqueio de tela, economia
        // de energia, janela minimizada). No modo reuniao a faixa gravada sai do
        // MediaStreamDestination DESTE contexto: suspenso, ele para de produzir audio e o
        // MediaRecorder nao recebe mais nada -- enquanto o cronometro (Date.now) segue contando.
        // E a assinatura exata dos arquivos de 0 byte com 22-44 min no audit_log, todos em modo
        // reuniao. O resume() acima cobre so o estado inicial; isto mantem a captura viva.
        // (O iOS tem ainda um estado proprio, "interrupted", quando outro app toma o audio --
        // ligacao, camera. Vale o mesmo: tenta voltar; se o sistema nao deixar agora, o vigia
        // de visibilidade tenta de novo quando o usuario voltar ao app.)
        ctx.onstatechange = () => {
          const s = ctx.state as string
          if ((s === 'suspended' || s === 'interrupted') && mediaRef.current?.state === 'recording') {
            ctx.resume().catch(() => {})
          }
        }
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 512
        analyserRef.current = analyser

        // Microfone. Mono: um mic estereo gastaria metade do bitrate com um canal redundante.
        //
        // echoCancellation/noiseSuppression dependem do MODO:
        //  - Reuniao no PC (system=true): o audio da reuniao ja vem LIMPO do sistema (loopback/aba).
        //    O mic e so pra SUA voz. Com EC ligado, o mic NAO capta de novo o som do alto-falante
        //    -- sem isso, a reuniao entra duas vezes (loopback + mic) e vira ECO. => EC/NS LIGADOS.
        //  - Gravacao padrao (so mic): quem grava no viva-voz (sem fone) quer captar o que sai do
        //    alto-falante (ligacao, video). EC/NS cancelariam justamente esse audio. => DESLIGADOS.
        // autoGainControl fica sempre: so normaliza volume, nao remove conteudo.
        const cleanVoiceOnly = !!opts?.system
        micConstraintsRef.current = {
          channelCount: 1,
          echoCancellation: cleanVoiceOnly,
          noiseSuppression: cleanVoiceOnly,
          autoGainControl: true,
        }

        // O destino da mistura nasce ANTES do microfone, NOS DOIS MODOS: e nele que o wireMic
        // pluga a voz, e e dele que o MediaRecorder grava. A faixa do destino nunca morre nem e
        // silenciada pelo sistema -- so as fontes ligadas nela -- entao trocar o microfone depois
        // (fone que conecta, aparelho padrao que muda, iPhone que tira o mic do app em segundo
        // plano) nao encosta na gravacao. Gravar a track do mic direto, como a gravacao padrao
        // fazia antes, deixava o gravador morrer junto com ela.
        const dest = ctx.createMediaStreamDestination()
        dest.channelCount = 1
        dest.channelCountMode = 'explicit'
        destRef.current = dest
        meetingRef.current = !!opts?.system
        if (opts?.system) {
          // O main chama isto de volta com gesto simulado quando a saida troca (ver
          // ana:reattach-system-audio em electron/main.cjs). addSystemAudio troca a fonte da
          // reuniao na mistura que ja esta gravando.
          reattachHook().__anaReattachSystemAudio = () => {
            void addSystemAudio()
          }
        }

        const mic = await navigator.mediaDevices.getUserMedia({ audio: micConstraintsRef.current })
        wireMic(mic, ctx)
        // O Windows avisa aqui quando um aparelho entra ou sai (o fone bluetooth do caso tipico).
        navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange)
        // Celular: e ao VOLTAR para o app que da pra reaver o que o sistema tirou (mic, contexto).
        document.addEventListener('visibilitychange', onVisibilityChange)

        const recordStream: MediaStream = dest.stream

        if (opts?.system) {

          // Audio da aba/sistema (a outra ponta da reuniao). Se o usuario nao marcar a caixa de
          // audio, ou fechar o dialogo, seguimos gravando so a voz dele: perder a reuniao
          // inteira seria pior. A tela avisa e oferece anexar o audio depois.
          try {
            attachDisplay(await navigator.mediaDevices.getDisplayMedia(DISPLAY_OPTIONS))
          } catch {
            setSystemAudioMissing(true)
          }
        }

        rafRef.current = requestAnimationFrame(tickLevel)

        const mime = MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : ''
        mimeRef.current = mime || 'audio/webm'
        const recorder = new MediaRecorder(recordStream, {
          ...(mime ? { mimeType: mime } : {}),
          audioBitsPerSecond: config.recordingBitrate,
        })
        chunksRef.current = []
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            bytesRef.current += e.data.size
            lastDataAtRef.current = Date.now()
            chunksRef.current.push(e.data)
          }
        }
        recorder.onstop = () => {
          // Ninguem pediu o stop: o gravador morreu sozinho (navegador suspendeu a pagina,
          // sistema matou a captura). Os pedacos ja entregues continuam em chunksRef; avisar
          // `ended` faz a tela encerrar e o stop() abaixo devolve o que existe, em vez de o
          // cronometro seguir "gravando" de um gravador morto ate o usuario clicar e receber
          // um arquivo de 0 byte (era exatamente isso ate a v0.19.3).
          if (!resolveRef.current) {
            setEnded(true)
            return
          }
          const blob = new Blob(chunksRef.current, { type: mimeRef.current })
          const url = URL.createObjectURL(blob)
          resolveRef.current({
            blob,
            durationSeconds: Math.round(elapsedBeforePauseRef.current),
            url,
          })
        }
        mediaRef.current = recorder
        // Timeslice de 1s: sem isso, o MediaRecorder so entrega dados no stop() -- se o
        // navegador travar/fechar/perder energia antes do usuario clicar em Encerrar, a
        // gravacao inteira se perderia (nada existe em memoria para salvar). Com o timeslice,
        // `snapshot()` sempre tem o audio capturado ate agora, permitindo checkpoints.
        lastDataAtRef.current = Date.now()
        recorder.start(1000)

        elapsedBeforePauseRef.current = 0
        setSeconds(0)
        setState('recording')
        startTimer()
        // Tela acesa enquanto grava: no celular, a tela apagando e o que manda o app para
        // segundo plano e faz o sistema tirar o microfone dele.
        void acquireWakeLock()
      } catch (err) {
        const name = (err as DOMException)?.name
        if (name === 'NotAllowedError') {
          setError('Permissão negada. Autorize o microfone e o compartilhamento de áudio.')
        } else {
          setError('Não foi possível iniciar a captura de áudio.')
        }
        setState('idle')
      }
    },
    [attachDisplay, addSystemAudio, startTimer, tickLevel, wireMic, onDeviceChange, onVisibilityChange, acquireWakeLock],
  )

  const pause = useCallback(() => {
    const rec = mediaRef.current
    if (rec && rec.state === 'recording') {
      rec.pause()
      elapsedBeforePauseRef.current += (Date.now() - startedAtRef.current) / 1000
      if (timerRef.current) clearInterval(timerRef.current)
      setState('paused')
    }
  }, [])

  const resume = useCallback(() => {
    const rec = mediaRef.current
    if (rec && rec.state === 'paused') {
      rec.resume()
      // Pausado nao chega dado nenhum, e isso nao e travamento.
      lastDataAtRef.current = Date.now()
      startTimer()
      setState('recording')
    }
  }, [startTimer])

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (visibleTimerRef.current) window.clearTimeout(visibleTimerRef.current)
    visibleTimerRef.current = null
    navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    releaseWakeLock()
    meetingRef.current = false
    micSourceRef.current?.disconnect()
    micSourceRef.current = null
    delete reattachHook().__anaReattachSystemAudio
    micStreamRef.current?.getTracks().forEach((t) => t.stop())
    displayStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioCtxRef.current?.close().catch(() => {})
    destRef.current = null
    sysAnalyserRef.current = null
    sysAttachedRef.current = false
    setLevel(0)
  }, [onDeviceChange, onVisibilityChange, releaseWakeLock])

  /** Retrata o audio capturado ATE AGORA, sem parar a gravacao -- usado para checkpoints
   *  periodicos (a gravacao so vira Blob final de verdade no stop()). */
  const snapshot = useCallback((): Blob | null => {
    if (!chunksRef.current.length) return null
    return new Blob(chunksRef.current, { type: mimeRef.current })
  }, [])

  const stop = useCallback((): Promise<RecorderResult> => {
    return new Promise((resolve) => {
      if (mediaRef.current && mediaRef.current.state !== 'inactive') {
        if (mediaRef.current.state === 'recording') {
          elapsedBeforePauseRef.current += (Date.now() - startedAtRef.current) / 1000
        }
        resolveRef.current = (r) => {
          cleanup()
          setState('stopped')
          resolve(r)
        }
        mediaRef.current.stop()
      } else if (mediaRef.current) {
        // O gravador ja tinha parado sozinho (ver recorder.onstop). Tudo o que ele entregou
        // ate morrer continua em memoria: e ISSO que devolvemos -- nunca um Blob vazio, que
        // jogaria fora a gravacao inteira e ainda deixaria a tela em "Gravando..." para sempre.
        const blob = new Blob(chunksRef.current, { type: mimeRef.current })
        cleanup()
        setState('stopped')
        resolve({ blob, durationSeconds: seconds, url: blob.size ? URL.createObjectURL(blob) : '' })
      } else {
        resolve({ blob: new Blob(), durationSeconds: seconds, url: '' })
      }
    })
  }, [cleanup, seconds])

  return {
    state,
    seconds,
    level,
    error,
    ended,
    systemAudioMissing,
    systemSilent,
    noAudioData,
    micLost,
    start,
    addSystemAudio,
    pause,
    resume,
    stop,
    snapshot,
  }
}
