import { Link } from 'react-router-dom'
import { hasCalibration } from './calibrate.js'
import { loadVisuals } from './visuals.js'
import { Wordmark } from './Wordmark.jsx'

function Screen({ title, lede, action, to, back, backTo }) {
  return (
    <main className="screen">
      <div className="screen-inner">
        <h1>{title}</h1>
        <p className="lede">{lede}</p>
        <div className="actions">
          <Link className="button" to={to}>
            {action}
          </Link>
          {back ? (
            <Link className="text-link" to={backTo}>
              {back}
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  )
}

export const RIGHTS_NOTE =
  "Only upload music and images you own or have permission to use. You're responsible for what you create and share with Halftone."

export function Landing() {
  return (
    <main className="screen screen-landing">
      <h1 className="wordmark-title">
        <Wordmark />
      </h1>
      <p className="landing-note">
        Halftone is a free tool for independent musicians that turns your songs into animated visualizers, Spotify
        Canvas loops, and cover art, using colors and styles you choose.
      </p>
      <Link className="button" to={hasCalibration() ? '/upload' : '/calibrate'}>
        New visual
      </Link>
      <p className="rights-note">{RIGHTS_NOTE}</p>
    </main>
  )
}

export function PickStyle() {
  return (
    <Screen
      title="Pick a style"
      lede="Choose a look for this visual."
      action="Continue"
      to="/studio"
      back="Back"
      backTo="/upload"
    />
  )
}

export function MyVisuals() {
  const visuals = loadVisuals()
  return (
    <main className="screen">
      <div className="screen-inner visuals">
        <h1>My visuals</h1>
        {visuals.length ? (
          <ul className="visual-list">
            {visuals.map((item) => (
              <li key={item.id}>
                <strong>{item.fileName}</strong>
                <span>{item.style}</span>
                <time dateTime={new Date(item.createdAt).toISOString()}>
                  {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="lede">Nothing here yet.</p>
        )}
        <Link className="button" to="/">
          New visual
        </Link>
      </div>
    </main>
  )
}

export function MyPalette() {
  return (
    <main className="screen">
      <div className="screen-inner">
        <h1>My palette</h1>
        <p className="lede">Saved colors will show up here.</p>
      </div>
    </main>
  )
}

export function HowItWorks() {
  return (
    <main className="screen">
      <div className="screen-inner">
        <h1>How it works</h1>
        <p className="lede">A short guide will live here.</p>
      </div>
    </main>
  )
}

export function SendFeedback() {
  return (
    <main className="screen">
      <div className="screen-inner">
        <h1>Send feedback</h1>
        <p className="lede">Share what would make this better.</p>
      </div>
    </main>
  )
}
