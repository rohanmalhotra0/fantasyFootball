import { NavLink, Route, Routes } from 'react-router-dom'
import { STATIC_MODE } from './lib/api'
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
      <pre className="rounded-xl bg-slate-100 p-4 text-left text-base">
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

export default function App() {
  return (
    <div className="min-h-screen">
      <nav aria-label="Main" className="border-b-2 border-slate-200 bg-white">
        <ul className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2 whitespace-nowrap border-b-4 px-4 py-4 text-lg font-bold ${
                    isActive
                      ? 'border-blue-700 text-blue-800'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
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
      {STATIC_MODE && (
        <p
          role="note"
          className="border-b-2 border-amber-300 bg-amber-100 px-4 py-2 text-center font-bold text-amber-900"
        >
          📖 Read-only demo — data is a snapshot; edits and drafting are off
        </p>
      )}
      <main className="mx-auto max-w-7xl px-4 py-8">
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
