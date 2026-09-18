// Onde a pessoa consegue o app Windows.
//
// Dois caminhos, de proposito:
//  - a LOJA (Microsoft Store) e o caminho publico a partir de 18/09/2026: instala sem aviso do
//    SmartScreen (a Microsoft assina o pacote) e atualiza sozinha pelo Windows;
//  - o INSTALADOR no GitHub continua existindo como backup nosso e como destino de quem ja tem
//    uma copia antiga instalada -- mandar essa pessoa para a Loja criaria uma SEGUNDA instalacao
//    ao lado da que ela ja usa.

const REPO = 'https://github.com/tailorexec/tailor-executive-ai-notes'

/**
 * Ficha do ANA na Microsoft Store.
 *
 * Enquanto estiver vazio, todos os botoes de baixar continuam levando ao instalador do GitHub --
 * nada de link morto. Assim que o app for publicado, cole aqui a URL da ficha
 * (https://apps.microsoft.com/detail/<id>) e o site inteiro passa a apontar para a Loja.
 */
export const MICROSOFT_STORE_URL = ''

/** Instalador de nome fixo da release mais recente. Ate 17/09/2026 o link levava a versao no nome
 *  do arquivo, e esse segundo numero aparecia na tela ao lado da versao do site -- confundia.
 *  Agora a unica versao visivel e APP_VERSION (ver version.ts). */
export const WINDOWS_INSTALLER_URL = `${REPO}/releases/latest/download/ANA-Tailor-Setup-Windows.exe`

/** Para onde mandar quem quer INSTALAR o app: a Loja quando ela existir, o instalador ate la. */
export const WINDOWS_APP_DOWNLOAD_URL = MICROSOFT_STORE_URL || WINDOWS_INSTALLER_URL

/** true quando o botao de baixar leva para a Loja (o texto do botao muda junto). */
export const WINDOWS_FROM_STORE = MICROSOFT_STORE_URL !== ''
