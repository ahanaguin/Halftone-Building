import { Link } from 'react-router-dom'

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
        <img src="/Halftone-Wordmark.png" alt="Halftone" />
      </h1>
      <Link className="button" to="/calibrate">
        New visual
      </Link>
    </main>
  )
}

export function Calibrate() {
  return (
    <Screen
      title="Calibrate"
      lede="Match your screen before you start."
      action="Continue"
      to="/upload"
      back="Back"
      backTo="/"
    />
  )
}

export function Upload() {
  return (
    <Screen
      title="Upload"
      lede="Add a photo to begin."
      action="Continue"
      to="/pick-a-style"
      back="Back"
      backTo="/calibrate"
    />
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

export function Studio() {
  return (
    <Screen
      title="Studio"
      lede="Adjust the visual here."
      action="Continue"
      to="/export"
      back="Back"
      backTo="/pick-a-style"
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
