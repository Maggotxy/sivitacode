import type { IconProps } from './icons/props.ts'

/**
 * Render the SivitaCode wordmark. This intentionally uses product-owned
 * geometry and a neutral system wordmark so public builds never display the
 * upstream DeepSeek Harness artwork.
 */
export function BrandWordmark(props: IconProps) {
  const size = props.size ?? 24
  return (
    <svg
      width={(size * 150) / 24}
      height={size}
      className={props.className}
      viewBox="0 0 150 24"
      fill="none"
      aria-hidden="true"
    >
      <path d="M12 1.75 21.25 7v10L12 22.25 2.75 17V7L12 1.75Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M16.25 7.75H9.8c-1.55 0-2.55.85-2.55 2.1s1 2.15 2.55 2.15h4.4c1.55 0 2.55.85 2.55 2.15s-1 2.1-2.55 2.1H7.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16.25" cy="7.75" r="1.15" fill="currentColor" />
      <circle cx="7.75" cy="16.25" r="1.15" fill="currentColor" />
      <text x="30" y="16.7" fill="currentColor" fontFamily="Inter, ui-sans-serif, system-ui, sans-serif" fontSize="14.5" fontWeight="750" letterSpacing="-.35">SivitaCode</text>
    </svg>
  )
}
