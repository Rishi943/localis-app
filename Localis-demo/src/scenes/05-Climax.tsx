import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Img, staticFile } from 'remotion';
import { Shell } from '../components/Shell';
import { ChatBubble } from '../components/ChatBubble';
import { ToolCard } from '../components/ToolCard';
import { VoiceBar } from '../components/VoiceBar';
import { ZoomWrapper } from '../components/ZoomWrapper';
import { colors, fonts } from '../lib/design';
import { BEAT, BAR } from '../lib/beats';

const DURATION = 432; // 6 bars

export const ClimaxScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Timeline
  const VOICE_START = 0;
  const SUBTITLE_START = BEAT;        // f18
  const USER_BUBBLE_START = BEAT * 5; // f90
  const ASSIST_CARD_START = BEAT * 7; // f126
  const ASSIST_ZOOM_START = BAR * 2;  // f144
  const ASSISTANT_START = BEAT * 11;  // f198
  const ASSIST_BUBBLE_ZOOM = BAR * 3; // f216
  const FADE_TO_BLACK_START = BAR * 4;// f288
  const LOGO_START = BAR * 5;         // f360

  // Subtitle fade
  const subtitleOpacity = interpolate(frame, [SUBTITLE_START, SUBTITLE_START + 14], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const subtitleFadeOut = interpolate(frame, [FADE_TO_BLACK_START, FADE_TO_BLACK_START + BAR], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Fade to black
  const fadeBlack = interpolate(frame, [FADE_TO_BLACK_START, FADE_TO_BLACK_START + BAR * 1.5], [0, 0.92], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  // Outro logo
  const logoOpacity = interpolate(frame, [LOGO_START, LOGO_START + 24], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const logoProgress = spring({ frame: Math.max(0, frame - LOGO_START), fps, config: { damping: 20, stiffness: 100 } });
  const logoScale = interpolate(logoProgress, [0, 1], [0.7, 1.0]);

  return (
    <Shell
      sceneDuration={DURATION}
      bgDimExtra={0.25}
      absoluteOverlay={
        <>
          {/* Voice bar */}
          <div style={{ position: 'absolute', top: 70, right: 60, zIndex: 20 }}>
            <VoiceBar
              startFrame={VOICE_START}
              states={[
                { frame: 0, state: 'idle' },
                { frame: BEAT, state: 'listening' },
                { frame: BAR + BEAT * 2, state: 'done' },
              ]}
            />
          </div>

          {/* Subtitle */}
          <div style={{
            position: 'absolute',
            bottom: 120, left: 0, right: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            opacity: subtitleOpacity * subtitleFadeOut,
            zIndex: 20,
          }}>
            <div style={{ color: colors.text, fontSize: 36, fontWeight: 700, letterSpacing: '0.02em', fontFamily: fonts.ui }}>
              light banda kar
            </div>
            <div style={{ color: colors.textMuted, fontSize: 18, fontFamily: fonts.ui }}>
              (Marathi)
            </div>
          </div>

          {/* Fade to black */}
          <div style={{
            position: 'absolute', inset: 0,
            background: `rgba(0,0,0,${fadeBlack})`,
            zIndex: 25, pointerEvents: 'none',
          }} />

          {/* Outro logo */}
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: logoOpacity,
            transform: `scale(${logoScale})`,
            zIndex: 30,
          }}>
            <Img src={staticFile('logo.svg')} style={{ width: 64, height: 64 }} />
          </div>
        </>
      }
    >
      {/* Chat messages */}
      <div style={{ marginTop: 80, display: 'flex', flexDirection: 'column', gap: 14, width: '100%' }}>
        {/* User bubble */}
        <div style={{ alignSelf: 'flex-end' }}>
          <ChatBubble role="user" startFrame={USER_BUBBLE_START} label="You" meta="12:32 · 5 tokens">
            light banda kar
          </ChatBubble>
        </div>

        {/* Assist tool card */}
        <ZoomWrapper startFrame={ASSIST_ZOOM_START} style={{ alignSelf: 'flex-start' }}>
          <ToolCard
            startFrame={ASSIST_CARD_START}
            toolName="assist.action"
            subtitle="Light controlled"
            rows={[
              { key: 'Entity', value: 'light.rishi_room_light', valueColor: colors.textMuted },
              { key: 'Change', value: '→ OFF', valueColor: colors.red },
            ]}
          />
        </ZoomWrapper>

        {/* Assistant response */}
        <ZoomWrapper startFrame={ASSIST_BUBBLE_ZOOM} style={{ alignSelf: 'flex-start' }}>
          <ChatBubble role="assistant" startFrame={ASSISTANT_START} label="Localis">
            Rishi Room Light turned OFF.
          </ChatBubble>
        </ZoomWrapper>
      </div>
    </Shell>
  );
};
