import { useEffect, useState } from 'preact/hooks'

/**
 * Width of the element the returned callback ref is attached to. A callback
 * ref (not a ref object) so an element that mounts later — after a loading
 * placeholder — is still measured.
 */
export const useContainerWidth = <T extends HTMLElement>() => {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    if (!el) return
    setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? el.clientWidth)
      setWidth((prev) => (prev === next ? prev : next))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [el])

  return [setEl, width] as const
}
