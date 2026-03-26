import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { colors, fonts, glass } from '../lib/design';

export interface NoteCard {
  title: string;
  body?: string;
  deadline?: string;
  isNew?: boolean;
  /** Scene-relative frame when this card appears */
  appearFrame: number;
}

interface NotesPanelProps {
  /** Scene-relative frame when panel slides up */
  startFrame: number;
  notes: NoteCard[];
}

export const NotesPanel: React.FC<NotesPanelProps> = ({ startFrame, notes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = Math.max(0, frame - startFrame);

  const slideProgress = spring({ frame: localFrame, fps, config: { damping: 22, stiffness: 130 } });
  const translateY = interpolate(slideProgress, [0, 1], [80, 0]);
  const panelOpacity = interpolate(localFrame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 20,
    }}>
      {/* Backdrop */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        opacity: panelOpacity,
      }} />

      {/* Panel */}
      <div style={{
        position: 'relative',
        transform: `translateY(${translateY}px)`,
        opacity: panelOpacity,
        width: 820, minHeight: 280,
        ...glass,
        background: 'rgba(10,10,14,0.92)',
        border: `1px solid ${colors.borderHighlight}`,
        borderRadius: 16,
        padding: 24,
        fontFamily: fonts.ui,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 20,
        }}>
          <h2 style={{ color: colors.text, fontSize: 18, fontWeight: 600, margin: 0 }}>Notes</h2>
          <div style={{ color: colors.textDim, fontSize: 18, cursor: 'default' }}>×</div>
        </div>

        {/* Card grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {/* Add a note placeholder */}
          <div style={{
            border: `1px dashed ${colors.border}`,
            borderRadius: 10, padding: 12, minHeight: 80,
            display: 'flex', alignItems: 'flex-start',
          }}>
            <span style={{ color: colors.textDim, fontSize: 12 }}>Add a note…</span>
          </div>

          {notes.map((note, i) => {
            const noteLocalFrame = Math.max(0, localFrame - note.appearFrame);
            const noteProgress = spring({
              frame: noteLocalFrame,
              fps,
              config: { damping: 18, stiffness: 160 },
            });
            const noteScale = interpolate(noteProgress, [0, 1], [0.85, 1.0]);
            const noteOpacity = interpolate(noteLocalFrame, [0, 8], [0, 1], { extrapolateRight: 'clamp' });

            return (
              <div key={i} style={{
                transform: `scale(${noteScale})`,
                opacity: noteOpacity,
                background: note.isNew ? 'rgba(59,130,246,0.12)' : 'rgba(30,30,36,0.8)',
                border: `1px solid ${note.isNew ? 'rgba(59,130,246,0.3)' : colors.border}`,
                borderRadius: 10, padding: '10px 12px', minHeight: 80,
              }}>
                <div style={{ color: colors.text, fontSize: 12, lineHeight: 1.6 }}>
                  {note.title}
                </div>
                {note.body && (
                  <div style={{ color: colors.textMuted, fontSize: 11, marginTop: 4, lineHeight: 1.5 }}>
                    {note.body}
                  </div>
                )}
                {note.deadline && (
                  <div style={{
                    marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'rgba(245,158,11,0.15)',
                    border: '1px solid rgba(245,158,11,0.3)',
                    borderRadius: 4, padding: '2px 6px',
                    color: colors.amber, fontSize: 10,
                  }}>
                    🕐 {note.deadline}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
