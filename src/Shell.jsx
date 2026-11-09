import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useIntroLock } from './StepIntro.jsx'
import { useTrack } from './track.jsx'
import { useVisualSession } from './visualSession.jsx'
import { Wordmark } from './Wordmark.jsx'

const PRIMARY = [
  { to: '/', label: 'New visual', end: true },
  { to: '/visuals', label: 'My visuals' },
  { to: '/palette', label: 'My palette' },
]

const SECONDARY = [
  { to: '/how-it-works', label: 'How it works' },
  { to: '/feedback', label: 'Send feedback' },
]

function Hamburger() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function Caret() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M14.5 6.5 8.5 12l6 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function NavItems({ items, onNewVisual }) {
  return items.map((item) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => (isActive ? 'active' : undefined)}
      onClick={item.to === '/' ? onNewVisual : undefined}
    >
      {item.label}
    </NavLink>
  ))
}

export function Shell() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const { track, calibrateChrome, skipCalibration } = useTrack()
  const { status: saveStatus, beginNewVisual } = useVisualSession()
  const introLock = useIntroLock()
  const studio = location.pathname === '/studio'
  const exportPage = location.pathname === '/export'
  const menuRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function closeMenu() {
    setOpen(false)
  }

  return (
    <div className="app">
      <aside
        className={open ? 'sidebar open' : 'sidebar'}
        aria-label="Menu"
        aria-hidden={!open}
        inert={!open}
      >
        <div className="sidebar-panel">
          <div className="sidebar-header">
            <button
              ref={closeRef}
              type="button"
              className="icon-button"
              aria-label="Close"
              onClick={closeMenu}
            >
              <Caret />
            </button>
          </div>
          <nav className="nav" onClick={closeMenu}>
            <NavItems items={PRIMARY} onNewVisual={beginNewVisual} />
          </nav>
          <div className="sidebar-bottom">
            <nav className="nav nav-bottom" onClick={closeMenu}>
              <NavItems items={SECONDARY} />
            </nav>
            <p className="privacy">
              Your audio and images stay on this device. Halftone doesn't check ownership of uploaded files.
            </p>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className={open ? 'topbar topbar-drawer' : 'topbar'}>
          <div className="topbar-brand">
            {open ? null : (
              <button
                ref={menuRef}
                type="button"
                className="icon-button"
                aria-label="Menu"
                aria-expanded={false}
                onClick={() => setOpen(true)}
              >
                <Hamburger />
              </button>
            )}
            <Link to="/" className="topbar-logo">
              <Wordmark className="topbar-mark" />
            </Link>
          </div>
          {introLock ? null : studio ? <p className="topbar-track">{track?.fileName ?? 'No track yet'}</p> : null}
          {introLock ? null : calibrateChrome ? (
            <div className="cal-meter">
              <span>{calibrateChrome.label}</span>
              <span className="cal-meter-track" aria-hidden="true">
                <span style={{ width: `${calibrateChrome.progress * 100}%` }} />
              </span>
            </div>
          ) : null}
          {introLock ? null : studio ? (
            <div className="studio-actions">
              {saveStatus === 'saved' ? <span className="save-indicator">Saved</span> : null}
              <Link to="/pick-a-style" className="text-link back-styles">
                {'< Back to styles'}
              </Link>
              <Link to="/export" className="button header-button">
                Export
              </Link>
            </div>
          ) : calibrateChrome ? (
            <button type="button" className="text-link cal-skip" onClick={skipCalibration}>
              Skip calibration &gt;
            </button>
          ) : exportPage || location.pathname === '/pick-a-style' ? (
            <p className="topbar-status">{track?.fileName ?? 'No track yet'}</p>
          ) : location.pathname === '/upload' ? (
            <p className="topbar-status">Palette saved</p>
          ) : null}
        </header>
        <Outlet />
      </div>
    </div>
  )
}
