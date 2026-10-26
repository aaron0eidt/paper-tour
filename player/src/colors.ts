import type { BlockType, Color } from './types';

/** Marker fills, multiplied onto the page. */
export const MARKER: Record<Color, string> = {
  yellow: '#ffe45c',
  blue: '#a6d4ff',
  green: '#a8eba2',
  pink: '#ffb3da',
  orange: '#ffc47a',
};

/** Strokes for boxes, underlines and label chips. */
export const STROKE: Record<Color, string> = {
  yellow: '#e0a100',
  blue: '#2f7cf6',
  green: '#1f9d55',
  pink: '#e3428e',
  orange: '#f07800',
};

/** Debug overlay: one outline color per block type. */
export const BLOCK_COLORS: Record<BlockType, string> = {
  title: '#e11d48',
  authors: '#db2777',
  heading: '#7c3aed',
  paragraph: '#2563eb',
  caption: '#0891b2',
  equation: '#059669',
  footnote: '#65a30d',
  reference: '#ca8a04',
  figure_text: '#ea580c',
  table_text: '#dc2626',
  header_footer: '#6b7280',
  other: '#9ca3af',
};
