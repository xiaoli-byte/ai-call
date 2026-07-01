'use client';

import { useState, useRef, useEffect } from 'react';
import { AddMenu } from './add-menu';
import { useFlowStore } from './store/flow-store';
import type { FlowNodeType } from '@ai-call/shared';
import styles from './flow-builder.module.scss';

interface AddButtonProps {
  afterNodeId: string;
}

/**
 * + 号按钮 — 浅色 SaaS 风格
 *
 * 显示在节点出口处，点击弹出 AddMenu 选择节点类型插入。
 */
export function AddButton({ afterNodeId }: AddButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const addNode = useFlowStore((s) => s.addNode);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative flex items-center justify-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={styles.flowAddBtn}
        aria-label="添加节点"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {open && (
        <AddMenu
          afterNodeId={afterNodeId}
          onSelect={(type: FlowNodeType) => {
            addNode(afterNodeId, type);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}