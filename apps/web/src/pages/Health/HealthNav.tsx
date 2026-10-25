import { useLocation } from 'preact-iso'

import './health.css'

export const HEALTH_TABS = [
  { href: '/', label: 'Overview' },
  { href: '/health/recovery', label: 'Recovery' },
  { href: '/sleep', label: 'Sleep' },
  { href: '/health/activity', label: 'Activity' },
  { href: '/health/stress', label: 'Stress' },
  { href: '/health/heart', label: 'Heart' },
  { href: '/health/lifestyle', label: 'Lifestyle' },
] as const

export function HealthNav() {
  const { path } = useLocation()
  return (
    <nav class="health-nav" aria-label="Health sections">
      {HEALTH_TABS.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          class="health-nav-tab"
          aria-current={path === tab.href ? 'page' : undefined}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  )
}
