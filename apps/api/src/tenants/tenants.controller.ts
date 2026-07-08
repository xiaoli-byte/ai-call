import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators.js';
import { CheckQuotaDto } from './dto/check-quota.dto.js';
import { CreateTenantDto } from './dto/create-tenant.dto.js';
import { RecordUsageEventDto } from './dto/record-usage-event.dto.js';
import { SetQuotaPolicyDto } from './dto/set-quota-policy.dto.js';
import { UpdateTenantDto } from './dto/update-tenant.dto.js';
import { UpsertProviderConfigDto } from './dto/upsert-provider-config.dto.js';
import { TenantsService } from './tenants.service.js';

const adminPipe = new ValidationPipe({ transform: true, whitelist: true });

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @Permissions(PERMISSIONS.TENANT_READ)
  list() {
    return this.tenantsService.listTenants();
  }

  @Post()
  @Permissions(PERMISSIONS.TENANT_CREATE)
  @UsePipes(adminPipe)
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.createTenant(dto);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.TENANT_READ)
  get(@Param('id') id: string) {
    return this.tenantsService.getTenant(id);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.TENANT_UPDATE)
  @UsePipes(adminPipe)
  update(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.updateTenant(id, dto);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.TENANT_DELETE)
  delete(@Param('id') id: string) {
    return this.tenantsService.deleteTenant(id);
  }

  @Post(':id/provider-configs')
  @Permissions(PERMISSIONS.TENANT_UPDATE)
  @UsePipes(adminPipe)
  upsertProviderConfig(
    @Param('id') id: string,
    @Body() dto: UpsertProviderConfigDto,
  ) {
    return this.tenantsService.upsertProviderConfig(id, dto);
  }

  @Post(':id/quota-policies')
  @Permissions(PERMISSIONS.TENANT_UPDATE)
  @UsePipes(adminPipe)
  setQuotaPolicy(@Param('id') id: string, @Body() dto: SetQuotaPolicyDto) {
    return this.tenantsService.setQuotaPolicy(id, dto);
  }

  @Post(':id/quota-check')
  @Permissions(PERMISSIONS.TENANT_READ)
  @UsePipes(adminPipe)
  checkQuota(@Param('id') id: string, @Body() dto: CheckQuotaDto) {
    return this.tenantsService.checkQuota({ ...dto, tenantId: id });
  }

  @Post(':id/usage-events')
  @Permissions(PERMISSIONS.TENANT_UPDATE)
  @UsePipes(adminPipe)
  recordUsageEvent(@Param('id') id: string, @Body() dto: RecordUsageEventDto) {
    return this.tenantsService.recordUsageEvent({ ...dto, tenantId: id });
  }
}
