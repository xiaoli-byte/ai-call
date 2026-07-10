import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { FreeSwitchEventWorkerService } from './freeswitch-event-worker.service.js';

@Controller('health')
export class FreeSwitchEventWorkerHealthController {
  constructor(private readonly worker: FreeSwitchEventWorkerService) {}

  @Get('live')
  live(@Res({ passthrough: true }) response: Response) {
    const health = this.worker.health();
    response.status(health.live ? 200 : 503);
    return health;
  }

  @Get()
  ready(@Res({ passthrough: true }) response: Response) {
    return this.readyResponse(response);
  }

  @Get('ready')
  readyPath(@Res({ passthrough: true }) response: Response) {
    return this.readyResponse(response);
  }

  private readyResponse(response: Response) {
    const health = this.worker.health();
    response.status(health.ready ? 200 : 503);
    return health;
  }
}
