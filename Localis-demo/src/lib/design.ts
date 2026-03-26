export const colors = {
  bg: '#000000',
  panel: 'rgba(15,15,15,0.85)',
  sidebar: 'rgba(10,10,10,0.90)',
  glass: 'rgba(20,20,20,0.70)',
  border: 'rgba(255,255,255,0.08)',
  borderHighlight: 'rgba(255,255,255,0.15)',
  text: '#ffffff',
  textMuted: 'rgba(255,255,255,0.55)',
  textDim: 'rgba(255,255,255,0.30)',
  accent: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  sand: '#c8b89a',
  red: '#ef4444',
  glassBg: 'rgba(20,20,20,0.70)',
} as const;

export const fonts = {
  ui: "'Inter', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Fira Code', monospace",
} as const;

export const glass = {
  background: colors.glass,
  backdropFilter: 'blur(24px) saturate(180%)',
  WebkitBackdropFilter: 'blur(24px) saturate(180%)',
  border: `1px solid ${colors.border}`,
} as const;
