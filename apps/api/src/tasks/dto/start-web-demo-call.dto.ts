import { IsUUID } from 'class-validator';

/** 首页匿名模拟外呼请求体：只允许指定流程，其余参数（被叫、通道）由服务端强制 */
export class StartWebDemoCallDto {
  @IsUUID()
  flowId!: string;
}
