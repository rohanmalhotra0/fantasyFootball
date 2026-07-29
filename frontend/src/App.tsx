import { NavLink, Route, Routes } from 'react-router-dom'
import Admin from './pages/Admin'
import Backtest from './pages/Backtest'
import Dashboard from './pages/Dashboard'
import DraftRoom from './pages/DraftRoom'
import Rankings from './pages/Rankings'
import Settings from './pages/Settings'

const NAV = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/backtest', label: 'Backtests', icon: '📈' },
  { to: '/rankings', label: 'Big Board', icon: '🏈' },
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
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/backtest" element={<Backtest />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/draft" element={<DraftRoom />} />
          <Route path="/draft/:draftId" element={<DraftRoom />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </div>
  )
}
