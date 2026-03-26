import React from 'react';
import { useCurrentFrame, interpolate, Img, staticFile } from 'remotion';
import { colors, fonts, glassShadow } from '../lib/design';
import { RsbRail } from './RsbRail';

interface ShellProps {
  sceneDuration: number;
  children?: React.ReactNode;
  /** Right sidebar panel content — if provided, RSB panel (284px) renders between chat and rail */
  rsbContent?: React.ReactNode;
  chatOpacity?: number;
  bgDimExtra?: number;
  /** Index of active toolbar pill (0=Web, 1=Home, 2=Think, 3=Remember). -1 = none active. */
  activePill?: number;
  /** Index of active RSB rail icon (0=HA, 1=Model, 2=Prompt, 3=Finance, 4=Notes). -1=none. Default 0 when rsbContent present, -1 otherwise. */
  activeRsbIcon?: number;
  /** Full-frame absolute content rendered at Shell root level (zIndex 20+) */
  absoluteOverlay?: React.ReactNode;
  /** Whether to show the RSB rail. Default true. */
  showRsbRail?: boolean;
  /** Scene-relative frame at which the active pill click-bounce starts. Only used when activePill >= 0. */
  pillBounceStartFrame?: number;
}

const LSB_WIDTH = 64;
const RSB_RAIL_WIDTH = 72;
const RSB_PANEL_WIDTH = 284;
const HEADER_HEIGHT = 62;
const INPUT_HEIGHT = 120; // toolbar + input pill + disclaimer

export const Shell: React.FC<ShellProps> = ({
  sceneDuration,
  children,
  rsbContent,
  chatOpacity = 1,
  bgDimExtra = 0,
  activePill = -1,
  activeRsbIcon,
  absoluteOverlay,
  showRsbRail = true,
  pillBounceStartFrame,
}) => {
  const frame = useCurrentFrame();

  // Default activeRsbIcon: 0 (HA) when panel is shown, -1 otherwise
  const rsbIconIndex = activeRsbIcon !== undefined ? activeRsbIcon : (rsbContent ? 0 : -1);

  const pillBounceScale = (i: number): number => {
    if (i !== activePill || pillBounceStartFrame === undefined) return 1;
    const bf = Math.max(0, frame - pillBounceStartFrame);
    if (bf >= 8) return 1;
    return interpolate(bf, [0, 2, 5, 8], [1, 0.9, 1.05, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  };
  const pillBounceFilter = (i: number): string => {
    if (i !== activePill || pillBounceStartFrame === undefined) return 'none';
    const bf = Math.max(0, frame - pillBounceStartFrame);
    if (bf >= 8) return 'none';
    const b = interpolate(bf, [0, 2, 4, 8], [1, 2.0, 1.3, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
    return `brightness(${b})`;
  };

  const bgScale = interpolate(frame, [0, sceneDuration], [1.0, 1.06], {
    extrapolateRight: 'clamp',
    extrapolateLeft: 'clamp',
  });

  const rightEdge = showRsbRail ? RSB_RAIL_WIDTH : 0;
  const chatRight = rsbContent ? RSB_PANEL_WIDTH + rightEdge : rightEdge;

  const PILL_LABELS = ['Web', 'Home', 'Think', 'Remember'];
  const PILL_ICON_FILES = [
    'icons/localis-web-search.svg',
    'icons/localis-home-assistant.svg',
    'icons/localis-memory.svg',
    'icons/localis-from-file.svg',
  ];

  return (
    <div style={{ width: 1920, height: 1080, overflow: 'hidden', position: 'relative', fontFamily: fonts.ui }}>
      {/* Wallpaper — slow cinematic Ken Burns push (35% opacity) */}
      <div style={{
        position: 'absolute', inset: -80,
        transform: `scale(${bgScale})`,
        transformOrigin: 'center center',
        zIndex: 0,
        overflow: 'hidden',
      }}>
        <Img
          src={staticFile('wp3770498-red-dead-redemption-2-4k-wallpapers.jpg')}
          style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.35 }}
        />
      </div>

      {/* Extra dim overlay */}
      {bgDimExtra > 0 && (
        <div style={{
          position: 'absolute', inset: 0,
          background: `rgba(0,0,0,${bgDimExtra})`,
          zIndex: 1, pointerEvents: 'none',
        }} />
      )}

      {/* LEFT SIDEBAR RAIL — 64px (matches real app .lsb-rail) */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0, width: LSB_WIDTH,
        background: 'rgba(10,10,10,0.82)',
        borderRight: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '24px 0', gap: 6,
        zIndex: 10,
      }}>
        {/* Logo — logo.svg in dark rounded square */}
        <div style={{
          width: 34, height: 34, borderRadius: 10,
          background: '#161616',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          overflow: 'hidden',
          marginBottom: 16,
        }}>
          <Img src={staticFile('logo.svg')} style={{ width: 30, height: 30 }} />
        </div>
        {/* New Chat icon */}
        <div style={{
          width: 46, height: 46, borderRadius: 15,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.35)', fontSize: 22,
        }}>+</div>
        <div style={{ flex: 1 }} />
        {/* Settings */}
        <div style={{
          width: 38, height: 38, borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.27)', fontSize: 17,
        }}>⚙</div>
        {/* Expand chevron */}
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.4)', fontSize: 14,
        }}>▶</div>
      </div>

      {/* HEADER — between LSB and RSB */}
      <div style={{
        position: 'absolute', left: LSB_WIDTH, right: 0, top: 0, height: HEADER_HEIGHT,
        background: 'rgba(8,8,12,0.94)',
        borderBottom: `1px solid rgba(255,255,255,0.06)`,
        display: 'flex', alignItems: 'center',
        padding: '0 28px',
        zIndex: 10,
      }}>
        <div>
          <div style={{ color: colors.text, fontSize: 15, fontWeight: 700 }}>Localis</div>
          <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, letterSpacing: '0.18em', textTransform: 'uppercase' as const, marginTop: 2 }}>
            Qwen 3.5 · 0.8B
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Status pill — glass style matching real app */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 13px', borderRadius: 100,
          background: 'rgba(15,15,15,0.85)',
          border: `1px solid ${colors.border}`,
          fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: colors.green,
            boxShadow: `0 0 8px rgba(34,197,94,0.6)`,
          }} />
          Neural Engine Active
        </div>
        {/* Avatar — glass circle with initial */}
        <div style={{
          marginLeft: 14, width: 36, height: 36, borderRadius: '50%',
          background: 'rgba(15,15,15,0.85)',
          border: `1px solid ${colors.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'rgba(255,255,255,0.7)', fontSize: 20,
        }}>👤</div>
      </div>

      {/* CHAT AREA */}
      <div style={{
        position: 'absolute',
        left: LSB_WIDTH,
        right: chatRight,
        top: HEADER_HEIGHT,
        bottom: INPUT_HEIGHT,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '24px 28px 0',
        overflow: 'hidden',
        opacity: chatOpacity,
        zIndex: 5,
      }}>
        <div style={{ width: '100%', maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {children}
        </div>
      </div>

      {/* RSB PANEL — slides in when rsbContent provided */}
      {rsbContent && (
        <div style={{
          position: 'absolute',
          right: showRsbRail ? RSB_RAIL_WIDTH : 0,
          top: HEADER_HEIGHT, bottom: 0,
          width: RSB_PANEL_WIDTH,
          background: 'rgba(10,10,10,0.82)',
          borderLeft: `1px solid ${colors.border}`,
          zIndex: 10,
          overflowY: 'hidden',
        }}>
          {rsbContent}
        </div>
      )}

      {/* RSB RAIL — always visible on right edge */}
      {showRsbRail && (
        <div style={{ position: 'absolute', right: 0, top: HEADER_HEIGHT, bottom: 0, zIndex: 10 }}>
          <RsbRail activeIndex={rsbIconIndex} />
        </div>
      )}

      {/* BOTTOM INPUT BAR — toolbar + input pill + disclaimer */}
      <div style={{
        position: 'absolute',
        left: LSB_WIDTH,
        right: chatRight,
        bottom: 0,
        height: INPUT_HEIGHT,
        background: 'linear-gradient(to top, #000 0%, rgba(0,0,0,0.92) 55%, transparent 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 22,
        zIndex: 10,
      }}>
        <div style={{ width: '95%', maxWidth: 820, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {/* Toolbar — above input pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px' }}>
            {PILL_LABELS.map((label, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 8px', borderRadius: 7,
                fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' as const,
                background: i === activePill ? colors.accentSoft : 'transparent',
                border: i === activePill
                  ? `1px solid ${colors.accentBorder}`
                  : '1px solid transparent',
                color: i === activePill ? 'rgba(96,165,250,0.85)' : 'rgba(255,255,255,0.28)',
                opacity: i === activePill ? 1 : 0.75,
                transform: `scale(${pillBounceScale(i)})`,
                filter: pillBounceFilter(i),
              }}>
                <Img
                  src={staticFile(PILL_ICON_FILES[i])}
                  style={{ width: 14, height: 14, opacity: i === activePill ? 1 : 0.5 }}
                />
                {label}
              </div>
            ))}
            {/* Separator */}
            <div style={{
              width: 1, height: 14,
              background: 'rgba(255,255,255,0.12)',
              margin: '0 6px', flexShrink: 0,
            }} />
            {/* Wakeword toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, opacity: 0.65 }}>
              <div style={{
                width: 24, height: 14, borderRadius: 100,
                background: colors.accent,
                position: 'relative',
              }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%', background: '#fff',
                  position: 'absolute', top: 2, left: 12,
                }} />
              </div>
              <span style={{ fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.02em' }}>
                Wakeword
              </span>
            </div>
          </div>

          {/* Input pill */}
          <div style={{
            width: '100%', height: 52, borderRadius: 100,
            background: 'rgba(15,15,15,0.85)',
            border: `1px solid ${colors.border}`,
            boxShadow: glassShadow,
            display: 'flex', alignItems: 'center',
            padding: '0 7px 0 10px',
            gap: 6,
          }}>
            {/* Attach icon */}
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.32)', fontSize: 18, flexShrink: 0,
            }}>📎</div>
            {/* Placeholder text */}
            <div style={{ flex: 1, color: 'rgba(255,255,255,0.28)', fontSize: 14 }}>
              Send a message to Localis…
            </div>
            {/* Mic button */}
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.32)', fontSize: 18, flexShrink: 0,
            }}>🎤</div>
            {/* Send button — blue circle */}
            <div style={{
              width: 38, height: 38, borderRadius: '50%',
              background: colors.accent,
              boxShadow: '0 0 14px rgba(18,117,226,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 18, flexShrink: 0,
            }}>↑</div>
          </div>

          {/* Disclaimer */}
          <div style={{
            fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center' as const,
          }}>
            Localis can make mistakes. Check important info.
          </div>
        </div>
      </div>

      {/* Absolute overlay — full-frame, not clipped */}
      {absoluteOverlay}
    </div>
  );
};
