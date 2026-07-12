'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from 'react';
import type { GlobalVariableConfig } from '@ai-call/shared';
import styles from '../flow-builder.module.scss';

type VariableTextAreaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'onChange'
> & {
  value: string;
  variables: GlobalVariableConfig[];
  onValueChange: (value: string) => void;
};

type NormalizedVariable = GlobalVariableConfig & {
  key: string;
  label: string;
};

type TriggerState = {
  start: number;
  end: number;
  query: string;
};

const VARIABLE_PATTERN = /\$\{(\w+)\}/g;

export function VariableTextArea({
  value,
  variables,
  onValueChange,
  onKeyDown,
  onBlur,
  onFocus,
  placeholder,
  className,
  disabled,
  readOnly,
  rows,
  ...props
}: VariableTextAreaProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastRenderedValueRef = useRef<string | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const normalizedVariables = useMemo(
    () => variables
      .map((item) => {
        const key = item.key.trim();
        return {
          ...item,
          key,
          label: item.label?.trim() || key,
        };
      })
      .filter((item): item is NormalizedVariable => Boolean(item.key)),
    [variables],
  );

  const variableByKey = useMemo(() => {
    const map = new Map<string, NormalizedVariable>();
    for (const variable of normalizedVariables) map.set(variable.key, variable);
    return map;
  }, [normalizedVariables]);

  const candidates = useMemo(() => {
    if (!trigger) return [];
    const query = trigger.query.trim().toLowerCase();
    if (!query) return normalizedVariables;
    return normalizedVariables.filter((item) => (
      item.key.toLowerCase().includes(query)
      || item.label.toLowerCase().includes(query)
    ));
  }, [normalizedVariables, trigger]);

  useEffect(() => {
    if (!editorRef.current || value === lastRenderedValueRef.current) return;
    renderEditorValue(editorRef.current, value, variableByKey);
    lastRenderedValueRef.current = value;
    const pendingCaret = pendingCaretRef.current;
    if (pendingCaret !== null) {
      pendingCaretRef.current = null;
      requestAnimationFrame(() => setCaretOffset(editorRef.current, pendingCaret));
    }
  }, [value, variableByKey]);

  function emitFromEditor() {
    const editor = editorRef.current;
    if (!editor) return;

    const nextValue = serializeEditor(editor);
    const caret = getCaretOffset(editor);
    lastRenderedValueRef.current = nextValue;
    onValueChange(nextValue);
    updateTrigger(nextValue, caret);
  }

  function updateTrigger(nextValue: string, caret: number | null) {
    const nextTrigger = findVariableTrigger(nextValue, caret ?? nextValue.length);
    setTrigger(nextTrigger);
    setActiveIndex(0);
  }

  function insertVariable(variable: NormalizedVariable) {
    if (!trigger || !editorRef.current) return;
    const token = `\${${variable.key}}`;
    const currentValue = serializeEditor(editorRef.current);
    const nextValue = `${currentValue.slice(0, trigger.start)}${token}${currentValue.slice(trigger.end)}`;
    const nextCaret = trigger.start + token.length;

    renderEditorValue(editorRef.current, nextValue, variableByKey);
    lastRenderedValueRef.current = nextValue;
    pendingCaretRef.current = nextCaret;
    onValueChange(nextValue);
    setTrigger(null);
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      setCaretOffset(editorRef.current, nextCaret);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (trigger) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (
          candidates.length ? (index + 1) % candidates.length : 0
        ));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (
          candidates.length ? (index - 1 + candidates.length) % candidates.length : 0
        ));
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && candidates[activeIndex]) {
        event.preventDefault();
        insertVariable(candidates[activeIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setTrigger(null);
        return;
      }
    }

    onKeyDown?.(event as unknown as KeyboardEvent<HTMLTextAreaElement>);
  }

  const ariaLabel = props['aria-label'];
  const ariaLabelledBy = props['aria-labelledby'];
  const ariaDescribedBy = props['aria-describedby'];

  return (
    <div className={styles.flowVariableTextareaWrap}>
      <div
        ref={editorRef}
        id={props.id}
        title={props.title}
        tabIndex={props.tabIndex}
        role="textbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-multiline="true"
        aria-disabled={disabled || undefined}
        contentEditable={!disabled && !readOnly}
        data-placeholder={placeholder}
        className={`${styles.flowTextarea} ${styles.flowVariableEditor} ${className ?? ''}`}
        style={rows ? { minHeight: `${Math.max(rows, 3) * 22}px` } : undefined}
        suppressContentEditableWarning
        onInput={emitFromEditor}
        onKeyDown={handleKeyDown}
        onClick={() => updateTrigger(serializeEditor(editorRef.current), getCaretOffset(editorRef.current))}
        onKeyUp={() => updateTrigger(serializeEditor(editorRef.current), getCaretOffset(editorRef.current))}
        onBlur={(event) => {
          setTrigger(null);
          onBlur?.(event as unknown as FocusEvent<HTMLTextAreaElement>);
        }}
        onFocus={(event) => {
          onFocus?.(event as unknown as FocusEvent<HTMLTextAreaElement>);
        }}
        onPaste={(event) => {
          event.preventDefault();
          const text = event.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />

      {trigger && (
        <div className={styles.flowVariableMenu} role="listbox">
          {candidates.length > 0 ? (
            candidates.map((variable, index) => (
              <button
                key={variable.key}
                type="button"
                className={`${styles.flowVariableMenuItem} ${index === activeIndex ? styles.active : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  insertVariable(variable);
                }}
                role="option"
                aria-selected={index === activeIndex}
              >
                <span className={styles.flowVariableMenuLabel}>
                  {variable.label}
                </span>
                <span className={styles.flowVariableMenuToken}>
                  {`\${${variable.key}}`}
                </span>
              </button>
            ))
          ) : (
            <div className={styles.flowVariableMenuEmpty}>暂无匹配变量</div>
          )}
        </div>
      )}
    </div>
  );
}

function renderEditorValue(
  editor: HTMLDivElement,
  value: string,
  variableByKey: Map<string, NormalizedVariable>,
) {
  editor.replaceChildren();

  let lastIndex = 0;
  for (const match of value.matchAll(VARIABLE_PATTERN)) {
    const token = match[0];
    const key = match[1];
    const index = match.index ?? 0;

    if (index > lastIndex) {
      editor.append(document.createTextNode(value.slice(lastIndex, index)));
    }

    const variable = variableByKey.get(key);
    if (variable) {
      editor.append(createVariableToken(variable));
    } else {
      editor.append(document.createTextNode(token));
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < value.length) {
    editor.append(document.createTextNode(value.slice(lastIndex)));
  }
}

function createVariableToken(variable: NormalizedVariable) {
  const token = document.createElement('span');
  token.className = styles.flowVariableToken;
  token.contentEditable = 'false';
  token.dataset.variableKey = variable.key;
  token.dataset.variableToken = `\${${variable.key}}`;
  token.title = `\${${variable.key}}`;
  token.textContent = variable.label;
  return token;
}

function serializeEditor(editor: HTMLElement | null): string {
  if (!editor) return '';
  return serializeNodes(Array.from(editor.childNodes));
}

function serializeNodes(nodes: ChildNode[]): string {
  let text = '';
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? '';
      continue;
    }

    if (node instanceof HTMLBRElement) {
      text += '\n';
      continue;
    }

    if (!(node instanceof HTMLElement)) continue;

    const token = node.dataset.variableToken;
    if (token) {
      text += token;
      continue;
    }

    const isBlock = node.tagName === 'DIV' || node.tagName === 'P';
    if (isBlock && text && !text.endsWith('\n')) text += '\n';
    text += serializeNodes(Array.from(node.childNodes));
  }
  return text;
}

function getCaretOffset(editor: HTMLElement | null): number | null {
  if (!editor) return null;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return serializeEditor(editor).length;

  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return serializeEditor(editor).length;

  let offset = 0;
  let found = false;

  function walk(node: Node) {
    if (found) return;

    if (node === range.startContainer) {
      if (node.nodeType === Node.TEXT_NODE) {
        offset += range.startOffset;
      } else {
        const children = Array.from(node.childNodes).slice(0, range.startOffset);
        offset += serializeNodes(children).length;
      }
      found = true;
      return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      offset += node.textContent?.length ?? 0;
      return;
    }

    if (node instanceof HTMLElement && node.dataset.variableToken) {
      offset += node.dataset.variableToken.length;
      return;
    }

    for (const child of Array.from(node.childNodes)) walk(child);
  }

  walk(editor);
  return offset;
}

function setCaretOffset(editor: HTMLElement | null, targetOffset: number) {
  if (!editor) return;

  const range = document.createRange();
  const selection = window.getSelection();
  let offset = 0;
  let placed = false;

  function placeAfter(node: Node) {
    range.setStartAfter(node);
    range.collapse(true);
    placed = true;
  }

  function walk(node: Node) {
    if (placed) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0;
      if (targetOffset <= offset + length) {
        range.setStart(node, Math.max(0, targetOffset - offset));
        range.collapse(true);
        placed = true;
        return;
      }
      offset += length;
      return;
    }

    if (node instanceof HTMLElement && node.dataset.variableToken) {
      const length = node.dataset.variableToken.length;
      if (targetOffset <= offset + length) {
        placeAfter(node);
        return;
      }
      offset += length;
      return;
    }

    for (const child of Array.from(node.childNodes)) walk(child);
  }

  walk(editor);
  if (!placed) {
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  selection?.removeAllRanges();
  selection?.addRange(range);
}

function findVariableTrigger(value: string, caret: number): TriggerState | null {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.lastIndexOf('$');
  if (start < 0) return null;

  const query = beforeCaret.slice(start + 1);
  if (query.includes('}') || /[\s]/.test(query)) return null;

  return {
    start,
    end: caret,
    query,
  };
}
