import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  FADE_MS,
  FILL_MS,
  STEP_INTROS,
  markIntroSeen,
  shouldShowStepIntro,
} from './stepIntro.js'

const IntroLockContext = createContext(false)
const SetIntroLockContext = createContext(() => {})

export function IntroLockProvider({ children }) {
  const [lock, setLock] = useState(false)
  return (
    <SetIntroLockContext.Provider value={setLock}>
      <IntroLockContext.Provider value={lock}>{children}</IntroLockContext.Provider>
    </SetIntroLockContext.Provider>
  )
}

export function useIntroLock() {
  return useContext(IntroLockContext)
}

export function useSetIntroLock() {
  return useContext(SetIntroLockContext)
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function StepIntro({ id, replay = false, onFinished }) {
  const step = STEP_INTROS[id]
  const wait = step.wait
  const reduce = prefersReducedMotion()
  const instant = reduce || replay
  const [leaving, setLeaving] = useState(false)
  const [showBegin, setShowBegin] = useState(() => wait && instant)
  const beginRef = useRef(null)
  const done = useRef(false)
  const setLock = useSetIntroLock()

  function finish() {
    if (done.current) return
    done.current = true
    setLeaving(true)
    window.setTimeout(() => {
      markIntroSeen(id)
      onFinished()
    }, FADE_MS)
  }

  useEffect(() => {
    setLock(true)
    return () => setLock(false)
  }, [setLock])

  useEffect(() => {
    if (wait) {
      if (instant) {
        setShowBegin(true)
        return undefined
      }
      const timer = window.setTimeout(() => setShowBegin(true), FILL_MS)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => finish(), FILL_MS)
    return () => window.clearTimeout(timer)
  }, [wait, instant])

  useEffect(() => {
    if (showBegin) beginRef.current?.focus()
  }, [showBegin])

  useEffect(() => {
    function onKey(event) {
      if (event.key !== 'Enter' || event.repeat) return
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return
      event.preventDefault()
      if (wait && !showBegin) return
      finish()
    }
    function onClick(event) {
      if (wait) return
      if (event.target.closest('.sidebar, .topbar')) return
      finish()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
    }
  }, [wait, showBegin])

  const className = [
    'step-intro',
    leaving ? 'is-out' : '',
    instant ? 'is-instant' : '',
    wait ? '' : 'is-skip',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <main
      className={className}
      onClick={wait ? undefined : finish}
    >
      <p className="step-kicker">Step {step.index} of 4</p>
      <h1>{step.title}</h1>
      <p className="step-body">{step.body}</p>
      <div
        className="step-bars"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={step.index}
        aria-label={`Step ${step.index} of 4`}
      >
        {[1, 2, 3, 4].map((n) => (
          <span
            key={n}
            className={n < step.index ? 'is-done' : n === step.index ? 'is-current' : undefined}
          >
            {n === step.index ? <i /> : null}
          </span>
        ))}
      </div>
      {wait ? (
        <div className={showBegin ? 'step-intro-action is-on' : 'step-intro-action'}>
          <button ref={beginRef} type="button" className="button" onClick={finish} tabIndex={showBegin ? 0 : -1}>
            Begin
          </button>
        </div>
      ) : null}
    </main>
  )
}

export function StepGate({ id, children }) {
  const location = useLocation()
  const [stage, setStage] = useState(() => (shouldShowStepIntro(id, location) ? 'intro' : 'page'))
  const [fromIntro, setFromIntro] = useState(false)

  if (stage === 'intro') {
    return (
      <StepIntro
        id={id}
        onFinished={() => {
          markIntroSeen(id)
          setFromIntro(true)
          setStage('page')
        }}
      />
    )
  }

  if (fromIntro) return <div className="step-page-in">{children}</div>
  return children
}
