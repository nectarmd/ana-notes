// Aviso de que alguem marcou/desmarcou o coracao de uma nota.
//
// A lista de favoritas vive no menu lateral (AppShell) e o coracao fica nos cartoes da tela
// inicial -- dois pontos distantes da arvore. Em vez de subir o estado ate o topo so para isso,
// quem marca avisa e quem mostra recarrega.

export const FAVORITES_CHANGED_EVENT = 'ana:favorites-changed'

export function emitFavoritesChanged(): void {
  window.dispatchEvent(new Event(FAVORITES_CHANGED_EVENT))
}
