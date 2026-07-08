import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS, ROLE_TEMPLATES } from '@ai-call/shared';
import { PERMISSIONS_KEY } from '@xiaoli-byte/authz/nestjs';
import { HandoffsController } from './handoffs/handoffs.controller.js';
import { IntegrationsController } from './integrations/integrations.controller.js';
import { ScenarioTestsController } from './scenario-tests/scenario-tests.controller.js';
import { CampaignsController } from './campaigns/campaigns.controller.js';
import { QualityController } from './quality/quality.controller.js';
import { ComplianceController } from './compliance/compliance.controller.js';
import { AnalyticsController } from './analytics/analytics.controller.js';
import { TenantsController } from './tenants/tenants.controller.js';
import { PlatformController } from './platform/platform.controller.js';

function assertPermissions(target: object | Function, expected: unknown[]) {
  assert.deepEqual(Reflect.getMetadata(PERMISSIONS_KEY, target), expected);
}

describe('product module permission metadata', () => {
  it('keeps integration endpoints under task permissions', () => {
    assertPermissions(IntegrationsController, [PERMISSIONS.TASK_READ]);
    assertPermissions(IntegrationsController.prototype.create, [PERMISSIONS.TASK_UPDATE]);
    assertPermissions(IntegrationsController.prototype.test, [PERMISSIONS.TASK_UPDATE]);
  });

  it('keeps handoff endpoints under call and task permissions', () => {
    assertPermissions(HandoffsController, [PERMISSIONS.CALL_READ]);
    assertPermissions(HandoffsController.prototype.createFromAnalysis, [PERMISSIONS.CALL_READ]);
    assertPermissions(HandoffsController.prototype.update, [PERMISSIONS.TASK_UPDATE]);
    assertPermissions(HandoffsController.prototype.createCallback, [PERMISSIONS.TASK_CREATE]);
  });

  it('keeps scenario test endpoints under flow permissions', () => {
    assertPermissions(ScenarioTestsController, [PERMISSIONS.FLOW_READ]);
    assertPermissions(ScenarioTestsController.prototype.run, [PERMISSIONS.FLOW_UPDATE]);
  });
});

// CALL-04：以下模块「去贴标签」，各自持有 call:{module}:{action} 码，不再借用其它模块权限。
describe('CALL-04 de-labeled module permission metadata', () => {
  it('campaigns owns call:campaign:*', () => {
    assertPermissions(CampaignsController.prototype.list, [PERMISSIONS.CAMPAIGN_READ]);
    assertPermissions(CampaignsController.prototype.get, [PERMISSIONS.CAMPAIGN_READ]);
    assertPermissions(CampaignsController.prototype.simulateStrategy, [PERMISSIONS.CAMPAIGN_READ]);
    assertPermissions(CampaignsController.prototype.create, [PERMISSIONS.CAMPAIGN_CREATE]);
    assertPermissions(CampaignsController.prototype.updateStatus, [PERMISSIONS.CAMPAIGN_UPDATE]);
  });

  it('quality owns call:quality:read', () => {
    assertPermissions(QualityController.prototype.list, [PERMISSIONS.QUALITY_READ]);
    assertPermissions(QualityController.prototype.analyze, [PERMISSIONS.QUALITY_READ]);
    assertPermissions(QualityController.prototype.correct, [PERMISSIONS.QUALITY_READ]);
  });

  it('compliance owns call:compliance:*', () => {
    assertPermissions(ComplianceController.prototype.getPolicy, [PERMISSIONS.COMPLIANCE_READ]);
    assertPermissions(ComplianceController.prototype.listAuditLogs, [PERMISSIONS.COMPLIANCE_READ]);
    assertPermissions(ComplianceController.prototype.updatePolicy, [PERMISSIONS.COMPLIANCE_UPDATE]);
  });

  it('analytics owns call:analytics:read', () => {
    assertPermissions(AnalyticsController.prototype.overview, [PERMISSIONS.ANALYTICS_READ]);
  });

  it('tenants owns call:tenant:*', () => {
    assertPermissions(TenantsController.prototype.list, [PERMISSIONS.TENANT_READ]);
    assertPermissions(TenantsController.prototype.get, [PERMISSIONS.TENANT_READ]);
    assertPermissions(TenantsController.prototype.checkQuota, [PERMISSIONS.TENANT_READ]);
    assertPermissions(TenantsController.prototype.create, [PERMISSIONS.TENANT_CREATE]);
    assertPermissions(TenantsController.prototype.update, [PERMISSIONS.TENANT_UPDATE]);
    assertPermissions(TenantsController.prototype.upsertProviderConfig, [PERMISSIONS.TENANT_UPDATE]);
    assertPermissions(TenantsController.prototype.setQuotaPolicy, [PERMISSIONS.TENANT_UPDATE]);
    assertPermissions(TenantsController.prototype.recordUsageEvent, [PERMISSIONS.TENANT_UPDATE]);
    assertPermissions(TenantsController.prototype.delete, [PERMISSIONS.TENANT_DELETE]);
  });

  it('platform owns call:platform:* (admin-only)', () => {
    assertPermissions(PlatformController.prototype.observability, [PERMISSIONS.PLATFORM_READ]);
    assertPermissions(PlatformController.prototype.costs, [PERMISSIONS.PLATFORM_READ]);
    assertPermissions(PlatformController.prototype.templates, [PERMISSIONS.PLATFORM_READ]);
    assertPermissions(PlatformController.prototype.organizations, [PERMISSIONS.PLATFORM_READ]);
    assertPermissions(PlatformController.prototype.datasets, [PERMISSIONS.PLATFORM_READ]);
    assertPermissions(PlatformController.prototype.demoGuide, [PERMISSIONS.PLATFORM_READ]);
    assertPermissions(PlatformController.prototype.cloneTemplate, [PERMISSIONS.PLATFORM_CREATE]);
  });
});

describe('CALL-04 role visibility', () => {
  const operator = ROLE_TEMPLATES.operator.permissions as readonly string[];
  const viewer = ROLE_TEMPLATES.viewer.permissions as readonly string[];
  const admin = ROLE_TEMPLATES.admin.permissions as readonly string[];

  it('operator keeps business-module read+write, minus tenant/platform', () => {
    for (const code of [
      PERMISSIONS.CAMPAIGN_READ,
      PERMISSIONS.CAMPAIGN_CREATE,
      PERMISSIONS.CAMPAIGN_UPDATE,
      PERMISSIONS.QUALITY_READ,
      PERMISSIONS.COMPLIANCE_READ,
      PERMISSIONS.COMPLIANCE_UPDATE,
      PERMISSIONS.ANALYTICS_READ,
    ]) {
      assert.ok(operator.includes(code), `operator should have ${code}`);
    }
    for (const code of [
      PERMISSIONS.TENANT_READ,
      PERMISSIONS.PLATFORM_READ,
      PERMISSIONS.PLATFORM_CREATE,
    ]) {
      assert.ok(!operator.includes(code), `operator must NOT have ${code}`);
    }
  });

  it('viewer keeps business-module read only', () => {
    for (const code of [
      PERMISSIONS.CAMPAIGN_READ,
      PERMISSIONS.QUALITY_READ,
      PERMISSIONS.COMPLIANCE_READ,
      PERMISSIONS.ANALYTICS_READ,
    ]) {
      assert.ok(viewer.includes(code), `viewer should have ${code}`);
    }
    for (const code of [
      PERMISSIONS.CAMPAIGN_CREATE,
      PERMISSIONS.CAMPAIGN_UPDATE,
      PERMISSIONS.COMPLIANCE_UPDATE,
      PERMISSIONS.TENANT_READ,
      PERMISSIONS.PLATFORM_READ,
    ]) {
      assert.ok(!viewer.includes(code), `viewer must NOT have ${code}`);
    }
  });

  it('admin (ALL_PERMISSIONS) covers tenant + platform codes', () => {
    for (const code of [
      PERMISSIONS.TENANT_READ,
      PERMISSIONS.TENANT_CREATE,
      PERMISSIONS.TENANT_UPDATE,
      PERMISSIONS.TENANT_DELETE,
      PERMISSIONS.PLATFORM_READ,
      PERMISSIONS.PLATFORM_CREATE,
    ]) {
      assert.ok(admin.includes(code), `admin should have ${code}`);
    }
  });
});
