import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { Shell } from '../components/Shell';
import { ChatBubble } from '../components/ChatBubble';
import { ThinkingBlock } from '../components/ThinkingBlock';
import { IngestProgress } from '../components/IngestProgress';
import { ZoomWrapper } from '../components/ZoomWrapper';
import { colors, fonts } from '../lib/design';
import { BEAT, BAR } from '../lib/beats';

const DURATION = 576; // 8 bars

const BULLETS = [
  { key: 'Technology:', value: 'Runs on your local GPU, no cloud or subscriptions.' },
  { key: 'Features:', value: 'Fully local · Two-tier memory · RAG · Web search · Multi-provider support' },
  { key: 'Purpose:', value: 'Fully-stack, self-updating, shippable (no scripts or notebooks).' },
];

export const RagScene: React.FC = () => {
  const frame = useCurrentFrame();

  // Ingest appears at beat 1
  const INGEST_START = BEAT;
  // User bubble at beat 7 (f126 → f108)
  const USER_BUBBLE_START = BEAT * 6;
  // Thinking block at bar 3 (f144)
  const THINKING_START = BAR * 2;
  // Assistant bubble at bar 4 start (f252 → bar3.5 beat)
  const ASSISTANT_START = BAR * 3 + BEAT * 2;
  // Zoom on thinking block at bar 4 (f216 -> bar 3 start)
  const THINKING_ZOOM_START = BAR * 3;
  // Zoom on assistant bubble at bar 8 start minus 1 bar
  const ASSISTANT_ZOOM_START = BAR * 7;

  // Text reveal for response
  const FULL_TEXT = 'The file outlines Localis, a private AI assistant that runs entirely on your own computer using your GPU. Here\'s a summary:';
  const localResponseFrame = Math.max(0, frame - ASSISTANT_START);
  const charsVisible = Math.min(FULL_TEXT.length, Math.floor((localResponseFrame / 30) * 35));

  // Bullet lines appear after the header text finishes
  const bulletsStart = ASSISTANT_START + Math.ceil(FULL_TEXT.length / 35 * 30);

  return (
    <Shell sceneDuration={DURATION}>
      {/* Ingest progress top-left */}
      <IngestProgress startFrame={INGEST_START} />

      {/* User bubble */}
      <div style={{ alignSelf: 'flex-end', marginTop: 80 }}>
        <ChatBubble role="user" startFrame={USER_BUBBLE_START} label="You">
          Summarise this file for me.
        </ChatBubble>
      </div>

      {/* Thinking block */}
      <ZoomWrapper startFrame={THINKING_ZOOM_START} style={{ alignSelf: 'flex-start' }}>
        <ThinkingBlock startFrame={THINKING_START} endFrame={ASSISTANT_START} />
      </ZoomWrapper>

      {/* Assistant bubble */}
      <ZoomWrapper startFrame={ASSISTANT_ZOOM_START} style={{ alignSelf: 'flex-start' }}>
        <ChatBubble role="assistant" startFrame={ASSISTANT_START} label="Localis">
          <div style={{ fontFamily: fonts.ui, lineHeight: 1.7 }}>
            <span>{FULL_TEXT.slice(0, charsVisible)}</span>
            {/* Bullet points fade in after header */}
            {BULLETS.map((b, i) => {
              const bStart = bulletsStart + i * BAR;
              const bOpacity = interpolate(frame, [bStart, bStart + 20], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              });
              return (
                <div key={i} style={{ opacity: bOpacity, marginTop: 8, display: 'flex', gap: 8 }}>
                  <span style={{ color: colors.textDim }}>•</span>
                  <span>
                    <strong>{b.key}</strong>{' '}{b.value}
                  </span>
                </div>
              );
            })}
            {/* "Let me know" line */}
            {(() => {
              const lmStart = bulletsStart + BULLETS.length * BAR;
              const lmOp = interpolate(frame, [lmStart, lmStart + 20], [0, 1], {
                extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
              });
              return (
                <div style={{ opacity: lmOp, marginTop: 8, color: colors.textMuted, fontSize: 13 }}>
                  Let me know if you'd like further details!
                </div>
              );
            })()}
          </div>
        </ChatBubble>
      </ZoomWrapper>
    </Shell>
  );
};
