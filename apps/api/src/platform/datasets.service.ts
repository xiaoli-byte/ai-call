import { Injectable } from '@nestjs/common';
import type {
  DatasetOverview,
  DatasetSample,
  InsightBucket,
  OptimizationSuggestion,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { rate, toIso } from './platform-utils.js';

@Injectable()
export class DatasetsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<DatasetOverview> {
    const [analyses, retrievalLogs] = await Promise.all([
      (this.prisma as any).callAnalysis.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      (this.prisma as any).knowledgeRetrievalLog.findMany({
        where: { lowConfidence: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    const samples: DatasetSample[] = analyses.slice(0, 20).map((item: any) => ({
      id: item.id,
      callAttemptId: item.callAttemptId,
      taskId: item.taskId,
      summary: item.summary,
      intent: item.intent,
      refusalReason: item.refusalReason ?? undefined,
      outcome: item.outcome ?? undefined,
      riskLevel: item.riskLevel,
      confidence: Number(item.confidence ?? 0),
      createdAt: toIso(item.createdAt),
    }));
    const topRefusalReasons = bucketFromValues(
      analyses.map((item: any) => item.refusalReason).filter(Boolean),
    );
    const riskDistribution = bucketFromValues(
      analyses.map((item: any) => item.riskLevel || 'unknown'),
    );
    const lowConfidenceQuestions = bucketFromValues(
      retrievalLogs.map((item: any) => String(item.query ?? '').trim()).filter(Boolean),
    ).slice(0, 8);

    return {
      generatedAt: new Date().toISOString(),
      sampleCount: analyses.length,
      labeledSampleCount: analyses.filter((item: any) => item.correctedAt || item.correctedBy).length,
      topRefusalReasons,
      lowConfidenceQuestions,
      riskDistribution,
      samples,
      suggestions: buildOptimizationSuggestions(analyses, topRefusalReasons, lowConfidenceQuestions, riskDistribution),
    };
  }
}

function buildOptimizationSuggestions(
  analyses: any[],
  refusalReasons: InsightBucket[],
  lowConfidenceQuestions: InsightBucket[],
  risks: InsightBucket[],
): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = [];
  const topRefusal = refusalReasons[0];
  if (topRefusal) {
    suggestions.push({
      id: 'top-refusal-script',
      priority: topRefusal.rate >= 30 ? 'high' : 'medium',
      title: `Address ${topRefusal.label} earlier in the script`,
      description: 'Add an early objection-handling branch and a concise proof point before asking for commitment.',
      evidence: `${topRefusal.count} calls mention this refusal reason (${topRefusal.rate}%).`,
      targetModule: 'script',
    });
  }
  if (lowConfidenceQuestions.length > 0) {
    suggestions.push({
      id: 'knowledge-low-confidence',
      priority: 'high',
      title: 'Patch low-confidence knowledge gaps',
      description: 'Create or refresh knowledge articles for repeated low-confidence retrieval queries.',
      evidence: `${lowConfidenceQuestions.length} recurring low-confidence query buckets were detected.`,
      targetModule: 'knowledge',
    });
  }
  const highRisk = risks.find((item) => item.label === 'high');
  if (highRisk) {
    suggestions.push({
      id: 'compliance-high-risk',
      priority: 'high',
      title: 'Review high-risk call samples',
      description: 'Route high-risk samples into manual QA and tighten disclosure or refusal-stop rules.',
      evidence: `${highRisk.count} high-risk analyses in the current sample window.`,
      targetModule: 'compliance',
    });
  }
  const lowConfidenceAnalyses = analyses.filter((item: any) => Number(item.confidence ?? 0) > 0 && Number(item.confidence ?? 0) < 0.6);
  if (lowConfidenceAnalyses.length > 0) {
    suggestions.push({
      id: 'flow-low-confidence',
      priority: 'medium',
      title: 'Add fallback branches for ambiguous intent',
      description: 'When post-call confidence is low, introduce clarification prompts and handoff thresholds.',
      evidence: `${lowConfidenceAnalyses.length} analyses have confidence below 0.6.`,
      targetModule: 'flow',
    });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      id: 'dataset-bootstrap',
      priority: 'low',
      title: 'Collect more labeled samples',
      description: 'Run more calls or correct QA labels to unlock stronger optimization recommendations.',
      evidence: 'No strong pattern has emerged in the current sample window.',
      targetModule: 'flow',
    });
  }
  return suggestions;
}

function bucketFromValues(values: string[]): InsightBucket[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim() || 'unknown';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, rate: rate(count, total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 10);
}
