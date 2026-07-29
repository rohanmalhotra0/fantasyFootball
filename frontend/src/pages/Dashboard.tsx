import { useEffect, useState } from 'react'

export default function Dashboard() {
  const [health, setHealth] = useState<string>('checking…')

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((b) => setHealth(b.status === 'ok' ? 'connected' : 'error'))
      .catch(() => setHealth('backend offline'))
  }, [])

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">DraftEngine</h1>
      <div className="card max-w-md">
        <h2 className="text-xl font-bold">Backend</h2>
        <p className="mt-2" data-testid="health-status">
          {health}
        </p>
      </div>
    </div>
  )
}
