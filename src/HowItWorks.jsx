import { Link } from 'react-router-dom'

function CalibrateStill() {
  return (
    <div className="guide-still guide-still-calibrate" aria-hidden="true">
      <span className="guide-play" />
      <div className="guide-dots">
        <span style={{ background: '#e24a3b' }} />
        <span style={{ background: '#e6a33a' }} />
        <span className="is-on" style={{ background: '#2eb5a8' }} />
        <span style={{ background: '#3a96d6' }} />
        <span style={{ background: '#3cba62' }} />
      </div>
      <div className="guide-pills">
        <span className="is-on">Round</span>
        <span>In between</span>
        <span>Spiky</span>
      </div>
    </div>
  )
}

function PageShot({ src }) {
  return (
    <figure className="guide-shot" aria-hidden="true">
      <img src={src} alt="" width="1280" height="900" />
    </figure>
  )
}

const STEPS = [
  {
    title: 'Calibrate',
    body: 'Pick a color, shape, and texture for short sounds. This becomes your palette.',
    media: 'calibrate',
  },
  {
    title: 'Upload',
    body: 'Add your track. Halftone finds its sections, like the intro, builds, drops, and quiet parts.',
    media: 'upload',
  },
  {
    title: 'Pick a style',
    body: 'Liquid, Image animation, Bloom, or Orb.',
    media: 'style',
  },
  {
    title: 'Studio',
    body: 'Edit everything section by section: colors, sizes, composition, background. Rename, resize, split, or merge sections.',
    media: 'studio',
  },
  {
    title: 'Export',
    body: 'Download a Canvas loop, cover art, or a full visualizer.',
    media: 'export',
  },
]

const GLOSSARY = [
  { term: 'Intro', meaning: 'The opening, usually quieter as the song begins.' },
  { term: 'Quiet', meaning: 'A calmer stretch that holds one still poster.' },
  { term: 'Build', meaning: 'Energy is rising, so the picture starts to open up.' },
  { term: 'Main', meaning: 'The core of the song, often the hook.' },
  { term: 'High', meaning: 'A loud, full part.' },
  { term: 'Drop', meaning: 'A sudden cut into a new burst of energy.' },
  { term: 'Break', meaning: 'A pause or thinner moment between louder parts.' },
  { term: 'Outro', meaning: 'The close of the song, usually winding down.' },
]

const FAQ = [
  {
    q: 'What file types work?',
    a: 'MP3 and WAV, up to 10 minutes. Analysis happens on your device.',
  },
  {
    q: 'Where are my visuals saved?',
    a: 'In this browser only. Halftone does not upload your projects to a server.',
  },
  {
    q: 'What export sizes are there?',
    a: 'Canvas loop 1080×1920, cover 3000×3000, and visualizer 1920×1080.',
  },
  {
    q: 'Which browsers work best?',
    a: 'Desktop Chrome or Safari, at a wide window.',
  },
  {
    q: 'Can I use any song or image?',
    a: 'Only ones you own or have permission to use. You are responsible for what you create and share.',
  },
]

function StepMedia({ kind }) {
  if (kind === 'calibrate') return <CalibrateStill />
  if (kind === 'upload') return <PageShot src="/guide/upload.png" />
  if (kind === 'style') return <PageShot src="/guide/style.png" />
  if (kind === 'studio') return <PageShot src="/guide/studio.png" />
  if (kind === 'export') return <PageShot src="/guide/export.png" />
  return null
}

export function HowItWorks() {
  return (
    <main className="screen-guide">
      <div className="screen-guide-inner">
        <header className="guide-intro">
          <h1>How Halftone works</h1>
          <p className="lede">
            Halftone listens to your song and uses your own colors and style to create a visual.
          </p>
        </header>

        <ol className="guide-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="guide-step">
              <div className="guide-step-copy">
                <p className="guide-step-num">{index + 1}</p>
                <h2>{step.title}</h2>
                <p>{step.body}</p>
              </div>
              <div className="guide-step-media">
                <StepMedia kind={step.media} />
              </div>
            </li>
          ))}
        </ol>

        <section className="guide-section">
          <h2>How it hears your song</h2>
          <p>
            Halftone reads the music on your device. It does not guess a mood with AI. Loudness and bass shape size and
            movement. Tempo sets the speed. Beats trigger moments. Section changes shift the whole visual.
          </p>
          <h3>Section labels</h3>
          <dl className="guide-glossary">
            {GLOSSARY.map((item) => (
              <div key={item.term}>
                <dt>{item.term}</dt>
                <dd>{item.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="guide-section">
          <h2>No AI, and your music stays yours</h2>
          <p>Halftone uses no generative AI. Every visual is drawn by code from your choices and your music.</p>
          <p>Your audio and images never leave your device. Analysis, editing, and exports all happen in your browser.</p>
          <p>
            That matters because musicians like to stay in the loop. You keep control of the process, and you can be
            creative and have fun with your art — the visual comes from your choices, not a model.
          </p>
        </section>

        <section className="guide-section">
          <h2>FAQ</h2>
          <div className="guide-faq">
            {FAQ.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="guide-footer">
          Questions or ideas? <Link to="/feedback">Send feedback</Link>
        </p>
      </div>
    </main>
  )
}
