import { useEffect, useRef, useState } from 'react'
import { animate } from 'framer-motion'

/** Eases a displayed number toward `target` (400 ms). Snaps for reduced motion. */
export function useCountUp(target: number): number {
  const [value, setValue] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      from.current = target
      setValue(target)
      return
    }
    const controls = animate(from.current, target, {
      duration: 0.4,
      ease: [0.2, 0, 0, 1],
      onUpdate: (v) => {
        from.current = v
        setValue(v)
      },
    })
    return () => controls.stop()
  }, [target])
  return Math.round(value)
}
