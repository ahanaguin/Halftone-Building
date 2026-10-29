import { useEffect, useState } from 'react'

const QUERY = '(max-width: 899px)'

export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(QUERY).matches)

  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = () => setNarrow(media.matches)
    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return narrow
}
