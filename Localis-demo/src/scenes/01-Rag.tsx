import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring, Img, staticFile } from 'remotion';
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
  const { fps } = useVideoConfig();

  // ── Camera punch-in: 1.0 → 1.12 (spring, settles ~40f) ──
  const cameraProgress = spring({ frame, fps, config: { damping: 22, stiffness: 130 } });
  const cameraScale = interpolate(cameraProgress, [0, 1], [1.0, 1.12]);

  // ── Timeline ──
  const FILE_PICKER_END = BEAT * 2;     // f36 — hard-cut file picker away
  const INGEST_START = BEAT;
  const USER_BUBBLE_START = BEAT * 6;
  const THINKING_START = BAR * 2;
  const ASSISTANT_START = BAR * 3 + BEAT * 2;
  const THINKING_ZOOM_START = BAR * 3;
  const ASSISTANT_ZOOM_START = BAR * 7;

  const FULL_TEXT = 'The file outlines Localis, a private AI assistant that runs entirely on your own computer using your GPU. Here\'s a summary:';
  const bulletsStart = ASSISTANT_START + BEAT * 2;

  return (
    <div style={{ width: 1920, height: 1080, overflow: 'hidden' }}>
      <div style={{
        transform: `scale(${cameraScale})`,
        transformOrigin: 'center center',
        width: 1920, height: 1080,
      }}>
        <Shell
          sceneDuration={DURATION}
          absoluteOverlay={
            frame < FILE_PICKER_END ? (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 40,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.72)',
              }}>
                <Img
                  src={staticFile('RAG.png')}
                  style={{ maxHeight: '78%', borderRadius: 12, boxShadow: '0 24px 72px rgba(0,0,0,0.85)' }}
                />
              </div>
            ) : null
          }
        >
          {/* Ingest progress top-left */}
          <IngestProgress startFrame={INGEST_START} />

          {/* User bubble */}
          <div style={{ alignSelf: 'flex-end', marginTop: 80 }}>
            <ChatBubble role="user" startFrame={USER_BUBBLE_START} label="You">
              Summarise this file for me.
            </ChatBubble>
          </div>

          {/* Thinking block — transformOrigin top-left keeps left-edge alignment during spring */}
          <ZoomWrapper
            startFrame={THINKING_ZOOM_START}
            style={{ alignSelf: 'flex-start', transformOrigin: 'top left' }}
          >
            <ThinkingBlock startFrame={THINKING_START} endFrame={ASSISTANT_START} />
          </ZoomWrapper>

          {/* Assistant bubble */}
          <ZoomWrapper
            startFrame={ASSISTANT_ZOOM_START}
            style={{ alignSelf: 'flex-start', transformOrigin: 'top left' }}
          >
            <ChatBubble role="assistant" startFrame={ASSISTANT_START} label="Localis">
              <div style={{ fontFamily: fonts.ui, lineHeight: 1.7 }}>
                <span>{FULL_TEXT}</span>
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
      </div>
    </div>
  );
};
