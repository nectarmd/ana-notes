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
 * Ficha do ANA na Microsoft Store -- desde 24/09/2026 o ANA esta publicado e ESTE e o caminho
 * oficial de instalacao no Windows. A Loja assina o pacote (fim do aviso de "arquivo suspeito"
 * do SmartScreen, que o nosso instalador sempre provocou por nao ser assinado) e passa a cuidar
 * das atualizacoes pelo proprio Windows.
 *
 * O tipo anotado (: string) existe porque o TypeScript, vendo o literal, passaria a tratar
 * `MICROSOFT_STORE_URL !== ''` como sempre verdadeiro e apontaria erro na linha do
 * WINDOWS_FROM_STORE -- que precisa continuar funcionando se algum dia este valor voltar a
 * ficar vazio.
 */
export const MICROSOFT_STORE_URL: string = 'https://apps.microsoft.com/detail/9NVQVWGLR52F'

/**
 * Instalador .exe da release do GitHub.
 *
 * NAO e mais oferecido a ninguem (o download publico vai para a Loja). Continua aqui porque e o
 * canal de ATUALIZACAO de quem ja tem o app instalado por ele: o electron-updater busca a release
 * do GitHub, e o aviso fino de "atualizacao disponivel" (UpdateBanner) aponta para este arquivo.
 * Enquanto houver gente nessa instalacao, as releases precisam continuar saindo.
 */
export const WINDOWS_INSTALLER_URL = `${REPO}/releases/latest/download/ANA-Tailor-Setup-Windows.exe`

/** Para onde mandar quem quer INSTALAR o app: a Loja quando ela existir, o instalador ate la. */
export const WINDOWS_APP_DOWNLOAD_URL = MICROSOFT_STORE_URL || WINDOWS_INSTALLER_URL

/** true quando o botao de baixar leva para a Loja (o texto do botao muda junto). */
export const WINDOWS_FROM_STORE = MICROSOFT_STORE_URL !== ''
