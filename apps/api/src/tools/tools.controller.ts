import { Body, Controller, Post } from '@nestjs/common';
import { ToolsService } from './tools.service.js';
import { Public } from '../auth/decorators/public.decorator.js';

/**
 * 业务工具 Controller - Voice Agent Function Calling 的后端实现
 *
 * Voice Agent 在 LLM 触发 tool_call 时，会通过 HTTP 调用对应的 endpoint，
 * 拿到结果后注入对话上下文让 LLM 继续回复。
 *
 * 路由约定：POST /api/tools/{tool_name}
 * 请求体：{ ...arguments }
 * 响应体：{ result: ... , shouldEscalate?: boolean }
 *
 * 这种"工具即 HTTP 接口"的设计便于：
 *  - 工具实现独立于 Voice Agent，可被其他系统复用
 *  - 工具签名通过 OpenAPI 暴露，便于 LLM 网关动态注册
 *  - 与现有业务系统集成成本低
 */
@Controller('tools')
@Public()
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  // ===== 催收场景 =====
  @Post('query_repayment_info')
  queryRepaymentInfo(@Body() body: { customerId?: string }) {
    return { result: this.toolsService.queryRepaymentInfo(body) };
  }

  @Post('calculate_penalty')
  calculatePenalty(@Body() body: { overdueDays: number; principal: number }) {
    return { result: this.toolsService.calculatePenalty(body) };
  }

  @Post('create_extension_request')
  createExtensionRequest(@Body() body: { reason: string; customerId?: string }) {
    return {
      result: this.toolsService.createExtensionRequest(body),
      shouldEscalate: true, // 延期申请需转人工
    };
  }

  // ===== 电商场景 =====
  @Post('query_order')
  queryOrder(@Body() body: { orderNo: string }) {
    return { result: this.toolsService.queryOrder(body) };
  }

  @Post('query_refund_status')
  queryRefundStatus(@Body() body: { orderNo: string }) {
    return { result: this.toolsService.queryRefundStatus(body) };
  }

  @Post('create_pickup_appointment')
  createPickupAppointment(@Body() body: {
    orderNo: string;
    date: string;
    timeSlot: string;
    address?: string;
  }) {
    return { result: this.toolsService.createPickupAppointment(body) };
  }

  @Post('create_after_sale_ticket')
  createAfterSaleTicket(@Body() body: {
    orderNo: string;
    issueType: string;
    description: string;
  }) {
    return {
      result: this.toolsService.createAfterSaleTicket(body),
      shouldEscalate: true, // 售后工单转专员跟进
    };
  }

  // ===== 售前场景 =====
  @Post('query_car_model')
  queryCarModel(@Body() body: { model?: string }) {
    return { result: this.toolsService.queryCarModel(body) };
  }

  @Post('query_activity')
  queryActivity(@Body() body: { activityId?: string }) {
    return { result: this.toolsService.queryActivity(body) };
  }

  @Post('create_test_drive_appointment')
  createTestDriveAppointment(@Body() body: {
    customerName: string;
    phone: string;
    date: string;
    timeSlot: string;
    model?: string;
  }) {
    return { result: this.toolsService.createTestDriveAppointment(body) };
  }

  // ===== 通用 =====
  @Post('transfer_to_human')
  transferToHuman(@Body() body: { reason: string }) {
    return {
      result: this.toolsService.transferToHuman(body),
      shouldEscalate: true,
    };
  }
}
