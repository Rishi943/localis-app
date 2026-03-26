import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Img, staticFile } from 'remotion';
import { colors, fonts } from '../lib/design';
import { BEAT, BAR } from '../lib/beats';

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Logo: spring in at f0, peak by f36
  const logoProgress = spring({ frame, fps, config: { damping: 16, stiffness: 100, mass: 1.2 } });
  const logoScale = interpolate(logoProgress, [0, 1], [0.4, 1.0]);
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: 'clamp' });

  // "Introducing Localis" — fades in at beat 2 (f18)
  const titleOpacity = interpolate(frame, [BEAT * 1, BEAT * 3], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const titleY = interpolate(frame, [BEAT * 1, BEAT * 3], [12, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Tagline — fades in at beat 4 / bar end (f54)
  const tagOpacity = interpolate(frame, [BEAT * 4, BEAT * 6], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const tagY = interpolate(frame, [BEAT * 4, BEAT * 6], [10, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Subtle logo glow pulse after bar 2
  const glow = frame > BAR * 2 ? 0.5 + 0.5 * Math.abs(Math.sin(frame * 0.05)) : 0;

  return (
    <div style={{
      width: 1920, height: 1080,
      background: '#000',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 28,
      fontFamily: fonts.ui,
    }}>
      {/* Logo */}
      <div style={{
        transform: `scale(${logoScale})`,
        opacity: logoOpacity,
        filter: glow > 0 ? `drop-shadow(0 0 ${20 * glow}px rgba(200,184,154,${0.3 * glow}))` : 'none',
      }}>
        <Img src={staticFile('logo.svg')} style={{ width: 100, height: 100 }} />
      </div>

      {/* "Introducing Localis" */}
      <div style={{
        opacity: titleOpacity,
        transform: `translateY(${titleY}px)`,
        color: colors.text,
        fontSize: 52, fontWeight: 700, letterSpacing: '-0.02em',
      }}>
        Introducing Localis
      </div>

      {/* Tagline */}
      <div style={{
        opacity: tagOpacity,
        transform: `translateY(${tagY}px)`,
        color: colors.textMuted,
        fontSize: 22, fontWeight: 300, letterSpacing: '0.04em',
      }}>
        Your AI. Your machine. Your rules.
      </div>
    </div>
  );
};
