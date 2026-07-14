'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Upload } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { appToast } from '@/lib/toast';
import { PERMISSIONS, type KnowledgeTestRetrieveResult } from '@ai-call/shared';
import { usePermission } from '@/hooks/use-permission';

import styles from '../../tasks/tasks.module.scss';

export function KnowledgeActions({ knowledgeBaseId }: { knowledgeBaseId: string }) {
  const router = useRouter();
  const canUpload = usePermission(PERMISSIONS.KNOWLEDGE_CREATE);
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [testing, setTesting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<KnowledgeTestRetrieveResult | null>(null);

  async function runTest() {
    if (!query.trim()) {
      appToast.error('请输入测试问题');
      return;
    }
    setTesting(true);
    try {
      const data = await apiClient.knowledge.testRetrieve(knowledgeBaseId, { query, topK: 3 });
      setResult(data);
    } catch (error) {
      appToast.error(error);
    } finally {
      setTesting(false);
    }
  }

  async function uploadFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      appToast.error('请选择文件');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`/api/knowledge-base/${knowledgeBaseId}/upload`, {
        method: 'POST',
        credentials: 'include',
        body: form,
      });
      if (!response.ok) throw new Error(await response.text());
      appToast.success('文档已上传并索引');
      router.refresh();
    } catch (error) {
      appToast.error(error);
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className={styles.tableShell} style={{ padding: 16 }}>
      <div className={styles.toolbar} style={{ minHeight: 0, alignItems: 'flex-start' }}>
        <div className={styles.search} style={{ width: 'min(520px, 100%)' }}>
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入客户问题测试召回与引用"
          />
        </div>
        <div className={styles.tools}>
          <button type="button" className={styles.primaryButton} onClick={runTest} disabled={testing}>
            <Search size={14} />
            {testing ? '测试中...' : '检索测试'}
          </button>
          <input ref={fileRef} type="file" style={{ display: 'none' }} />
          {canUpload && (
            <button type="button" className={styles.toolButton} onClick={() => fileRef.current?.click()}>
              选择文件
            </button>
          )}
          {canUpload && (
            <button type="button" className={styles.toolButton} onClick={uploadFile} disabled={uploading}>
              <Upload size={14} />
              {uploading ? '上传中...' : '上传文档'}
            </button>
          )}
        </div>
      </div>

      {result ? (
        <div style={{ marginTop: 14 }}>
          <div className="badge-list">
            <span className={result.lowConfidence ? 'badge badge-danger' : 'badge badge-success'}>
              {result.lowConfidence ? '低置信度' : '可解释召回'}
            </span>
            <span className="badge badge-neutral">{result.results.length} 个引用</span>
          </div>
          <p className={styles.creator} style={{ marginTop: 10 }}>{result.answer}</p>
          <div className="tag-list">
            {result.results.map((item) => (
              <span key={item.id} className="badge badge-neutral">
                {item.source} · {Math.round(item.score * 100)}%
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
