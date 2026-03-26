import React from 'react';
import { colors } from '../lib/design';

interface RsbRailProps {
  /** Which icon index is active (0=HA, 1=Model, 2=Prompt, 3=Finance, 4=Notes). -1=none */
  activeIndex?: number;
}

const BULB_SVG = (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" width={22} height={22}>
    <path d="M12 2C8.686 2 6 4.686 6 8c0 2.21 1.136 4.15 2.857 5.285L9 15h6l.143-1.715C16.864 12.15 18 10.21 18 8c0-3.314-2.686-6-6-6z" fill="#555" fillOpacity={0.4} />
    <rect x={9} y={15} width={6} height={1.8} rx={0.9} fill="rgba(255,255,255,0.28)" />
    <rect x={9.5} y={16.8} width={5} height={1.4} rx={0.7} fill="rgba(255,255,255,0.18)" />
    <rect x={10} y={18.2} width={4} height={1.4} rx={0.7} fill="rgba(255,255,255,0.12)" />
  </svg>
);

/** Material Symbol text stand-in — uses unicode char since we can't load Material Symbols font in Remotion easily */
const ICONS: Array<{ label: string; symbol: string }> = [
  { label: 'Home Automation', symbol: '💡' },  // index 0 — replaced by BULB_SVG below
  { label: 'Model Loader',   symbol: '🧠' },  // index 1
  { label: 'System Prompt',  symbol: '⌨' },   // index 2
  { label: 'Finance',        symbol: '💳' },   // index 3
  { label: 'Notes',          symbol: '📄' },   // index 4
];

export const RsbRail: React.FC<RsbRailProps> = ({ activeIndex = 0 }) => {
  return (
    <div style={{
      width: 72,
      height: '100%',
      flexShrink: 0,
      borderLeft: `1px solid ${colors.border}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '28px 0',
      background: colors.sidebar,
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
    }}>
      {/* Feature icons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', flex: 1 }}>
        {ICONS.map((icon, i) => {
          const isActive = i === activeIndex;
          return (
            <div key={i} style={{
              width: 46, height: 46, borderRadius: 15,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              position: 'relative',
              background: isActive ? colors.panel : 'transparent',
              border: isActive ? `1px solid rgba(255,255,255,0.14)` : '1px solid transparent',
              boxShadow: isActive ? `0 0 14px rgba(18,117,226,0.25)` : 'none',
              color: isActive ? '#fff' : 'rgba(255,255,255,0.3)',
              fontSize: i === 0 ? 18 : 20,
            }}>
              {i === 0 ? BULB_SVG : icon.symbol}
              {/* Active blue bar on right edge */}
              {isActive && (
                <div style={{
                  position: 'absolute', right: -1, top: '50%', transform: 'translateY(-50%)',
                  width: 3, height: 20,
                  background: colors.accent,
                  borderRadius: '3px 0 0 3px',
                }} />
              )}
            </div>
          );
        })}
      </div>
      {/* Footer icons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
        <div style={{
          width: 38, height: 38, borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.27)', fontSize: 17,
        }}>?</div>
        <div style={{
          width: 38, height: 38, borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.27)', fontSize: 17,
        }}>⚙</div>
      </div>
    </div>
  );
};
