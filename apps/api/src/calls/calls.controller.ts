import { Controller, Get, Param, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { PERMISSIONS } from '@ai-call/shared';
import { Permissions } from '../auth/decorators/permissions.decorator.js';
import { CallsService } from './calls.service.js';
import { ListCallsDto } from './dto/list-calls.dto.js';

@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  @Permissions(PERMISSIONS.CALL_READ)
  @UsePipes(new ValidationPipe({ transform: true }))
  list(@Query() query: ListCallsDto) {
    return this.callsService.list(query);
  }

  @Get(':id')
  @Permissions(PERMISSIONS.CALL_READ)
  get(@Param('id') id: string) {
    return this.callsService.get(id);
  }
}
