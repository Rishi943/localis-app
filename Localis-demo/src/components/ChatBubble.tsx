import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Img, staticFile } from 'remotion';
import { colors, fonts, glass } from '../lib/design';

interface ChatBubbleProps {
  role: 'user' | 'assistant';
  /** Scene-relative frame when this bubble slides in */
  startFrame: number;
  children: React.ReactNode;
  /** Small label above the bubble e.g. "You" or "Localis" */
  label?: string;
  /** Timestamp string e.g. "12:32 · 5 tokens" */
  meta?: string;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({
  role,
  startFrame,
  children,
  label,
  meta,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - startFrame);

  const slideProgress = spring({
    frame: localFrame,
    fps,
    config: { damping: 20, stiffness: 140, mass: 1 },
  });

  const opacity = interpolate(localFrame, [0, 12], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const translateX = interpolate(slideProgress, [0, 1], [role === 'user' ? 40 : -40, 0]);

  const isUser = role === 'user';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      opacity,
      transform: `translateX(${translateX}px)`,
      gap: 6,
      fontFamily: fonts.ui,
    }}>
      {/* Label row */}
      {label && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          flexDirection: isUser ? 'row-reverse' : 'row',
        }}>
          {/* Avatar */}
          {isUser ? (
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: colors.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 700,
            }}>U</div>
          ) : (
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: '#161616',
              border: `1px solid ${colors.borderHighlight}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden',
            }}>
              <Img src={staticFile('logo.svg')} style={{ width: 24, height: 24 }} />
            </div>
          )}
          <span style={{ color: colors.textMuted, fontSize: 12 }}>{label}</span>
        </div>
      )}

      {/* Bubble */}
      <div style={{
        maxWidth: 600,
        padding: '12px 18px',
        borderRadius: isUser ? '18px 6px 18px 18px' : '6px 18px 18px 18px',
        ...glass,
        background: isUser ? 'rgba(59,130,246,0.15)' : 'rgba(20,20,20,0.75)',
        border: `1px solid ${isUser ? 'rgba(59,130,246,0.3)' : colors.border}`,
        color: colors.text,
        fontSize: 15,
        lineHeight: 1.6,
      }}>
        {children}
      </div>

      {/* Meta */}
      {meta && (
        <div style={{ color: colors.textDim, fontSize: 11, paddingLeft: isUser ? 0 : 8, paddingRight: isUser ? 8 : 0 }}>
          {meta}
        </div>
      )}
    </div>
  );
};
