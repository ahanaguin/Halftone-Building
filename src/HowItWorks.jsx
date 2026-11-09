import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

function LoopVideo({ src, poster, className }) {
  const ref = useRef(null)

  useEffect(() => {
    const video = ref.current
    if (!video) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined
    const play = video.play()
    if (play) play.catch(() => {})
    return () => video.pause()
  }, [])

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
    />
  )
}

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

function UploadStill() {
  return (
    <div className="guide-still guide-still-upload" aria-hidden="true">
      <svg viewBox="0 0 640 280" role="presentation">
        <rect x="24" y="36" width="108" height="168" rx="10" fill="#1c2a28" />
        <rect x="140" y="68" width="92" height="136" rx="10" fill="#2a2430" />
        <rect x="240" y="28" width="150" height="176" rx="10" fill="#3a221c" />
        <rect x="398" y="84" width="96" height="120" rx="10" fill="#1c2a28" />
        <rect x="502" y="56" width="114" height="148" rx="10" fill="#22242c" />
        <path
          d="M24 148 C70 128 96 176 140 152 C176 132 214 188 264 120 C310 64 350 200 398 156 C436 126 470 176 520 140 C560 116 590 164 616 148"
          fill="none"
          stroke="#f2f0eb"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <text x="78" y="228" textAnchor="middle" fill="#9a9894" fontSize="13">
          Intro
        </text>
        <text x="186" y="228" textAnchor="middle" fill="#9a9894" fontSize="13">
          Build
        </text>
        <text x="315" y="228" textAnchor="middle" fill="#9a9894" fontSize="13">
          Drop
        </text>
        <text x="446" y="228" textAnchor="middle" fill="#9a9894" fontSize="13">
          Quiet
        </text>
        <text x="559" y="228" textAnchor="middle" fill="#9a9894" fontSize="13">
          Outro
        </text>
      </svg>
    </div>
  )
}

function StyleStill() {
  return (
    <div className="guide-style-grid" aria-hidden="true">
      <LoopVideo src="/style-previews/liquid.mp4?v=3" poster="/style-previews/liquid.jpg?v=3" />
      <LoopVideo src="/style-previews/image.mp4?v=2" poster="/style-previews/image.jpg?v=2" />
      <LoopVideo src="/style-previews/bloom.mp4?v=6" poster="/style-previews/bloom.jpg?v=6" />
      <LoopVideo src="/style-previews/orb.mp4?v=6" poster="/style-previews/orb.jpg?v=6" />
    </div>
  )
}

function ExportStill() {
  return (
    <div className="guide-export" aria-hidden="true">
      <figure className="guide-frame is-tall">
        <img src="/style-previews/liquid.jpg?v=3" alt="" />
        <figcaption>Canvas</figcaption>
      </figure>
      <figure className="guide-frame is-square">
        <img src="/style-previews/bloom.jpg?v=6" alt="" />
        <figcaption>Cover</figcaption>
      </figure>
      <figure className="guide-frame is-wide">
        <img src="/style-previews/orb.jpg?v=6" alt="" />
        <figcaption>Visualizer</figcaption>
      </figure>
    </div>
  )
}

function HearingGraphic() {
  return (
    <figure className="guide-hearing">
      <svg viewBox="0 0 720 280" role="img" aria-labelledby="guide-hearing-title">
        <title id="guide-hearing-title">How Halftone reads a song</title>
        <rect x="0" y="0" width="720" height="280" rx="16" fill="#121212" />
        <rect x="36" y="46" width="86" height="148" rx="8" fill="#1b2624" />
        <rect x="126" y="70" width="70" height="124" rx="8" fill="#26222c" />
        <rect x="200" y="28" width="128" height="166" rx="8" fill="#34221c" />
        <rect x="332" y="58" width="118" height="136" rx="8" fill="#1b2624" />
        <rect x="454" y="40" width="96" height="154" rx="8" fill="#26222c" />
        <rect x="554" y="78" width="130" height="116" rx="8" fill="#1d2228" />
        <path
          d="M36 160 C70 132 100 188 140 150 C176 118 210 196 264 96 C304 40 340 210 398 142 C436 96 470 188 520 128 C560 84 600 176 684 150"
          fill="none"
          stroke="#f2f0eb"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <path
          d="M36 186 C80 176 120 198 168 180 C220 160 270 200 332 176 C390 154 450 196 520 170 C580 148 630 184 684 168"
          fill="none"
          stroke="#2eb5a8"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.9"
        />
        {[96, 168, 248, 332, 412, 492, 572, 644].map((x) => (
          <line key={x} x1={x} y1="204" x2={x} y2="214" stroke="#f2f0eb" strokeWidth="2" />
        ))}
        <text x="79" y="238" textAnchor="middle" fill="#9a9894" fontSize="12">
          Intro
        </text>
        <text x="264" y="238" textAnchor="middle" fill="#9a9894" fontSize="12">
          Drop
        </text>
        <text x="391" y="238" textAnchor="middle" fill="#9a9894" fontSize="12">
          Quiet
        </text>
        <text x="619" y="238" textAnchor="middle" fill="#9a9894" fontSize="12">
          Outro
        </text>
        <text x="36" y="22" fill="#f2f0eb" fontSize="12">
          Loudness
        </text>
        <text x="118" y="22" fill="#2eb5a8" fontSize="12">
          Bass
        </text>
        <text x="560" y="22" fill="#9a9894" fontSize="12">
          Beats · Tempo · Sections
        </text>
      </svg>
      <figcaption>
        Loudness and bass shape size and movement. Tempo sets the speed. Beats trigger moments. Section changes shift
        the whole visual.
      </figcaption>
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
  if (kind === 'upload') return <UploadStill />
  if (kind === 'style') return <StyleStill />
  if (kind === 'studio') {
    return (
      <div className="guide-still">
        <LoopVideo src="/style-previews/liquid.mp4?v=3" poster="/style-previews/liquid.jpg?v=3" />
      </div>
    )
  }
  if (kind === 'export') return <ExportStill />
  return null
}

export function HowItWorks() {
  return (
    <main className="screen-guide">
      <div className="screen-guide-inner">
        <header className="guide-intro">
          <h1>How Halftone works</h1>
          <p className="lede">
            Halftone listens to your song and turns it into visuals in your own colors and style. You stay in control of
            every part.
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
          <p>Halftone reads the music on your device. It does not guess a mood with AI.</p>
          <HearingGraphic />
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
