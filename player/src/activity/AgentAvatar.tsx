import { useId, type CSSProperties } from 'react';
import type { CompanionMood } from './presence';

/** Code-native fluid sphere. Motion follows work/speech state, not a simulated audio signal. */
export function AgentAvatar({ mood, word }: { mood: CompanionMood; word: number }) {
  const id = `agent-${useId().replace(/:/g, '')}`;
  return (
    <span
      className="agent-avatar"
      data-mood={mood}
      style={{ '--voice-step': mood === 'speaking' ? word % 4 : 0 } as CSSProperties}
    >
      <span className="agent-avatar-shadow" />
      <svg className="agent-avatar-sphere" viewBox="0 0 100 100" fill="none" aria-hidden="true">
        <defs>
          <clipPath id={`${id}-clip`}>
            <circle cx="50" cy="50" r="46" />
          </clipPath>
          <radialGradient id={`${id}-base`} cx=".32" cy=".19" r=".84">
            <stop stopColor="#f1fcff" />
            <stop offset=".42" stopColor="#a7e2ff" />
            <stop offset=".76" stopColor="#428ff5" />
            <stop offset="1" stopColor="#1741b6" />
          </radialGradient>
          <linearGradient id={`${id}-water`} x1="16" y1="47" x2="67" y2="98" gradientUnits="userSpaceOnUse">
            <stop stopColor="#9cddff" />
            <stop offset=".4" stopColor="#3495ff" />
            <stop offset="1" stopColor="#1947d0" />
          </linearGradient>
          <radialGradient id={`${id}-shine`} cx=".3" cy=".16" r=".75">
            <stop stopColor="white" stopOpacity=".72" />
            <stop offset=".55" stopColor="white" stopOpacity="0" />
            <stop offset="1" stopColor="#b3d9ff" stopOpacity=".35" />
          </radialGradient>
          <filter id={`${id}-cloud`} x="-35%" y="-35%" width="170%" height="170%" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency=".052" numOctaves="3" seed="17" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="14" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="1.1" />
          </filter>
        </defs>
        <g clipPath={`url(#${id}-clip)`}>
          <circle cx="50" cy="50" r="46" fill={`url(#${id}-base)`} />
          <g className="agent-avatar-water" filter={`url(#${id}-cloud)`}>
            <path d="M-18 55C2 24 18 38 36 47S61 83 83 57 116 41 123 57V121H-18Z" fill={`url(#${id}-water)`} />
            <path
              className="agent-avatar-cloud"
              d="M-20 37C6 2 22 55 46 39S76 19 99 30 116 58 116 66C91 77 75 40 54 54S12 71-20 50Z"
              fill="#edfaff"
              fillOpacity=".8"
            />
          </g>
          <circle cx="50" cy="50" r="46" fill={`url(#${id}-shine)`} />
          <ellipse cx="34" cy="19" rx="17" ry="7" fill="white" fillOpacity=".25" transform="rotate(-27 34 19)" />
        </g>
        <circle cx="50" cy="50" r="46" stroke="#d9f1ff" strokeOpacity=".85" strokeWidth="1.2" />
      </svg>
    </span>
  );
}
