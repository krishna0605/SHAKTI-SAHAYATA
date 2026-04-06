import { type HTMLAttributes, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface RevealProps extends HTMLAttributes<HTMLDivElement> {
  delayMs?: number
  once?: boolean
}

export function Reveal({
  children,
  className,
  delayMs = 0,
  once = true,
  ...props
}: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          if (once) observer.unobserve(entry.target)
        } else if (!once) {
          setVisible(false)
        }
      },
      { threshold: 0.18 }
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [once])

  return (
    <div
      ref={ref}
      className={cn('scroll-fade', visible && 'is-visible', className)}
      style={{ transitionDelay: `${delayMs}ms` }}
      {...props}
    >
      {children}
    </div>
  )
}
