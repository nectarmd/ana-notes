// Cotacao USD -> BRL para o painel de custos (so para VISUALIZAR: os valores continuam gravados em
// dolar, que e como os provedores cobram).
//
// Fonte: AwesomeAPI (economia.awesomeapi.com.br), gratuita, sem chave, com CORS liberado. Cache de
// 1 hora no aparelho: o painel nao precisa de cotacao ao segundo e nao pode depender de uma API
// externa estar no ar -- sem rede, usa a ultima cotacao guardada (e mostra de quando ela e).

export type Currency = 'USD' | 'BRL'

export interface Rate {
  value: number
  /** Momento da cotacao na fonte. */
  at: string
  source: string
}

const KEY = 'tailor.usdbrl'
const CURRENCY_KEY = 'tailor.admin.currency'
const TTL_MS = 60 * 60 * 1000

function readCache(): (Rate & { fetchedAt: number }) | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export async function getUsdBrl(): Promise<Rate | null> {
  const cached = readCache()
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached
  try {
    const res = await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL')
    if (!res.ok) throw new Error(String(res.status))
    const data = await res.json()
    const bid = Number(data?.USDBRL?.bid)
    if (!Number.isFinite(bid) || bid <= 0) throw new Error('cotacao invalida')
    const rate: Rate = {
      value: bid,
      at: data.USDBRL.create_date ?? new Date().toISOString(),
      source: 'AwesomeAPI',
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...rate, fetchedAt: Date.now() }))
    } catch {
      /* sem cache: segue */
    }
    return rate
  } catch {
    return cached ?? null
  }
}

export function savedCurrency(): Currency {
  try {
    return localStorage.getItem(CURRENCY_KEY) === 'BRL' ? 'BRL' : 'USD'
  } catch {
    return 'USD'
  }
}

export function saveCurrency(c: Currency): void {
  try {
    localStorage.setItem(CURRENCY_KEY, c)
  } catch {
    /* ignore */
  }
}

/**
 * Formata um valor em USD na moeda escolhida. Valores pequenos ganham mais casas: uma chamada de
 * resumo custa US$ 0,003 -- arredondar para US$ 0,00 esconderia exatamente o que se quer medir.
 */
export function money(usd: number, currency: Currency, rate: number | null): string {
  const value = currency === 'BRL' && rate ? usd * rate : usd
  const abs = Math.abs(value)
  const digits = abs === 0 ? 2 : abs < 0.01 ? 4 : abs < 1 ? 3 : 2
  if (currency === 'BRL' && rate) {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: digits, maximumFractionDigits: digits })
  }
  return `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}
