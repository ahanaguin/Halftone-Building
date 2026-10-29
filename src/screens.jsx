import { Link } from 'react-router-dom'
import { hasCalibration } from './calibrate.js'
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

export function Export() {
  return (
    <Screen
      title="Export"
      lede="Save or share this visual."
      action="View my visuals"
      to="/visuals"
      back="Back"
      backTo="/studio"
    />
  )
}

export function MyVisuals() {
  return (
    <Screen
      title="My visuals"
      lede="Nothing here yet."
      action="New visual"
      to="/"
    />
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
