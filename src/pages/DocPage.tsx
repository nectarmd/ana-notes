import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, LifeBuoy, List } from 'lucide-react'

export interface DocSectionData {
  id: string
  title: string
  body: ReactNode
}

/**
 * Pagina de documento (termos, privacidade). Refeita em 17/09/2026: indice fixo ao lado no
 * computador (e recolhivel no celular), secoes numeradas com ancora, largura de leitura
 * confortavel e um atalho para o suporte no fim. Antes era texto corrido sem indice.
 */
export function DocPage({
  title,
  subtitle,
  icon,
  updated,
  sections,
}: {
  title: string
  subtitle?: string
  icon: ReactNode
  updated: string
  sections: DocSectionData[]
}) {
  const navigate = useNavigate()
  const [current, setCurrent] = useState(sections[0]?.id ?? '')

  // Destaca no indice a secao que esta na tela.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setCurrent(visible[0].target.id.replace(/^doc-/, ''))
      },
      { rootMargin: '0px 0px -65% 0px' },
    )
    sections.forEach((s) => {
      const el = document.getElementById(`doc-${s.id}`)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [sections])

  function go(id: string) {
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const toc = (
    <ol className="space-y-0.5">
      {sections.map((s, i) => (
        <li key={s.id}>
          <button
            onClick={() => go(s.id)}
            className={`w-full text-left flex gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
              current === s.id
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-content-secondary hover:text-content-primary hover:bg-surface-elevated'
            }`}
          >
            <span className="tabular-nums w-5 shrink-0">{i + 1}.</span>
            <span className="min-w-0">{s.title}</span>
          </button>
        </li>
      ))}
    </ol>
  )

  return (
    <div className="px-5 safe-top pb-16 max-w-5xl mx-auto">
      <header className="flex items-start gap-3 mb-6">
        <button
          onClick={() => navigate('/config')}
          className="grid place-items-center h-10 w-10 rounded-full bg-surface-elevated border border-surface-border shrink-0"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-accent shrink-0">{icon}</span>
            <h1 className="font-display text-2xl font-bold">{title}</h1>
          </div>
          {subtitle && <p className="text-sm text-content-secondary mt-1">{subtitle}</p>}
          <p className="text-xs text-content-muted mt-1">{updated}</p>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 lg:items-start">
        <aside className="hidden lg:block sticky top-6">
          <p className="text-[11px] uppercase tracking-wide text-content-muted mb-2 px-2.5">Nesta página</p>
          {toc}
        </aside>

        {/* Celular: indice recolhivel no topo. */}
        <details className="lg:hidden card mb-5 group">
          <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none text-sm font-medium">
            <List size={16} className="text-accent" /> Nesta página
            <span className="ml-auto text-xs text-content-muted">{sections.length} seções</span>
          </summary>
          <div className="px-2 pb-3">{toc}</div>
        </details>

        <div className="min-w-0">
          <article className="card divide-y divide-surface-border">
            {sections.map((s, i) => (
              <section key={s.id} id={`doc-${s.id}`} className="scroll-mt-6 px-5 py-5 sm:px-6">
                <h2 className="flex gap-2 font-display font-semibold text-content-primary mb-2">
                  <span className="text-accent tabular-nums">{i + 1}.</span>
                  {s.title}
                </h2>
                <div className="space-y-2.5 text-[15px] leading-relaxed text-content-secondary">{s.body}</div>
              </section>
            ))}
          </article>

          <div className="card p-5 mt-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-display font-semibold">Ficou alguma dúvida?</p>
              <p className="text-sm text-content-muted mt-0.5">Fale com a equipe pelo suporte. A resposta chega no app, no sininho.</p>
            </div>
            <button onClick={() => navigate('/suporte')} className="btn-primary h-10 px-4 text-sm shrink-0">
              <LifeBuoy size={16} /> Falar com o suporte
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Lista com marcador, para enumeracoes dentro de uma secao. */
export function DocList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent shrink-0" aria-hidden />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  )
}
