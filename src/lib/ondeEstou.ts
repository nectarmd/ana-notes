/**
 * Onde a pessoa esta usando o ANA -- e, por consequencia, o que faz sentido oferecer pra ela
 * baixar (24/09/2026).
 *
 * Antes cada tela decidia isso por conta propria, e sobravam botoes sem sentido: "Baixar o app do
 * Windows" DENTRO do app do Windows (a pessoa ja baixou) e no celular (onde nao da nem para
 * instalar). Agora a regra mora aqui, em um lugar so.
 *
 * As tres situacoes que importam:
 *  - app do Windows (Electron): ja tem o app -- nao oferecer download nenhum;
 *  - celular (navegador ou PWA): o que existe pra ele e a instalacao na tela de inicio (PWA);
 *  - computador no navegador: e o unico lugar onde baixar o app do Windows faz sentido.
 */
import { isElectron } from './electron'
import { isStandaloneDisplay } from './pwaInstall'

/** Celular ou tablet? */
export function ehCelular(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')
}

/** Oferecer o app do Windows? So no computador, e so fora do proprio app. */
export function podeBaixarWindows(): boolean {
  return !isElectron() && !ehCelular()
}

/**
 * Oferecer "instalar na tela de inicio" (PWA)? No app do Windows nao faz sentido, e quem ja
 * instalou (esta rodando em modo app) tambem nao precisa ver.
 */
export function podeInstalarNoCelular(): boolean {
  return !isElectron() && !isStandaloneDisplay()
}

/** Ja esta usando o ANA instalado -- app do Windows ou PWA na tela de inicio. */
export function jaEstaInstalado(): boolean {
  return isElectron() || isStandaloneDisplay()
}
