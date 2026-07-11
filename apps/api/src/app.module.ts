import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { AuthzModule } from '@xiaoli-byte/authz/nestjs';
import { ScenariosModule } from './scenarios/scenarios.module.js';
import { TasksModule } from './tasks/tasks.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { KnowledgeBaseModule } from './knowledge-base/knowledge-base.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { TaskFlowsModule } from './task-flows/task-flows.module.js';
import { LlmModule } from './llm/llm.module.js';
import { AuthModule } from './auth/auth.module.js';
import { SystemModule } from './system/system.module.js';
import { CallsModule } from './calls/calls.module.js';
import { GlobalConfigModule } from './global-config/global-config.module.js';
import { VoiceClonesModule } from './voice-clones/voice-clones.module.js';
import { CampaignsModule } from './campaigns/campaigns.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { QualityModule } from './quality/quality.module.js';
import { ComplianceModule } from './compliance/compliance.module.js';
import { TenantsModule } from './tenants/tenants.module.js';
import { JWT_SECRET } from './auth/auth.config.js';
import { getRolePermissionMap } from './auth/role-permission-map.store.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { HealthModule } from './health/health.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { HandoffsModule } from './handoffs/handoffs.module.js';
import { ScenarioTestsModule } from './scenario-tests/scenario-tests.module.js';
import { PlatformModule } from './platform/platform.module.js';

@Module({
  imports: [
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    AuthzModule.forRoot({
      accessSecret: JWT_SECRET,
      cookies: {
        refreshCookiePath: '/api/auth/refresh',
        secureOverride:
          process.env.COOKIE_SECURE != null
            ? process.env.COOKIE_SECURE === 'true'
            : undefined,
      },
      rolePermissionMap: getRolePermissionMap,
    }),
    PrismaModule,
    AuthModule,
    LlmModule,
    ScenariosModule,
    TasksModule,
    ToolsModule,
    KnowledgeBaseModule,
    TaskFlowsModule,
    SystemModule,
    CallsModule,
    GlobalConfigModule,
    VoiceClonesModule,
    CampaignsModule,
    AnalyticsModule,
    QualityModule,
    ComplianceModule,
    TenantsModule,
    MetricsModule,
    HealthModule,
    IntegrationsModule,
    HandoffsModule,
    ScenarioTestsModule,
    PlatformModule,
  ],
})
export class AppModule {}
