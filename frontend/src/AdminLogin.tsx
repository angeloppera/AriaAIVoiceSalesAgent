const BASE = `${import.meta.env.VITE_API_URL || ''}/api`
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './admin.css'


export default function AdminLogin() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('password', password)
      const res = await fetch('/api/admin/login', { method: 'POST', body: fd })
      if (res.ok) {
        const data = await res.json()
        sessionStorage.setItem('admin_token', data.token)
        navigate('/admin')
      } else {
        setError('Incorrect password. Please try again.')
      }
    } catch {
      setError('Could not connect to server.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <svg width="28" height="28" viewBox="0 0 22 22" fill="none" aria-hidden>
            <circle cx="11" cy="11" r="10" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M7 11 Q9 7 11 11 Q13 15 15 11" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" fill="none"/>
          </svg>
        </div>
        <h1 className="login-title">Aria Admin</h1>
        <p className="login-sub">Sales dashboard & knowledge base</p>

        <form onSubmit={handleLogin} className="login-form">
          <input
            type="password"
            placeholder="Enter admin password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            required
          />
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="login-btn" disabled={loading}>
            {loading ? 'Verifying…' : 'Sign in'}
          </button>
        </form>

        <a href="/" className="login-back">← Back to Aria</a>
      </div>
    </div>
  )
}
