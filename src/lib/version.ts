/** Fonte unica da versao do app. Atualize aqui a cada deploy. */
export const APP_VERSION = 'v0.19.7'
export const APP_NAME = 'ANA by Tailor'

/**
 * Ultima versao do INSTALADOR Windows publicada no GitHub Releases (igual ao `version` do
 * package.json quando foi gerado). O app Windows carrega o site ao vivo, entao mudancas web
 * chegam sozinhas -- mas quando o instalador nativo muda (pasta electron/), o usuario precisa
 * baixar/instalar de novo. Quando o app rodando reporta uma versao MENOR que esta (ou nenhuma,
 * em instaladores antigos), o site mostra o aviso "atualizacao disponivel". Bump aqui SO ao
 * publicar um instalador novo. Sem prefixo "v".
 */
export const LATEST_WINDOWS_BUILD = '0.19.5'
