import { Injectable } from '@nestjs/common';
import type {
  DemoGuideOverview,
  DemoGuideStep,
  PlatformHealthCheck,
} from '@ai-call/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthChecksService } from './health-checks.service.js';

@Injectable()
export class DemoGuideService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly healthChecks: HealthChecksService,
  ) {}

  async getOverview(): Promise<DemoGuideOverview> {
    const [sampleData, healthChecks] = await Promise.all([
      this.countDemoData(),
      this.healthChecks.getPlatformHealthChecks(),
    ]);
    const steps = buildDemoSteps(sampleData, healthChecks);
    const readinessScore = Math.round((steps.filter((step) => step.status === 'ready').length / steps.length) * 100);
    return {
      generatedAt: new Date().toISOString(),
      readinessScore,
      steps,
      healthChecks,
      sampleData,
      resetCommand: 'pnpm demo:init',
    };
  }

  private async countDemoData(): Promise<DemoGuideOverview['sampleData']> {
    const [scenarios, flows, campaigns, tasks, analyses] = await Promise.all([
      (this.prisma as any).outboundScenario.count(),
      (this.prisma as any).taskFlow.count(),
      (this.prisma as any).campaign.count(),
      (this.prisma as any).outboundTask.count(),
      (this.prisma as any).callAnalysis.count(),
    ]);
    return { scenarios, flows, campaigns, tasks, analyses };
  }
}

function buildDemoSteps(
  sample: DemoGuideOverview['sampleData'],
  healthChecks: PlatformHealthCheck[],
): DemoGuideStep[] {
  const hasBlockingHealth = healthChecks.some((item) => item.status === 'down');
  return [
    {
      id: 'seed',
      title: 'Sample data',
      status: sample.scenarios > 0 && sample.flows > 0 && sample.tasks > 0 ? 'ready' : 'warning',
      description: `${sample.scenarios} scenarios, ${sample.flows} flows, ${sample.tasks} tasks are available.`,
      action: sample.tasks > 0 ? undefined : 'Run pnpm demo:init to seed the local demo.',
    },
    {
      id: 'template',
      title: 'Clone a template',
      status: 'ready',
      description: 'Use Template Center to generate an editable scenario and published flow.',
      href: '/templates',
    },
    {
      id: 'campaign',
      title: 'Create an outbound campaign',
      status: sample.campaigns > 0 ? 'ready' : 'warning',
      description: `${sample.campaigns} campaigns exist in the workspace.`,
      href: '/campaigns/new',
    },
    {
      id: 'runtime',
      title: 'Runtime health',
      status: hasBlockingHealth ? 'blocked' : 'ready',
      description: hasBlockingHealth
        ? 'One or more runtime dependencies are unreachable.'
        : 'Core runtime checks are not blocking the demo.',
      href: '/observability',
    },
    {
      id: 'results',
      title: 'Review results and insights',
      status: sample.analyses > 0 ? 'ready' : 'warning',
      description: `${sample.analyses} post-call analyses are available for QA and dataset insights.`,
      href: '/datasets',
    },
  ];
}
