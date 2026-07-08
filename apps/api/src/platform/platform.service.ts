import { Injectable } from '@nestjs/common';
import type {
  CloneTemplateDto,
  CloneTemplateResult,
  CostOverview,
  DatasetOverview,
  DemoGuideOverview,
  IndustryTemplate,
  ObservabilityOverview,
  OrganizationsOverview,
  PlatformQueryDto,
} from '@ai-call/shared';
import { CostsService } from './costs.service.js';
import { DatasetsService } from './datasets.service.js';
import { DemoGuideService } from './demo-guide.service.js';
import { ObservabilityService } from './observability.service.js';
import { OrganizationsService } from './organizations.service.js';
import { TemplatesService } from './templates.service.js';

@Injectable()
export class PlatformService {
  constructor(
    private readonly observability: ObservabilityService,
    private readonly costs: CostsService,
    private readonly templates: TemplatesService,
    private readonly organizations: OrganizationsService,
    private readonly datasets: DatasetsService,
    private readonly demoGuide: DemoGuideService,
  ) {}

  getObservabilityOverview(query: PlatformQueryDto = {}): Promise<ObservabilityOverview> {
    return this.observability.getOverview(query);
  }

  getCostOverview(query: PlatformQueryDto = {}): Promise<CostOverview> {
    return this.costs.getOverview(query);
  }

  listTemplates(): IndustryTemplate[] {
    return this.templates.listTemplates();
  }

  cloneTemplate(id: string, dto: CloneTemplateDto = {}): Promise<CloneTemplateResult> {
    return this.templates.cloneTemplate(id, dto);
  }

  getOrganizationsOverview(): Promise<OrganizationsOverview> {
    return this.organizations.getOverview();
  }

  getDatasetOverview(): Promise<DatasetOverview> {
    return this.datasets.getOverview();
  }

  getDemoGuide(): Promise<DemoGuideOverview> {
    return this.demoGuide.getOverview();
  }
}
