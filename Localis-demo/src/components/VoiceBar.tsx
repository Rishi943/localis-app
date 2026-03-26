import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { colors, fonts } from '../lib/design';

type VoiceState = 'idle' | 'listening' | 'done';

interface VoiceBarProps {
  /** Scene-relative frame when bar appears */
  startFrame: number;
  /** Array of state transitions: [{ frame, state }] — frame is scene-relative */
  states: Array<{ frame: number; state: VoiceState }>;
}

export const VoiceBar: React.FC<VoiceBarProps> = ({ startFrame, states }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - startFrame);

  // Determine current state
  let currentState: VoiceState = 'idle';
  for (const s of states) {
    if (localFrame >= s.frame) currentState = s.state;
  }

  const stateColors: Record<VoiceState, string> = {
    idle: 'rgba(120,120,120,0.6)',
    listening: `rgba(245,158,11,0.8)`,
    done: `rgba(34,197,94,0.8)`,
  };

  const stateLabels: Record<VoiceState, string> = {
    idle: 'Voice Ready',
    listening: 'Hey Chotu…',
    done: 'Hey Chotu',
  };

  const dotColor = stateColors[currentState];

  // Pulse for listening state
  const pulse = currentState === 'listening'
    ? 1.0 + 0.015 * Math.sin(frame * 0.25)
    : 1.0;

  const opacity = interpolate(localFrame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  const slideProgress = spring({ frame: localFrame, fps, config: { damping: 20, stiffness: 140 } });
  const translateY = interpolate(slideProgress, [0, 1], [-20, 0]);

  return (
    <div style={{
      opacity,
      transform: `translateY(${translateY}px) scale(${pulse})`,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(15,15,20,0.85)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      border: `1px solid ${dotColor}`,
      borderRadius: 20,
      padding: '6px 14px',
      fontFamily: fonts.ui,
      fontSize: 12,
      color: colors.text,
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: '50%',
        background: dotColor,
        boxShadow: `0 0 8px ${dotColor}`,
      }} />
      {stateLabels[currentState]}
    </div>
  );
};
