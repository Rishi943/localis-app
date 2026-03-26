import React from 'react';
import { useCurrentFrame, interpolate, Img, staticFile } from 'remotion';
import { colors, fonts, glass } from '../lib/design';

interface ShellProps {
  /** Total frame count for this scene (drives bg push calc) */
  sceneDuration: number;
  /** Chat content for centre column */
  children?: React.ReactNode;
  /** Right sidebar content — if provided, RSB renders */
  rsbContent?: React.ReactNode;
  /** 0–1 opacity multiplier for chat area (for dimming in later scenes) */
  chatOpacity?: number;
  /** Extra dark overlay on bg (0–1) for climax scene */
  bgDimExtra?: number;
  /** Index of active mode pill (0=Web, 1=Home, 2=Think, 3=Remember). -1 = none active. Default: -1 */
  activePill?: number;
  /** Full-frame absolute content rendered at Shell root level (zIndex 20+) */
  absoluteOverlay?: React.ReactNode;
}

export const Shell: React.FC<ShellProps> = ({
  sceneDuration,
  children,
  rsbContent,
  chatOpacity = 1,
  bgDimExtra = 0,
  activePill = -1,
  absoluteOverlay,
}) => {
  const frame = useCurrentFrame();

  const bgScale = interpolate(frame, [0, sceneDuration], [1.0, 1.06], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });

  return (
    <div style={{ width: 1920, height: 1080, overflow: 'hidden', position: 'relative', fontFamily: fonts.ui }}>
      {/* Wallpaper — slow cinematic push */}
      <div style={{
        position: 'absolute', inset: -80,
        transform: `scale(${bgScale})`,
        transformOrigin: 'center center',
        background: [
          'radial-gradient(ellipse at 25% 85%, rgba(12,18,10,0.7) 0%, transparent 35%)',
          'radial-gradient(ellipse at 75% 80%, rgba(10,14,18,0.5) 0%, transparent 30%)',
          'radial-gradient(ellipse at 50% 55%, rgba(18,22,28,0.4) 0%, transparent 50%)',
          'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(6,8,12,1) 25%, rgba(10,12,16,1) 55%, rgba(4,5,8,1) 80%, rgba(0,0,0,1) 100%)',
        ].join(', '),
        zIndex: 0,
      }} />

      {/* Extra dim overlay for climax */}
      {bgDimExtra > 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `rgba(0,0,0,${bgDimExtra})`,
          zIndex: 1,
          pointerEvents: 'none',
        }} />
      )}

      {/* LEFT SIDEBAR — 48px */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: 48,
        background: colors.sidebar,
        borderRight: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 12, paddingBottom: 12, gap: 8,
        zIndex: 10,
      }}>
        {/* Logo button */}
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: '#161616',
          border: `1px solid ${colors.borderHighlight}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
        }}>
          <Img src={staticFile('logo.svg')} style={{ width: 28, height: 28 }} />
        </div>
        <div style={{ flex: 1 }} />
        {/* Settings icon */}
        <div style={{ color: colors.textDim, fontSize: 16 }}>⚙</div>
      </div>

      {/* HEADER — full width */}
      <div style={{
        position: 'absolute', left: 48, right: 0, top: 0, height: 52,
        ...glass,
        background: 'rgba(8,8,12,0.80)',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex', alignItems: 'center',
        paddingLeft: 20, paddingRight: 20,
        zIndex: 10,
      }}>
        <div>
          <div style={{ color: colors.text, fontSize: 15, fontWeight: 600, letterSpacing: '0.02em' }}>Localis</div>
          <div style={{ color: colors.textDim, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Qwen2.5 · 7B</div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Neural Engine Active */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(34,197,94,0.12)',
          border: `1px solid rgba(34,197,94,0.3)`,
          borderRadius: 20, padding: '4px 12px',
          color: colors.green, fontSize: 12, fontWeight: 500,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: colors.green }} />
          Neural Engine Active
        </div>
        <div style={{
          marginLeft: 12, width: 32, height: 32, borderRadius: '50%',
          background: colors.accent,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 13, fontWeight: 700,
        }}>U</div>
      </div>

      {/* CHAT AREA */}
      <div style={{
        position: 'absolute',
        left: 48,
        right: rsbContent ? 280 : 48,
        top: 52,
        bottom: 80,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '24px 0',
        overflow: 'hidden',
        opacity: chatOpacity,
        zIndex: 5,
      }}>
        <div style={{ width: '100%', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
      </div>

      {/* RIGHT SIDEBAR */}
      {rsbContent && (
        <div style={{
          position: 'absolute', right: 0, top: 52, bottom: 0, width: 280,
          background: colors.sidebar,
          borderLeft: `1px solid ${colors.border}`,
          zIndex: 10,
          overflowY: 'hidden',
        }}>
          {rsbContent}
        </div>
      )}

      {/* BOTTOM INPUT BAR */}
      <div style={{
        position: 'absolute', left: 48, right: rsbContent ? 280 : 48, bottom: 0, height: 80,
        ...glass,
        background: 'rgba(8,8,12,0.80)',
        borderTop: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 8, zIndex: 10,
      }}>
        {/* Mode pills */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['🌐 Web', '🏠 Home', '💭 Think', '📌 Remember'].map((label, i) => (
            <div key={i} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11,
              background: i === activePill ? 'rgba(59,130,246,0.2)' : 'transparent',
              border: i === activePill ? `1px solid rgba(59,130,246,0.4)` : `1px solid ${colors.border}`,
              color: i === activePill ? colors.accent : colors.textMuted,
            }}>{label}</div>
          ))}
          <div style={{
            width: 28, height: 16, borderRadius: 8,
            background: 'rgba(255,255,255,0.15)',
            position: 'relative',
          }}>
            <div style={{
              width: 12, height: 12, borderRadius: '50%', background: '#fff',
              position: 'absolute', top: 2, right: 2,
            }} />
          </div>
        </div>
        {/* Input pill */}
        <div style={{
          width: '90%', maxWidth: 700, height: 44, borderRadius: 22,
          background: 'rgba(255,255,255,0.06)',
          border: `1px solid ${colors.borderHighlight}`,
          display: 'flex', alignItems: 'center',
          padding: '0 16px',
        }}>
          <span style={{ color: colors.textDim, fontSize: 14, flex: 1 }}>Message Localis…</span>
          <span style={{ color: colors.textDim, fontSize: 18 }}>🎤</span>
          <div style={{
            marginLeft: 10, width: 32, height: 32, borderRadius: '50%',
            background: colors.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 16,
          }}>↑</div>
        </div>
      </div>

      {/* Absolute overlay — full-frame, not clipped by chat area */}
      {absoluteOverlay}
    </div>
  );
};
