import { Module } from '@nestjs/common';
import { FreeSwitchService } from './freeswitch.service.js';

/**
 * FreeSWITCH 模块 - 封装 ESL 通话控制能力
 *
 * 提供 originate / hangup / transfer 等操作，
 * 被 TasksModule 用于派发外呼任务。
 */
@Module({
  providers: [FreeSwitchService],
  exports: [FreeSwitchService],
})
export class FreeSwitchModule {}
