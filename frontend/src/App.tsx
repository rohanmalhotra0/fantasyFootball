import { NavLink, Route, Routes } from 'react-router-dom'
import { STATIC_MODE } from './lib/api'
import { useTheme } from './lib/theme'
import Admin from './pages/Admin'
import Backtest from './pages/Backtest'
import Dashboard from './pages/Dashboard'
import DraftRoom from './pages/DraftRoom'
import Insights from './pages/Insights'
import Rankings from './pages/Rankings'
import Settings from './pages/Settings'

function StaticDraftNotice() {
  return (
    <div className="card mx-auto max-w-xl space-y-4 text-center">
      <h1 className="text-2xl font-bold">🎯 Draft Room needs the live backend</h1>
      <p>
        This is the read-only demo site. The live draft room (picks, voice
        mode, real-time sync) runs on your machine:
      </p>
      <pre className="overflow-x-auto rounded-xl bg-raised p-4 text-left text-base">
        git clone && make setup && make data && make dev
      </pre>
      <p>Then open localhost:5173 and everything here works for real.</p>
    </div>
  )
}

const NAV = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/backtest', label: 'Backtests', icon: '📈' },
  { to: '/rankings', label: 'Big Board', icon: '🏈' },
  { to: '/insights', label: 'Insights', icon: '🔬' },
  { to: '/settings', label: 'League', icon: '⚙️' },
  { to: '/draft', label: 'Draft Room', icon: '🎯' },
  { to: '/admin', label: 'Data', icon: '🗄️' },
]

function ThemeToggle() {
  const [theme, toggle] = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      aria-pressed={dark}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="btn-secondary px-3 py-2 text-base"
    >
      <span aria-hidden="true">{dark ? '☀️' : '🌙'}</span>
      {dark ? 'Light' : 'Dark'}
    </button>
  )
}

export default function App() {
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-accent focus:px-4 focus:py-2 focus:font-bold focus:text-bg"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-edge/60 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4">
          <NavLink to="/" className="flex shrink-0 items-center gap-2 py-3" aria-label="DraftEngine home">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-2 font-display text-lg font-bold text-bg shadow-glow-sm"
            >
              DE
            </span>
            <span className="hidden font-display text-xl font-bold tracking-tight sm:block">
              Draft<span className="text-accent">Engine</span>
            </span>
          </NavLink>
          <nav aria-label="Main" className="min-w-0 flex-1">
            <ul className="flex gap-1 overflow-x-auto">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-base font-bold transition-colors ${
                        isActive
                          ? 'bg-accent/15 text-accent shadow-glow-sm'
                          : 'text-ink-2 hover:bg-raised/70 hover:text-ink'
                      }`
                    }
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      {STATIC_MODE && (
        <p
          role="note"
          className="border-b border-warn/40 bg-warn/15 px-4 py-2 text-center font-bold text-warn"
        >
          📖 Read-only demo — data is a snapshot; edits and drafting are off
        </p>
      )}
      <main id="main" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-8 outline-none">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/draft" element={STATIC_MODE ? <StaticDraftNotice /> : <DraftRoom />} />
          <Route
            path="/draft/:draftId"
            element={STATIC_MODE ? <StaticDraftNotice /> : <DraftRoom />}
          />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </div>
  )
}
