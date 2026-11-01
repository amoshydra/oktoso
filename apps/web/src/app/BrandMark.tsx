interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 36, className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="512" height="512" rx="116" fill="var(--accent)" />
      <path
        d="M 256 96 L 369 143 L 416 256 L 369 369 L 256 416 L 143 369 L 96 256 L 143 143 Z"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth="44"
        strokeLinejoin="round"
      />
      <circle cx="256" cy="256" r="44" fill="var(--on-accent)" />
    </svg>
  );
}
