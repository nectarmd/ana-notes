// Entrega de arquivo gerado pelo app (PDF, Word, transcricao, audio, mapa mental) -- um caminho
// so para todas as frentes. Existe por causa de 01/10/2026: o botao PDF nao fazia NADA. Ele abria
// uma janela em branco para imprimir, e o app Windows recusa qualquer janela que nao seja link
// externo (setWindowOpenHandler em electron/main.cjs); no APK Android a WebView nem imprime nem
// baixa blob. Agora cada frente recebe o arquivo do jeito que ela sabe lidar:
//   - APK Android: plugin nativo FileSave grava no cache e abre o "Compartilhar" do Android
//     (Drive, WhatsApp, Arquivos...). A WebView do Capacitor ignora <a download> e navigator.share.
//   - Celular no navegador/PWA: menu de compartilhar do sistema com o arquivo (iOS e Android).
//   - Computador e app Windows: download comum (o Electron abre o "Salvar como").

import { Capacitor, registerPlugin } from '@capacitor/core'
import { currentDevice } from './device'

export type SaveResult = 'saved' | 'shared' | 'cancelled'

interface FileSavePluginDef {
  /** Acrescenta um pedaco (base64) ao arquivo `name` no cache; `reset` recomeça do zero. */
  append(opts: { name: string; data: string; reset: boolean }): Promise<void>
  /** Abre o "Compartilhar" do Android com o arquivo montado. */
  open(opts: { name: string; mimeType: string; title: string }): Promise<void>
}

const FileSave = registerPlugin<FileSavePluginDef>('FileSave')

/** APK instalado antes deste recurso: o plugin nao existe e o usuario precisa atualizar o app. */
export class AppUpdateRequiredError extends Error {
  constructor() {
    super('app_update_required')
    this.name = 'AppUpdateRequiredError'
  }
}

function isAndroidApp(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  } catch {
    return false
  }
}

/** Pedacos de 768 KB (multiplo de 3: o base64 de cada um nao precisa de "=" no meio). */
const CHUNK = 768 * 1024

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 32768) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 32768))
  }
  return btoa(bin)
}

async function saveOnAndroidApp(blob: Blob, filename: string): Promise<SaveResult> {
  if (!Capacitor.isPluginAvailable('FileSave')) throw new AppUpdateRequiredError()
  let off = 0
  do {
    const data = await blobToBase64(blob.slice(off, off + CHUNK))
    await FileSave.append({ name: filename, data, reset: off === 0 })
    off += CHUNK
  } while (off < blob.size)
  await FileSave.open({ name: filename, mimeType: blob.type || 'application/octet-stream', title: filename })
  return 'shared'
}

function downloadViaLink(blob: Blob, filename: string): SaveResult {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  // No DOM: o Firefox ignora o clique em link solto.
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'saved'
}

/**
 * Entrega `blob` ao usuario como arquivo `filename`. Lanca AppUpdateRequiredError no APK antigo
 * e o erro original quando nada funcionou -- quem chama mostra o aviso (nunca falhar calado).
 */
export async function saveFile(blob: Blob, filename: string): Promise<SaveResult> {
  if (isAndroidApp()) return saveOnAndroidApp(blob, filename)

  if (currentDevice() === 'mobile' && typeof navigator !== 'undefined' && navigator.canShare) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' })
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename })
        return 'shared'
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return 'cancelled'
        // NotAllowedError (o gesto expirou) e afins: cai no download, que nao exige gesto.
      }
    }
  }

  return downloadViaLink(blob, filename)
}
