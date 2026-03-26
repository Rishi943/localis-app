import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { colors, fonts, glass } from '../lib/design';
import { BAR, BEAT } from '../lib/beats';

interface RsbPanelProps {
  /** Scene-relative frame at which panel slides in */
  startFrame: number;
}

const SWATCH_SEQUENCE = [
  '#f97316', // orange
  '#f59e0b', // amber
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#ffffff',  // white
];

export const RsbPanel: React.FC<RsbPanelProps> = ({ startFrame }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - startFrame);

  // Slide in from right
  const slideProgress = spring({ frame: localFrame, fps, config: { damping: 22, stiffness: 130 } });
  const translateX = interpolate(slideProgress, [0, 1], [280, 0]);

  // Colour cycling starts at BAR * 2 local frames (bar 3 of scene)
  const CYCLE_START = BAR * 2;
  const cycleFrame = Math.max(0, localFrame - CYCLE_START);
  const swatchInterval = BEAT * 2; // each swatch shown for 2 beats
  const activeSwatchIndex = Math.floor(cycleFrame / swatchInterval) % SWATCH_SEQUENCE.length;
  const activeColor = SWATCH_SEQUENCE[activeSwatchIndex];

  // Bulb glow colour matches active swatch
  const bulbGlow = activeColor;

  // Brightness animation: stays at 27% until bar 7 local (frame 432), then animates
  const BRIGHTNESS_ANIM_START = BAR * 6; // f432
  const rawBrightness = localFrame < BRIGHTNESS_ANIM_START
    ? 27
    : interpolate(localFrame, [BRIGHTNESS_ANIM_START, BRIGHTNESS_ANIM_START + BAR], [27, 80], {
        extrapolateRight: 'clamp',
      });
  // Returns to 27 after
  const brightness = localFrame > BRIGHTNESS_ANIM_START + BAR
    ? interpolate(localFrame, [BRIGHTNESS_ANIM_START + BAR, BRIGHTNESS_ANIM_START + BAR + BAR / 2], [80, 27], {
        extrapolateRight: 'clamp',
      })
    : rawBrightness;

  // Bulb pulse
  const bulbPulse = 1.0 + 0.04 * Math.sin(localFrame * 0.15);

  return (
    <div style={{
      transform: `translateX(${translateX}px)`,
      width: 280, height: '100%',
      background: colors.sidebar,
      borderLeft: `1px solid ${colors.border}`,
      fontFamily: fonts.ui,
      padding: '16px 14px',
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      {/* Header */}
      <div style={{ color: colors.textDim, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>
        Quick Controls
      </div>

      {/* Light toggle */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px',
        ...glass,
        background: 'rgba(25,25,30,0.6)',
        borderRadius: 10,
      }}>
        <span style={{ color: colors.text, fontSize: 13, fontWeight: 500 }}>Rishi Room Light</span>
        <div style={{
          width: 36, height: 20, borderRadius: 10,
          background: colors.green,
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '0 3px',
        }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff' }} />
        </div>
      </div>

      {/* Bulb icon */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <div style={{
          fontSize: 52,
          transform: `scale(${bulbPulse})`,
          filter: `drop-shadow(0 0 16px ${bulbGlow}) drop-shadow(0 0 32px ${bulbGlow}44)`,
          lineHeight: 1,
        }}>💡</div>
        <div style={{ color: colors.text, fontSize: 22, fontWeight: 700 }}>
          {Math.round(brightness)}%
        </div>
      </div>

      {/* Colour swatches */}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {SWATCH_SEQUENCE.map((c, i) => (
          <div key={i} style={{
            width: 24, height: 24, borderRadius: '50%',
            background: c,
            border: i === activeSwatchIndex
              ? `2px solid #fff`
              : `2px solid transparent`,
            boxShadow: i === activeSwatchIndex
              ? `0 0 8px ${c}`
              : 'none',
            transition: 'none',
          }} />
        ))}
      </div>

      {/* Scene buttons */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {['Load', 'Unload', 'Default', 'Preview', 'Planning', 'Custom'].map((label) => (
          <div key={label} style={{
            padding: '6px 0',
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            background: label === 'Load' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)',
            color: label === 'Load' ? colors.red : colors.textMuted,
            fontSize: 11, textAlign: 'center', fontWeight: 500,
          }}>{label}</div>
        ))}
      </div>

      {/* Brightness slider */}
      <div style={{ padding: '0 4px' }}>
        <div style={{ color: colors.textDim, fontSize: 10, marginBottom: 4 }}>Brightness</div>
        <div style={{
          height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.1)',
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${brightness}%`,
            background: bulbGlow,
            borderRadius: 2,
          }} />
          <div style={{
            position: 'absolute', top: '50%',
            left: `${brightness}%`,
            transform: 'translate(-50%, -50%)',
            width: 12, height: 12, borderRadius: '50%',
            background: '#fff',
            boxShadow: `0 0 4px rgba(0,0,0,0.5)`,
          }} />
        </div>
      </div>
    </div>
  );
};
