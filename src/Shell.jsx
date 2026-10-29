import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

const ITEMS = [
  { to: '/', label: 'New visual', end: true },
  { to: '/visuals', label: 'My visuals' },
  { to: '/palette', label: 'My palette' },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/feedback', label: 'Send feedback' },
]

export function Shell() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const menuRef = useRef(null)
  const closeRef = useRef(null)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return undefined
    closeRef.current?.focus()
    function onKey(event) {
      if (event.key === 'Escape') {
        setOpen(false)
        menuRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function closeMenu() {
    setOpen(false)
    menuRef.current?.focus()
  }

  return (
    <div className="app">
      <header className="topbar">
        <button
          ref={menuRef}
          type="button"
          className="text-button"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          Menu
        </button>
      </header>

      <div
        className={open ? 'scrim open' : 'scrim'}
        onClick={closeMenu}
        hidden={!open}
      />

      <aside
        className={open ? 'sidebar open' : 'sidebar'}
        role="dialog"
        aria-label="Menu"
        aria-modal={open}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="sidebar-header">
          <button
            ref={closeRef}
            type="button"
            className="text-button"
            onClick={closeMenu}
          >
            Close
          </button>
        </div>
        <nav className="nav" onClick={closeMenu}>
          {ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <p className="privacy">Your images stay on this device.</p>
      </aside>

      <Outlet />
    </div>
  )
}
