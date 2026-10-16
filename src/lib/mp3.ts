// Converte a gravacao para MP3 antes de entregar ao usuario (botao "Audio" do Compartilhar).
// As gravacoes nascem em webm/opus (navegador, app Windows) ou m4a (APK Android): formatos que
// muita gente nao consegue abrir no WhatsApp do PC, no player do Windows antigo ou mandar para
// cliente. O MP3 abre em qualquer lugar.
//
// Como: o proprio navegador decodifica o audio (decodeAudioData) ja reamostrado para 22,05 kHz
// mono -- voz nao precisa de mais -- e um worker codifica em MP3 de 48 kbps (~21 MB por hora,
// perto do tamanho do webm original). O decodificador nao existe dentro de worker, por isso essa
// metade roda aqui.

const SAMPLE_RATE = 22050
const KBPS = 48

/** Etapa e percentual, para o botao mostrar que esta trabalhando numa gravacao longa. */
export type Mp3Progress = (pct: number) => void

async function decodeMono(blob: Blob): Promise<Float32Array> {
  const Offline =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
  if (!Offline) throw new Error('sem_audio_context')
  // O contexto offline com a taxa desejada faz o decodeAudioData ja devolver reamostrado.
  const ctx = new Offline(1, 1, SAMPLE_RATE)
  const audio = await ctx.decodeAudioData(await blob.arrayBuffer())
  // Copia: o buffer e do AudioBuffer e vai ser transferido ao worker.
  if (audio.numberOfChannels === 1) return audio.getChannelData(0).slice()
  // Estereo (arquivo importado): mistura em mono.
  const mono = new Float32Array(audio.length)
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c)
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels
  }
  return mono
}

export async function toMp3(blob: Blob, onProgress?: Mp3Progress): Promise<Blob> {
  if (blob.type.split(';')[0] === 'audio/mpeg') return blob
  const pcm = await decodeMono(blob)
  const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<Blob>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ progress?: number; done?: Blob; error?: string }>) => {
        if (e.data.done) resolve(e.data.done)
        else if (e.data.error) reject(new Error(e.data.error))
        else if (typeof e.data.progress === 'number') onProgress?.(e.data.progress)
      }
      worker.onerror = (e) => reject(new Error(e.message || 'mp3_worker'))
      worker.postMessage({ pcm, sampleRate: SAMPLE_RATE, kbps: KBPS }, [pcm.buffer])
    })
  } finally {
    worker.terminate()
  }
}
