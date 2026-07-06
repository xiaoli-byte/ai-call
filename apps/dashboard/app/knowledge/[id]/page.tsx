import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BookOpen, FileText, Search, ShieldAlert } from 'lucide-react';
import { apiServer } from '@/lib/api/server';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/outbound/empty-state';
import { StatusBadge } from '@/components/outbound/status-badge';
import { KnowledgeActions } from './KnowledgeActions';

import styles from '../../tasks/tasks.module.scss';

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';
}

export default async function KnowledgeDetailPage({
  params,
}: {
  params: { id: string };
}) {
  let detail: Awaited<ReturnType<typeof apiServer.knowledge.get>>;
  try {
    detail = await apiServer.knowledge.get(params.id);
  } catch {
    notFound();
  }

  const documents = detail.documents ?? [];
  const indexed = documents.filter((item) => item.indexStatus === 'indexed').length;
  const failed = documents.filter((item) => item.indexStatus === 'failed').length;

  return (
    <div className={cn('outbound-page', styles.page)}>
      <header className={styles.header}>
        <div>
          <Link href="/knowledge" className={styles.toolButton} style={{ marginBottom: 8 }}>
            <ArrowLeft size={14} />
            返回知识库
          </Link>
          <h1>{detail.name}</h1>
          <p>知识库 ID：{detail.id} · 文档 {detail.docs.length}</p>
        </div>
      </header>

      <main className={styles.content}>
        <section className={styles.statGrid}>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>文档数量</span><BookOpen size={16} /></div>
            <strong>{detail.docs.length}</strong>
            <small>包含内置与上传文档</small>
            <p className={styles.muted}>版本绑定候选</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>已索引</span><Search size={16} /></div>
            <strong>{indexed}</strong>
            <small>上传文档索引状态</small>
            <p className={styles.positive}>可检索引用</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>异常文档</span><ShieldAlert size={16} /></div>
            <strong>{failed}</strong>
            <small>解析或索引失败</small>
            <p className={styles.muted}>需运营处理</p>
          </article>
          <article className={styles.statCard}>
            <div className={styles.statLabel}><span>内置片段</span><FileText size={16} /></div>
            <strong>{detail.docs.length - documents.length}</strong>
            <small>Mock/外部服务返回</small>
            <p className={styles.muted}>本地试用可用</p>
          </article>
        </section>

        <KnowledgeActions knowledgeBaseId={detail.id} />

        {documents.length === 0 ? (
          <EmptyState title="暂无上传文档" description="上传后会显示解析、切片、索引状态和版本。" />
        ) : (
          <div className={styles.tableShell}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>文档</th>
                    <th>状态</th>
                    <th>版本</th>
                    <th>切片</th>
                    <th>索引时间</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id}>
                      <td><div className={styles.taskLink}><strong>{doc.filename}</strong><span>{doc.id}</span></div></td>
                      <td><StatusBadge tone={doc.indexStatus === 'indexed' ? 'completed' : doc.indexStatus === 'failed' ? 'failed' : 'pending'}>{doc.indexStatus}</StatusBadge></td>
                      <td>v{doc.version}</td>
                      <td>{doc.chunkCount}</td>
                      <td>{formatDate(doc.indexedAt)}</td>
                      <td className={styles.creator}>{doc.indexError ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
