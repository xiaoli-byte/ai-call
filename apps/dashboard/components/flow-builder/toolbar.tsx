'use client';

import { useReactFlow } from '@xyflow/react';
import { useFlowStore } from './store/flow-store';
import type { SaveStatus } from './hooks/use-flow-storage';

interface ToolbarProps {
  flowName: string;
  onSave: () => void;
  saveStatus: SaveStatus;
}

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  saving: '保存中',
  saved: '已保存',
  error: '保存失败',
};

const STATUS_CLASS: Record<SaveStatus, string> = {
  idle: '',
  saving: 'saving',
  saved: 'saved',
  error: 'error',
};

function SaveStatusBadge({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  return (
    <span className={`flow-editor-status ${STATUS_CLASS[status]}`}>
      <span className="status-dot" />
      {STATUS_TEXT[status]}
    </span>
  );
}

const IconBtn = ({
  onClick,
  disabled,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  title: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="flow-icon-btn"
  >
    {children}
  </button>
);

export function Toolbar({ flowName, onSave, saveStatus }: ToolbarProps) {
  const undo = useFlowStore((s) => s.undo);
  const redo = useFlowStore((s) => s.redo);
  const canUndo = useFlowStore((s) => s.canUndo());
  const canRedo = useFlowStore((s) => s.canRedo());
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <div className="flow-editor-header">
      <div className="flow-editor-header-left">
        <span className="flow-editor-title">{flowName}</span>
        <SaveStatusBadge status={saveStatus} />
      </div>

      <div className="flow-editor-header-right">
        <IconBtn onClick={undo} disabled={!canUndo} title="撤销 (⌘Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
          </svg>
        </IconBtn>
        <IconBtn onClick={redo} disabled={!canRedo} title="重做 (⌘⇧Z)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
          </svg>
        </IconBtn>

        <div className="flow-editor-divider" />

        <IconBtn onClick={() => zoomIn({ duration: 200 })} title="放大">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="11" y1="8" x2="11" y2="14" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </IconBtn>
        <IconBtn onClick={() => zoomOut({ duration: 200 })} title="缩小">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
            <line x1="8" y1="11" x2="14" y2="11" />
          </svg>
        </IconBtn>
        <IconBtn onClick={() => fitView({ duration: 200 })} title="适应画布">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 0 1 2-2h2" />
            <path d="M17 3h2a2 2 0 0 1 2 2v2" />
            <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
            <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
            <path d="M7 9v6M11 9v6M15 9v6M3 9h18" transform="translate(0 3)" />
          </svg>
        </IconBtn>

        <div className="flow-editor-divider" />

        <button type="button" onClick={onSave} className="btn">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          保存
        </button>
      </div>
    </div>
  );
}