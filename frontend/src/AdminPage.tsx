const BASE = `${import.meta.env.VITE_API_URL || ''}/api`
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import './admin.css'

type Tab = 'overview' | 'transactions' | 'leads' | 'conversations' | 'knowledge'

interface Stats {
  leads: { total: number; with_contact: number; with_name?: number }
  conversations: { total: number; sessions: number }
  transactions: { total: number; confirmed: number; fulfilled: number }
  recent_transactions: any[]
}

// ── Chart helpers ──────────────────────────────────────────────────────────

function buildDailyChart(items: any[], dateField = 'created_at') {
  const counts: Record<string, number> = {}
  items.forEach(item => {
    const d = (item[dateField] || '').slice(0, 10)
    if (d) counts[d] = (counts[d] || 0) + 1
  })
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-10)
    .map(([date, count]) => ({ date: date.slice(5), count }))
}

function buildStatusChart(items: any[]) {
  const counts: Record<string, number> = {}
  items.forEach(i => { const s = i.status || 'unknown'; counts[s] = (counts[s] || 0) + 1 })
  return Object.entries(counts).map(([name, value]) => ({ name, value }))
}

function buildRevenueChart(transactions: any[]) {
  const rev: Record<string, number> = {}
  transactions.forEach(tx => {
    const d = (tx.created_at || '').slice(0, 10)
    const total = parseFloat(tx.total_price || '0') || 0
    if (d) rev[d] = (rev[d] || 0) + total
  })
  return Object.entries(rev)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-10)
    .map(([date, revenue]) => ({ date: date.slice(5), revenue: Math.round(revenue) }))
}


function buildMonthlyTotals(transactions: any[]) {
  const monthly: Record<string, number> = {}
  transactions.forEach(tx => {
    const m = (tx.created_at || '').slice(0, 7) // "2026-05"
    const total = parseFloat(tx.total_price || '0') || 0
    if (m) monthly[m] = (monthly[m] || 0) + total
  })
  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({
      month: new Date(month + '-01').toLocaleString('default', { month: 'short', year: 'numeric' }),
      total: Math.round(total),
    }))
}

function Pagination({ page, total, pageSize, onChange }: { page: number; total: number; pageSize: number; onChange: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', fontSize: 13 }}>
      <button onClick={() => onChange(page - 1)} disabled={page === 1}
        style={{ padding: '4px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text)', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.4 : 1 }}>
        ← Prev
      </button>
      {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
        <button key={p} onClick={() => onChange(p)}
          style={{ padding: '4px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: p === page ? '#3b82f6' : 'none', color: p === page ? '#fff' : 'var(--text)', cursor: 'pointer', fontWeight: p === page ? 500 : 400 }}>
          {p}
        </button>
      ))}
      <button onClick={() => onChange(page + 1)} disabled={page === totalPages}
        style={{ padding: '4px 10px', borderRadius: 6, border: '0.5px solid var(--border)', background: 'none', color: 'var(--text)', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.4 : 1 }}>
        Next →
      </button>
      <span style={{ color: 'var(--text2)', marginLeft: 4 }}>
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
      </span>
    </div>
  )
}

const STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6', contacted: '#f59e0b', converted: '#10b981',
  closed: '#6b7280', pending: '#f59e0b', confirmed: '#10b981',
  fulfilled: '#8b5cf6', cancelled: '#ef4444',
}

const CHART_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444']

// ── Main component ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('overview')
  const [stats, setStats] = useState<Stats | null>(null)
  const [leads, setLeads] = useState<any[]>([])
  const [transactions, setTransactions] = useState<any[]>([])
  const [conversations, setConversations] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [txPage, setTxPage] = useState(1)
  const [leadsPage, setLeadsPage] = useState(1)
  const [txMonth, setTxMonth] = useState('all')
  const PAGE_SIZE = 5
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const token = sessionStorage.getItem('admin_token')
    if (!token) { navigate('/admin/login'); return }
    fetch(`/api/admin/verify?token=${encodeURIComponent(token)}`)
      .then(r => { if (!r.ok) navigate('/admin/login') })
      .catch(() => navigate('/admin/login'))
  }, [navigate])

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true); setError(null)
    try {
      const [dashRes, leadsRes, txRes, convRes] = await Promise.all([
        fetch('/api/dashboard'), fetch('/api/leads'),
        fetch('/api/transactions'), fetch('/api/conversations'),
      ])
      if (dashRes.ok) setStats(await dashRes.json())
      if (leadsRes.ok) setLeads((await leadsRes.json()).leads || [])
      if (txRes.ok) setTransactions((await txRes.json()).transactions || [])
      if (convRes.ok) setConversations((await convRes.json()).conversations || [])
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const updateStatus = async (docId: string, status: string, type: 'lead' | 'transaction') => {
    const fd = new FormData(); fd.append('status', status)
    const ep = type === 'lead'
      ? `/api/leads/${encodeURIComponent(docId)}/status`
      : `/api/transactions/${encodeURIComponent(docId)}/status`
    await fetch(ep, { method: 'PATCH', body: fd })
    loadData()
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true); setUploadMsg(null)
    const fd = new FormData(); fd.append('file', file); fd.append('knowledge_base_id', 'global')
    try {
      const res = await fetch('/api/upload-document', { method: 'POST', body: fd })
      const data = await res.json()
      setUploadMsg(res.ok ? `✓ "${data.filename}" indexed.` : `✗ ${data.detail ?? 'Failed'}`)
    } catch (e: any) { setUploadMsg(`✗ ${e.message}`) }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const handleReset = async () => {
    if (!window.confirm("Reset Aria's knowledge base? All documents will be deleted.")) return
    setResetting(true); setUploadMsg(null)
    try {
      const res = await fetch('/api/knowledge-base', { method: 'DELETE' })
      const data = await res.json()
      setUploadMsg(res.ok ? `✓ Reset done. ${data.deleted_files} file(s) removed.` : `✗ ${data.detail}`)
    } catch (e: any) { setUploadMsg(`✗ ${e.message}`) }
    finally { setResetting(false) }
  }

  const logout = () => { sessionStorage.removeItem('admin_token'); navigate('/admin/login') }

  const statusBadge = (status: string) => {
    const color = STATUS_COLORS[status] || '#6b7280'
    return (
      <span style={{
        background: `${color}22`, color,
        padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 500,
      }}>{status}</span>
    )
  }

  const totalRevenue = transactions.reduce((s, tx) => s + (parseFloat(tx.total_price || '0') || 0), 0)
  const conversion = stats && stats.leads.total > 0
    ? Math.round(((stats.transactions?.confirmed || 0) / stats.leads.total) * 100) : 0

  const dailyConvChart = buildDailyChart(conversations)
  const dailyLeadsChart = buildDailyChart(leads)
  const revenueChart = buildRevenueChart(transactions)
  const txStatusChart = buildStatusChart(transactions)
  const leadStatusChart = buildStatusChart(leads)

  return (
    <div className="admin-page">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon-sm">A</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Aria Admin</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>Sales dashboard</div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {([
            ['overview',      'ti-layout-dashboard', 'Overview'],
            ['transactions',  'ti-receipt',          'Transactions'],
            ['leads',         'ti-user-plus',        'Leads'],
            ['conversations', 'ti-message',          'Conversations'],
            ['knowledge',     'ti-database',         'Knowledge base'],
          ] as [Tab, string, string][]).map(([id, icon, label]) => (
            <button key={id} className={`nav-item ${tab === id ? 'active' : ''}`}
              onClick={() => setTab(id)}>
              <i className={`ti ${icon}`} aria-hidden style={{ fontSize: 16 }}></i>
              {label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <a href="/" className="nav-item" style={{ textDecoration: 'none' }}>
            <i className="ti ti-arrow-left" aria-hidden style={{ fontSize: 16 }}></i>
            Back to Aria
          </a>
          <button className="nav-item" onClick={logout}>
            <i className="ti ti-logout" aria-hidden style={{ fontSize: 16 }}></i>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="admin-main">
        <div className="admin-topbar">
          <h1 className="admin-page-title">
            {{ overview: 'Overview', transactions: 'Transactions', leads: 'Leads',
               conversations: 'Conversations', knowledge: 'Knowledge base' }[tab]}
          </h1>
          <div style={{ display: 'flex', gap: 8 }}>
            {tab === 'transactions' && <button className="topbar-btn" onClick={() => window.open('/api/transactions/export')}><i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden></i> Export CSV</button>}
            {tab === 'leads' && <button className="topbar-btn" onClick={() => window.open('/api/leads/export')}><i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden></i> Export CSV</button>}
            {tab === 'conversations' && <button className="topbar-btn" onClick={() => window.open('/api/conversations/export')}><i className="ti ti-download" style={{ fontSize: 14 }} aria-hidden></i> Export CSV</button>}
            <button className="topbar-btn" onClick={loadData}><i className="ti ti-refresh" style={{ fontSize: 14 }} aria-hidden></i> Refresh</button>
          </div>
        </div>

        {error && <div className="admin-error">⚠ {error}</div>}
        {loading && <div className="admin-loading">Loading…</div>}

        {!loading && (
          <>
            {/* ── OVERVIEW ── */}
            {tab === 'overview' && stats && (
              <div className="admin-content">

                {/* KPI cards */}
                <div className="stat-grid">
                  <div className="stat-card">
                    <div className="stat-label">Total revenue</div>
                    <div className="stat-value" style={{ color: '#10b981' }}>
                      ₱{totalRevenue.toLocaleString()}
                    </div>
                    <div className="stat-sub">{stats.transactions?.fulfilled || 0} fulfilled</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Orders confirmed</div>
                    <div className="stat-value" style={{ color: '#3b82f6' }}>{stats.transactions?.confirmed || 0}</div>
                    <div className="stat-sub">of {stats.transactions?.total || 0} total</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Leads captured</div>
                    <div className="stat-value">{stats.leads.total}</div>
                    <div className="stat-sub">{stats.leads.with_contact || 0} with contact</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Conversion rate</div>
                    <div className="stat-value" style={{ color: '#8b5cf6' }}>{conversion}%</div>
                    <div className="stat-sub">leads → orders</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Conversations</div>
                    <div className="stat-value">{stats.conversations.total}</div>
                    <div className="stat-sub">{stats.conversations.sessions} sessions</div>
                  </div>
                </div>

                {/* Charts row 1 */}
                <div className="charts-grid">
                  {/* Revenue over time */}
                  <div className="chart-card wide">
                    <div className="chart-title">Revenue over time (PHP)</div>
                    {revenueChart.length === 0 ? (
                      <div className="chart-empty">No revenue data yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={revenueChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--chart-axis)" />
                          <YAxis tick={{ fontSize: 11 }} stroke="var(--chart-axis)" />
                          <Tooltip
                            contentStyle={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any) => [`₱${Number(v).toLocaleString()}`, 'Revenue']}
                          />
                          <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* Transaction status pie */}
                  <div className="chart-card">
                    <div className="chart-title">Order status</div>
                    {txStatusChart.length === 0 ? (
                      <div className="chart-empty">No orders yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={txStatusChart} dataKey="value" nameKey="name"
                            cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) =>
                              `${name} ${(percent * 100).toFixed(0)}%`}
                            labelLine={false}
                          >
                            {txStatusChart.map((entry, i) => (
                              <Cell key={i} fill={STATUS_COLORS[entry.name] || CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Charts row 2 */}
                <div className="charts-grid">
                  {/* Daily conversations */}
                  <div className="chart-card">
                    <div className="chart-title">Daily conversations</div>
                    {dailyConvChart.length === 0 ? (
                      <div className="chart-empty">No data yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={dailyConvChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--chart-axis)" />
                          <YAxis tick={{ fontSize: 11 }} stroke="var(--chart-axis)" allowDecimals={false} />
                          <Tooltip contentStyle={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                          <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Conversations" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* Daily leads */}
                  <div className="chart-card">
                    <div className="chart-title">Daily leads captured</div>
                    {dailyLeadsChart.length === 0 ? (
                      <div className="chart-empty">No leads yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={dailyLeadsChart}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                          <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="var(--chart-axis)" />
                          <YAxis tick={{ fontSize: 11 }} stroke="var(--chart-axis)" allowDecimals={false} />
                          <Tooltip contentStyle={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                          <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Leads" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>

                  {/* Lead status pie */}
                  <div className="chart-card">
                    <div className="chart-title">Lead pipeline</div>
                    {leadStatusChart.length === 0 ? (
                      <div className="chart-empty">No leads yet</div>
                    ) : (
                      <ResponsiveContainer width="100%" height={180}>
                        <PieChart>
                          <Pie data={leadStatusChart} dataKey="value" nameKey="name"
                            cx="50%" cy="50%" outerRadius={65}
                            label={({ name, value }) => `${name} (${value})`}
                            labelLine={false}
                          >
                            {leadStatusChart.map((entry, i) => (
                              <Cell key={i} fill={STATUS_COLORS[entry.name] || CHART_COLORS[i % CHART_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={{ background: 'var(--bg)', border: '0.5px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                {/* Recent transactions table */}
                <h3 className="section-title" style={{ marginTop: 8 }}>Recent transactions</h3>
                {(stats.recent_transactions || []).length === 0 ? (
                  <p className="empty-msg">No transactions yet.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr>
                        <th>Date</th><th>Name</th><th>Contact</th>
                        <th>Product</th><th>Total</th><th>Status</th>
                      </tr></thead>
                      <tbody>
                        {stats.recent_transactions.map((tx: any, i: number) => (
                          <tr key={i}>
                            <td>{tx.created_at}</td>
                            <td>{tx.name || '—'}</td>
                            <td>{tx.contact || '—'}</td>
                            <td>{tx.product || '—'}</td>
                            <td style={{ fontWeight: 500 }}>
                              {tx.total_price ? `${tx.currency || 'PHP'} ${tx.total_price}` : '—'}
                            </td>
                            <td>{statusBadge(tx.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ── TRANSACTIONS ── */}
            {tab === 'transactions' && (() => {
              const monthlyTotals = buildMonthlyTotals(transactions)
              const monthKeys = [...new Set(transactions.map(tx => (tx.created_at || '').slice(0, 7)).filter(Boolean))].sort()
              const filteredTx = txMonth === 'all' ? transactions : transactions.filter(tx => (tx.created_at || '').startsWith(txMonth))
              const filteredRevenue = filteredTx.reduce((s, tx) => s + (parseFloat(tx.total_price || '0') || 0), 0)
              const pagedTx = filteredTx.slice((txPage - 1) * PAGE_SIZE, txPage * PAGE_SIZE)
              return (
                <div className="admin-content">
                  {/* Monthly totals */}
                  {monthlyTotals.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <h3 className="section-title">Monthly sales</h3>
                      <div className="monthly-grid">
                        {monthlyTotals.map((m, i) => (
                          <div key={i}
                            className={`monthly-card ${monthKeys[i] === txMonth ? 'monthly-selected' : ''}`}
                            style={{ cursor: 'pointer' }}
                            onClick={() => { setTxMonth(monthKeys[i] === txMonth ? 'all' : monthKeys[i]); setTxPage(1) }}
                          >
                            <div className="monthly-month">{m.month}</div>
                            <div className="monthly-total">₱{m.total.toLocaleString()}</div>
                          </div>
                        ))}
                        <div
                          className={`monthly-card total-card ${txMonth === 'all' ? 'monthly-selected' : ''}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => { setTxMonth('all'); setTxPage(1) }}
                        >
                          <div className="monthly-month">All time</div>
                          <div className="monthly-total" style={{ color: '#10b981' }}>₱{totalRevenue.toLocaleString()}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <p className="section-count">
                      {filteredTx.length} transaction{filteredTx.length !== 1 ? 's' : ''}
                      {txMonth !== 'all' && ` · ${new Date(txMonth + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}`}
                      {' · '}Total: ₱{filteredRevenue.toLocaleString()}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <label style={{ fontSize: 12, color: 'var(--text2)' }}>Month:</label>
                      <select className="status-select" value={txMonth}
                        onChange={e => { setTxMonth(e.target.value); setTxPage(1) }}
                        style={{ padding: '5px 10px' }}>
                        <option value="all">All time</option>
                        {monthKeys.map(mk => (
                          <option key={mk} value={mk}>
                            {new Date(mk + '-01').toLocaleString('default', { month: 'long', year: 'numeric' })}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {transactions.length === 0 ? <p className="empty-msg">No transactions yet.</p> : (
                    <>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead><tr>
                            <th>Date</th><th>Name</th><th>Contact</th><th>Product</th>
                            <th>Description</th><th>Qty</th><th>Unit</th>
                            <th>Unit Price</th><th>Total</th><th>Status</th><th>Update</th>
                          </tr></thead>
                          <tbody>
                            {pagedTx.map((tx, i) => (
                              <tr key={i}>
                                <td>{tx.created_at}</td>
                                <td>{tx.name || '—'}</td>
                                <td>{tx.contact || '—'}</td>
                                <td>{tx.product || '—'}</td>
                                <td style={{ maxWidth: 160, fontSize: 12 }}>{tx.description?.slice(0, 55)}{tx.description?.length > 55 ? '…' : ''}</td>
                                <td>{tx.quantity || '—'}</td>
                                <td>{tx.unit || '—'}</td>
                                <td>{tx.unit_price ? `${tx.currency || 'PHP'} ${tx.unit_price}` : '—'}</td>
                                <td style={{ fontWeight: 500 }}>{tx.total_price ? `${tx.currency || 'PHP'} ${tx.total_price}` : '—'}</td>
                                <td>{statusBadge(tx.status)}</td>
                                <td>
                                  <select className="status-select" value={tx.status}
                                    onChange={e => updateStatus(tx.doc_id, e.target.value, 'transaction')}>
                                    <option value="pending">Pending</option>
                                    <option value="confirmed">Confirmed</option>
                                    <option value="fulfilled">Fulfilled</option>
                                    <option value="cancelled">Cancelled</option>
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination page={txPage} total={filteredTx.length} pageSize={PAGE_SIZE} onChange={p => setTxPage(p)} />
                    </>
                  )}
                </div>
              )
            })()}

            {/* ── LEADS ── */}
            {tab === 'leads' && (
              <div className="admin-content">
                <p className="section-count">{leads.length} leads</p>
                {leads.length === 0 ? <p className="empty-msg">No leads yet.</p> : (() => {
                  const pagedLeads = leads.slice((leadsPage - 1) * PAGE_SIZE, leadsPage * PAGE_SIZE)
                  return (
                    <>
                      <div className="table-wrap">
                        <table className="data-table">
                          <thead><tr>
                            <th>Date</th><th>Name</th><th>Contact</th>
                            <th>Message</th><th>Status</th><th>Update</th>
                          </tr></thead>
                          <tbody>
                            {pagedLeads.map((lead, i) => (
                              <tr key={i}>
                                <td>{lead.created_at}</td>
                                <td>{lead.name || '—'}</td>
                                <td>{lead.contact || '—'}</td>
                                <td style={{ maxWidth: 200, fontSize: 12 }}>{lead.user_message?.slice(0, 70)}…</td>
                                <td>{statusBadge(lead.status)}</td>
                                <td>
                                  <select className="status-select" value={lead.status}
                                    onChange={e => updateStatus(lead.doc_id, e.target.value, 'lead')}>
                                    <option value="new">New</option>
                                    <option value="contacted">Contacted</option>
                                    <option value="converted">Converted</option>
                                    <option value="closed">Closed</option>
                                  </select>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <Pagination page={leadsPage} total={leads.length} pageSize={PAGE_SIZE} onChange={p => setLeadsPage(p)} />
                    </>
                  )
                })()}
              </div>
            )}

            {/* ── CONVERSATIONS ── */}
            {tab === 'conversations' && (
              <div className="admin-content">
                <p className="section-count">{conversations.length} turns</p>
                {conversations.length === 0 ? <p className="empty-msg">No conversations yet.</p> : (
                  <div className="conv-list">
                    {conversations.map((conv, i) => (
                      <div key={i} className="conv-card">
                        <div className="conv-meta">{conv.created_at} · session {conv.session_id?.slice(0, 8)}…</div>
                        <div className="conv-user">
                          <span className="conv-role">Customer</span>{conv.user_message}
                        </div>
                        <div className="conv-ai">
                          <span className="conv-role aria">Aria</span>{conv.ai_reply}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── KNOWLEDGE BASE ── */}
            {tab === 'knowledge' && (
              <div className="admin-content">
                <div className="kb-section">
                  <h3 className="section-title">Upload documents</h3>
                  <p className="kb-desc">Upload your product catalog, price list, or any sales document (PDF or TXT). Aria will use this as her knowledge base.</p>
                  <input ref={fileRef} type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={handleUpload} />
                  <div className="kb-actions">
                    <button className="kb-btn primary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                      <i className="ti ti-upload" aria-hidden style={{ fontSize: 15 }}></i>
                      {uploading ? 'Uploading…' : 'Upload document'}
                    </button>
                    <button className="kb-btn danger" onClick={handleReset} disabled={resetting}>
                      <i className="ti ti-trash" aria-hidden style={{ fontSize: 15 }}></i>
                      {resetting ? 'Resetting…' : 'Reset knowledge base'}
                    </button>
                  </div>
                  {uploadMsg && (
                    <div className={`kb-msg ${uploadMsg.startsWith('✓') ? 'ok' : 'err'}`}>{uploadMsg}</div>
                  )}
                  <div className="kb-info">
                    <div className="kb-info-title">How it works</div>
                    {[
                      'Upload a PDF or TXT with your products, prices, and descriptions',
                      'OpenAI automatically extracts, chunks, and indexes the content',
                      'Aria uses this knowledge to answer customer questions accurately',
                      'Use "Reset knowledge base" to clear all files and upload a new catalog',
                    ].map((s, i) => (
                      <div key={i} className="kb-info-row">
                        <span className="kb-step">{i + 1}</span><span>{s}</span>
                      </div>
                    ))}
                  </div>
                  <div className="kb-formats">
                    <div className="kb-format-title">Supported formats</div>
                    <div className="kb-format-row"><span className="kb-badge">PDF</span><span>Product catalogs, price lists, brochures</span></div>
                    <div className="kb-format-row"><span className="kb-badge">TXT</span><span>Plain text product lists, FAQs, scripts</span></div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
