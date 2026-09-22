import { version } from '../../package.json'

/**
 * UMA versao para tudo (pedido de 17/09/2026): a do package.json. E o numero que aparece na tela, no
 * site e no instalador do Windows gerado a partir deste codigo. Suba o "version" do package.json a
 * cada deploy -- nao existe mais um segundo numero para manter em sincronia.
 *
 * Por que havia dois: o app Windows (e o APK Android) e so uma "casca" que abre o site ao vivo. O
 * site muda a cada deploy; a casca so muda quando electron/ muda. A tela mostrava os dois numeros
 * ("aplicativo instalado v0.20.2" x "site carregado v0.20.3") e isso confundia.
 */
export const APP_VERSION = `v${version}`
export const APP_NAME = 'ANA'

/**
 * Menor instalador do Windows de que o site precisa (recursos nativos em electron/). NAO aparece
 * para o usuario: abaixo disto o app mostra "Atualização disponível"; acima, "Em dia". Suba SO quando
 * uma mudanca em electron/ for necessaria para o site funcionar. Sem prefixo "v".
 */
export const WINDOWS_REQUIRED_BUILD = '0.20.2'

/** true se `a` for MENOR que `b` ("0.18.9" < "0.18.10"). Partes ausentes contam 0. */
export function isOlderVersion(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x < y
  }
  return false
}
