import React from 'react';
import { Shell } from '../components/Shell';
import { RsbPanel } from '../components/RsbPanel';
import { colors, fonts } from '../lib/design';

const DURATION = 576; // 8 bars

// Brief chat history (static, dimmed background)
const ChatHistory: React.FC = () => (
  <div style={{ opacity: 0.25, fontFamily: fonts.ui, color: colors.textMuted, fontSize: 14 }}>
    <div style={{ textAlign: 'right', marginBottom: 12 }}>When is the next F1 race?</div>
    <div>📅 Date: Sun, Mar 29 — 1:00 a.m. · 🏎️ Track: Suzuka Circuit</div>
  </div>
);

export const HomeAssistantScene: React.FC = () => {
  return (
    <Shell
      sceneDuration={DURATION}
      chatOpacity={0.4}
      rsbContent={<RsbPanel startFrame={0} />}
    >
      <ChatHistory />
    </Shell>
  );
};
