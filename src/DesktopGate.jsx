import { useState } from 'react'

export function DesktopGate() {
  const [copied, setCopied] = useState(false)

  async function copyLink() {
    const url = window.location.href
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const input = document.createElement('textarea')
      input.value = url
      input.setAttribute('readonly', '')
      input.style.position = 'fixed'
      input.style.left = '-9999px'
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <main className="gate">
      <img src="/Halftone-Wordmark.png" alt="Halftone" />
      <p>works better on desktop.</p>
      <button type="button" className="button" onClick={copyLink}>
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </main>
  )
}
