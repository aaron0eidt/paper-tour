import { useId } from 'react';

/**
 * The Paper Tour mark: a gradient tile holding a page with one highlighted line. This is the small-size drawing (the
 * favicon's), which stays crisp from 14 to 48 px; the detailed logo for large sizes is docs/brand/logo.svg.
 */
export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  const gradient = `paper-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 112 112" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ea6ff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <rect width="112" height="112" rx="26" fill={`url(#${gradient})`} />
      <path d="M32 11h34l24 24v57a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8V19a8 8 0 0 1 8-8z" fill="#f8f9fd" />
      <path d="M66 11v16a8 8 0 0 0 8 8h16z" fill="#b9c6ee" />
      <rect x="34" y="44" width="30" height="11" rx="5.5" fill="#a3adcb" />
      <rect x="29" y="62" width="54" height="23" rx="7" fill="#ffe45c" />
      <rect x="36" y="69.5" width="40" height="8" rx="4" fill="#3d3f52" />
    </svg>
  );
}
