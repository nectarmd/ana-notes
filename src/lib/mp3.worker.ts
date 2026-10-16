// Codifica PCM mono (Float32) em MP3 fora da thread da tela -- uma reuniao de 1h leva alguns
// segundos de CPU e travaria a interface. Recebe { pcm, sampleRate, kbps } e devolve
// mensagens { progress } e, no fim, { done: Blob } ou { error }.

import { Mp3Encoder } from '@breezystack/lamejs'

const FRAME = 1152 * 32

self.onmessage = (e: MessageEvent<{ pcm: Float32Array; sampleRate: number; kbps: number }>) => {
  try {
    const { pcm, sampleRate, kbps } = e.data
    const enc = new Mp3Encoder(1, sampleRate, kbps)
    const parts: Uint8Array[] = []
    const buf = new Int16Array(FRAME)
    let lastPct = -1
    for (let off = 0; off < pcm.length; off += FRAME) {
      const n = Math.min(FRAME, pcm.length - off)
      for (let i = 0; i < n; i++) {
        const s = Math.max(-1, Math.min(1, pcm[off + i]))
        buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      const out = enc.encodeBuffer(n === FRAME ? buf : buf.subarray(0, n))
      if (out.length) parts.push(new Uint8Array(out))
      const pct = Math.floor(((off + n) / pcm.length) * 100)
      if (pct !== lastPct) {
        lastPct = pct
        self.postMessage({ progress: pct })
      }
    }
    const tail = enc.flush()
    if (tail.length) parts.push(new Uint8Array(tail))
    self.postMessage({ done: new Blob(parts as BlobPart[], { type: 'audio/mpeg' }) })
  } catch (err) {
    self.postMessage({ error: String((err as Error)?.message ?? err) })
  }
}
