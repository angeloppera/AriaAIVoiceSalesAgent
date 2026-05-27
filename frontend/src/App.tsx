import React, { useCallback, useState } from 'react'
import { useVoiceAgent, AgentState, Turn } from './hooks/useVoiceAgent'
import './app.css'

// ── Error boundary ─────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  state = { error: null }
  static getDerivedStateFromError(e: Error) { return { error: e.message } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#f1f5f9', fontFamily: 'system-ui', background: '#080c14', height: '100vh' }}>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p style={{ color: '#94a3b8', fontSize: 14, marginBottom: 16 }}>{this.state.error}</p>
          <button onClick={() => this.setState({ error: null })}
            style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function stateLabel(s: AgentState): string {
  const labels: Record<AgentState, string> = {
    idle: 'Tap to speak with Aria',
    connecting: 'Connecting…',
    listening: 'Listening… tap again when done',
    thinking: 'Aria is thinking…',
    speaking: 'Aria is speaking…',
  }
  return labels[s] ?? 'Tap to speak with Aria'
}

function stateColor(s: AgentState): string {
  const colors: Record<AgentState, string> = {
    idle: 'transparent',
    connecting: '#93c5fd',
    listening: '#6ee7b7',
    thinking: '#c4b5fd',
    speaking: '#fca5a5',
  }
  return colors[s] ?? 'transparent'
}

function PulseRing({ state }: { state: AgentState }) {
  return (
    <div
      className={`pulse-ring pulse-${state}`}
      style={{ '--ring-color': stateColor(state) } as React.CSSProperties}
    />
  )
}

function TurnBubble({ turn }: { turn: Turn }) {
  const isUser = turn.role === 'user'
  return (
    <div className={`bubble-row ${isUser ? 'row-user' : 'row-assistant'}`}>
      {!isUser && <div className="avatar-dot">A</div>}
      <div>
        <div className={`bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
          {turn.text}
        </div>
        <div className="bubble-time">
          {!isUser && <span className="agent-name">Aria · </span>}
          {turn.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

// ── Product data ───────────────────────────────────────────────────────────
const PRODUCTS = [
  { name: 'Intel Core i5 System', price: '₱55,000', specs: 'i5-12400 · 16GB RAM · 512GB SSD', badge: 'Popular', tag: 'desktop' },
  { name: 'AMD Ryzen 7 Workstation', price: '₱78,000', specs: 'Ryzen 7 5800X · 32GB RAM · 1TB NVMe', badge: 'Best Value', tag: 'desktop' },
  { name: 'Gaming PC Pro', price: '₱120,000', specs: 'i9-13900K · RTX 4070 · 32GB RAM', badge: 'Gaming', tag: 'desktop' },
  { name: 'Office Budget PC', price: '₱28,000', specs: 'i3-12100 · 8GB RAM · 256GB SSD', badge: '', tag: 'desktop' },
  { name: 'Antec Atom 550W PSU', price: '₱1,750', specs: '550W · 80+ Bronze · ATX', badge: '', tag: 'component' },
  { name: 'Samsung 27" Monitor', price: '₱12,500', specs: '1080p · 75Hz · IPS Panel', badge: 'New', tag: 'monitor' },
]

const BADGE_COLORS: Record<string, string> = {
  Popular: '#3b82f6', 'Best Value': '#10b981', Gaming: '#8b5cf6', New: '#f59e0b',
}

const STATS = [
  { value: '5,000+', label: 'Happy customers' },
  { value: '₱2B+', label: 'Products sold' },
  { value: '99.8%', label: 'Satisfaction rate' },
  { value: '24/7', label: 'AI support' },
]

function MonitorIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
      <rect x="2" y="3" width="20" height="14" rx="2"/>
      <line x1="8" y1="21" x2="16" y2="21"/>
      <line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  )
}

// ── Main App ───────────────────────────────────────────────────────────────
function AppInner() {
  const { state, turns, error, startListening, stopListening, resetSession } = useVoiceAgent()
  const [filter, setFilter] = useState('all')
  const [ariaOpen, setAriaOpen] = useState(false)

  const isListening = state === 'listening'
  const isIdle = state === 'idle'
  const isBusy = state === 'thinking' || state === 'speaking'

  const handleMicClick = useCallback(() => {
    if (isListening) stopListening()
    else if (isIdle) startListening()
  }, [isListening, isIdle, startListening, stopListening])

  const filtered = filter === 'all' ? PRODUCTS : PRODUCTS.filter(p => p.tag === filter)
  const replyCount = turns.filter(t => t.role === 'assistant').length

  return (
    <div className="layout">

      {/* ── LEFT: Store ── */}
      <div className="store-side">
        {/* Nav */}
        <header className="store-nav">
          <div className="nav-left">
            <div className="nav-logo">
              <div className="nav-logo-icon">
                <MonitorIcon />
              </div>
              <span>TechMart</span>
            </div>
            <nav className="nav-links">
              {['Desktops', 'Components', 'Monitors', 'About'].map(n => (
                <a key={n} href="#" className="nav-link">{n}</a>
              ))}
            </nav>
          </div>
          <a href="/admin" className="nav-admin">Admin</a>
        </header>

        <div className="store-body">
          {/* Hero */}
          <section className="hero">
            <div className="hero-glow" />
            <div className="hero-content">
              <div className="hero-pill">
                <span className="hero-pill-dot" />
                AI-Powered Voice Shopping
              </div>
              <h1 className="hero-h1">
                Your next computer,<br />
                <span className="hero-gradient">found by voice.</span>
              </h1>
              <p className="hero-desc">
                Talk to Aria — our AI sales assistant — to discover products,
                compare specs, get pricing, and place your order. No typing needed.
              </p>
              <div className="hero-actions">
                <button className="hero-cta" onClick={() => { setAriaOpen(true); handleMicClick() }} disabled={isBusy}>
                  <svg width="16" height="16" viewBox="0 0 28 28" fill="none" aria-hidden>
                    <rect x="10" y="3" width="8" height="14" rx="4" stroke="white" strokeWidth="2"/>
                    <path d="M5 14a9 9 0 0018 0" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                    <line x1="14" y1="23" x2="14" y2="27" stroke="white" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Talk to Aria
                </button>
                <a href="#products" className="hero-secondary">Browse products →</a>
              </div>
              <div className="hero-stats">
                {STATS.map(s => (
                  <div key={s.label} className="hero-stat">
                    <div className="hero-stat-value">{s.value}</div>
                    <div className="hero-stat-label">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Features */}
          <div className="features-strip">
            {[
              { icon: '🚚', label: 'Free nationwide delivery' },
              { icon: '🛡️', label: '1-year warranty on all PCs' },
              { icon: '🔧', label: 'Free installation & setup' },
              { icon: '💬', label: '24/7 AI assistant support' },
            ].map(f => (
              <div key={f.label} className="feature-item">
                <span className="feature-icon">{f.icon}</span>
                <span className="feature-label">{f.label}</span>
              </div>
            ))}
          </div>

          {/* Products */}
          <section id="products" className="products-section">
            <div className="products-header">
              <div>
                <h2 className="products-h2">Featured products</h2>
                <p className="products-sub">Ask Aria for live pricing and availability</p>
              </div>
              <div className="filter-pills">
                {['all', 'desktop', 'component', 'monitor'].map(f => (
                  <button key={f} className={`filter-pill ${filter === f ? 'active' : ''}`}
                    onClick={() => setFilter(f)}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="products-grid">
              {filtered.map((p, i) => (
                <div key={i} className="product-card">
                  {p.badge && (
                    <span className="product-badge" style={{
                      background: `${BADGE_COLORS[p.badge]}22`,
                      color: BADGE_COLORS[p.badge],
                      borderColor: `${BADGE_COLORS[p.badge]}44`,
                    }}>
                      {p.badge}
                    </span>
                  )}
                  <div className="product-icon-wrap"><MonitorIcon /></div>
                  <div className="product-name">{p.name}</div>
                  <div className="product-specs">{p.specs}</div>
                  <div className="product-footer">
                    <div className="product-price">{p.price}</div>
                    <button className="product-ask"
                      onClick={() => setAriaOpen(true)} disabled={isBusy}>
                      Ask Aria
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* CTA */}
          <section className="cta-banner">
            <div className="cta-content">
              <h3 className="cta-title">Can't find what you need?</h3>
              <p className="cta-desc">Ask Aria — she knows our full catalog and can recommend the perfect setup for your budget.</p>
            </div>
            <button className="cta-btn" onClick={() => setAriaOpen(true)} disabled={isBusy}>
              <svg width="16" height="16" viewBox="0 0 28 28" fill="none" aria-hidden>
                <rect x="10" y="3" width="8" height="14" rx="4" stroke="currentColor" strokeWidth="2"/>
                <path d="M5 14a9 9 0 0018 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <line x1="14" y1="23" x2="14" y2="27" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              Start conversation
            </button>
          </section>

          {/* Footer */}
          <footer className="store-footer">
            <div className="footer-brand">
              <div className="nav-logo-icon" style={{ width: 28, height: 28, fontSize: 12 }}>
                <MonitorIcon />
              </div>
              <span style={{ fontWeight: 600, color: '#fff' }}>TechMart</span>
            </div>
            <div className="footer-links">
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
              <a href="#">Contact</a>
              <a href="/admin">Admin</a>
            </div>
            <div className="footer-copy">© 2026 TechMart Computer Sales. All rights reserved.</div>
          </footer>
        </div>
      </div>

      {/* ── RIGHT: Aria ── */}
      <div className={`agent-side ${ariaOpen ? 'agent-open' : 'agent-closed'}`}>
        <div className="agent-header">
          <div className="agent-brand">
            <div className="agent-avatar">A</div>
            <div>
              <div className="agent-name-lg">Aria</div>
              <div className="agent-status">
                <span className={`status-dot ${state !== 'idle' && state !== 'connecting' ? 'active' : ''}`}></span>
                {state === 'idle' ? 'AI Sales Assistant' : stateLabel(state)}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="agent-reset" onClick={resetSession} title="New conversation">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>
              </svg>
            </button>
            <button className="agent-reset" onClick={() => setAriaOpen(false)} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="agent-transcript">
          {turns.length === 0 && (
            <div className="agent-empty">
              <div className="agent-empty-avatar">A</div>
              <p className="agent-empty-text">Hi! I'm Aria, your AI Sales Assistant. Ask me about our products, pricing, or place an order.</p>
              <div className="agent-chips">
                <span className="agent-chip">What products do you have?</span>
                <span className="agent-chip">What's the best gaming PC?</span>
                <span className="agent-chip">I'd like to place an order</span>
              </div>
            </div>
          )}
          {turns.map((t, i) => <TurnBubble key={i} turn={t} />)}
        </div>

        {error && (
          <div className="agent-error">
            ⚠ {error}
            <button onClick={resetSession}>×</button>
          </div>
        )}

        <div className="agent-controls">
          <div className="mic-wrap">
            <PulseRing state={state} />
            <button
              className={`mic-btn mic-${state}`}
              onClick={handleMicClick}
              disabled={isBusy}
              aria-label={isListening ? 'Stop' : 'Speak'}
            >
              {isListening ? (
                <svg width="22" height="22" viewBox="0 0 28 28" fill="currentColor" aria-hidden>
                  <rect x="7" y="7" width="14" height="14" rx="2"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 28 28" fill="none" aria-hidden>
                  <rect x="10" y="3" width="8" height="14" rx="4" stroke="currentColor" strokeWidth="2"/>
                  <path d="M5 14a9 9 0 0018 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  <line x1="14" y1="23" x2="14" y2="27" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          </div>
          <p className="mic-label">{stateLabel(state)}</p>
        </div>
      </div>

      {/* ── Toggle button ── */}
      <button
        className={`aria-toggle ${ariaOpen ? 'open' : ''}`}
        onClick={() => setAriaOpen(o => !o)}
        title={ariaOpen ? 'Hide Aria' : 'Chat with Aria'}
      >
        {ariaOpen ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        ) : (
          <>
            <svg width="18" height="18" viewBox="0 0 28 28" fill="none" aria-hidden>
              <rect x="10" y="3" width="8" height="14" rx="4" stroke="currentColor" strokeWidth="2"/>
              <path d="M5 14a9 9 0 0018 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <line x1="14" y1="23" x2="14" y2="27" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
            <span>Talk to Aria</span>
            {replyCount > 0 && <span className="toggle-badge">{replyCount}</span>}
          </>
        )}
      </button>

    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}