import type { IconProps } from './icons/props.ts'

/**
 * Render SivitaCode's product-owned pulse mark. The execution cell and
 * continuous S path identify the product without carrying upstream geometry.
 */
export function SivitaMark(props: IconProps) {
  const size = props.size ?? 24
  return (
    <svg
      width={size}
      height={size}
      className={props.className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M12 2.75 20.25 7.5v9L12 21.25 3.75 16.5v-9L12 2.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M16.25 7.75H9.8c-1.55 0-2.55.85-2.55 2.1s1 2.15 2.55 2.15h4.4c1.55 0 2.55.85 2.55 2.15s-1 2.1-2.55 2.1H7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16.25" cy="7.75" r="1.15" fill="currentColor" />
      <circle cx="7.75" cy="16.25" r="1.15" fill="currentColor" />
    </svg>
  )
}
