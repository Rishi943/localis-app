import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import { Shell } from '../components/Shell';
import { ChatBubble } from '../components/ChatBubble';
import { ToolCard } from '../components/ToolCard';
import { ZoomWrapper } from '../components/ZoomWrapper';
import { colors, fonts } from '../lib/design';
import { BEAT, BAR } from '../lib/beats';

const DURATION = 432; // 6 bars

// Prior conversation snippet (dimmed)
const PriorChat: React.FC = () => (
  <div style={{ opacity: 0.35, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ alignSelf: 'flex-end' }}>
      <ChatBubble role="user" startFrame={0} label="You">Summarise this file for me.</ChatBubble>
    </div>
    <div style={{ alignSelf: 'flex-start' }}>
      <ChatBubble role="assistant" startFrame={0} label="Localis">
        <span style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.textMuted }}>
          <strong>The file outlines Localis</strong>, a private AI assistant that runs entirely on your own computer…
        </span>
      </ChatBubble>
    </div>
  </div>
);

export const WebSearchScene: React.FC = () => {
  const frame = useCurrentFrame();

  const USER_START = BEAT;            // f18
  const TOOL_START = BAR;             // f72
  const TOOL_ZOOM_START = BEAT * 6;   // f108
  const ASSISTANT_START = BAR * 2;    // f144

  const F1_TEXT = 'The next F1 race is the Japanese Grand Prix:';
  const localAssistFrame = Math.max(0, frame - ASSISTANT_START);
  const charsVisible = Math.min(F1_TEXT.length, Math.floor((localAssistFrame / 30) * 40));

  const detail1Opacity = interpolate(frame, [ASSISTANT_START + BAR, ASSISTANT_START + BAR + 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const detail2Opacity = interpolate(frame, [ASSISTANT_START + BAR + BEAT, ASSISTANT_START + BAR + BEAT + 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <Shell sceneDuration={DURATION}>
      <PriorChat />

      {/* User bubble */}
      <div style={{ alignSelf: 'flex-end' }}>
        <ChatBubble role="user" startFrame={USER_START} label="You">
          When is the next F1 race?
        </ChatBubble>
      </div>

      {/* Tool card */}
      <ZoomWrapper startFrame={TOOL_ZOOM_START} style={{ alignSelf: 'flex-start' }}>
        <ToolCard
          startFrame={TOOL_START}
          toolName="web_search"
          subtitle="3 results"
          dotColor={colors.green}
        />
      </ZoomWrapper>

      {/* Assistant response */}
      <ChatBubble role="assistant" startFrame={ASSISTANT_START} label="Localis">
        <div style={{ fontFamily: fonts.ui, lineHeight: 1.7 }}>
          <div>{F1_TEXT.slice(0, charsVisible)}</div>
          <div style={{ opacity: detail1Opacity, marginTop: 8, display: 'flex', gap: 8 }}>
            <span>📅</span>
            <span><strong>Date:</strong> Sun, Mar 29 — 1:00 a.m.</span>
          </div>
          <div style={{ opacity: detail2Opacity, marginTop: 4, display: 'flex', gap: 8 }}>
            <span>🏎️</span>
            <span><strong>Track:</strong> Suzuka Circuit</span>
          </div>
        </div>
      </ChatBubble>
    </Shell>
  );
};
