import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

/**
 * 业务工具 Service - 提供 Function Calling 后端实现
 *
 * 这些方法对应 Voice Agent 在通话中可调用的 tools：
 *  - 催收场景：query_repayment_info / calculate_penalty / create_extension_request
 *  - 电商场景：query_order / query_refund_status / create_pickup_appointment / create_after_sale_ticket
 *  - 售前场景：query_car_model / query_activity / create_test_drive_appointment
 *  - 通用：transfer_to_human
 *
 * 当前返回 Mock 数据，真实接入时改为查询数据库/调用外部业务系统。
 * 每个方法返回的数据会作为 ToolResult.result 注入 LLM 上下文。
 */
@Injectable()
export class ToolsService {
  /** ===== 催收场景 ===== */

  queryRepaymentInfo(_args: { customerId?: string }) {
    return {
      customerName: '张**',
      product: '消费贷-优享版',
      principal: 5000.0,
      interest: 145.83,
      penalty: 12.5,
      totalDue: 5158.33,
      dueDate: '2026-06-28',
      overdueDays: 0,
    };
  }

  calculatePenalty(args: { overdueDays: number; principal: number }) {
    const dailyRate = 0.0005; // 日罚息率 0.05%
    const penalty = args.principal * dailyRate * args.overdueDays;
    return { penalty: Number(penalty.toFixed(2)), dailyRate };
  }

  createExtensionRequest(args: { reason: string; customerId?: string }) {
    return {
      ticketId: `EXT-${randomUUID().slice(0, 8).toUpperCase()}`,
      status: 'pending_review',
      message: '已创建延期申请，专员将在 24 小时内联系您确认。',
    };
  }

  /** ===== 电商场景 ===== */

  queryOrder(args: { orderNo: string }) {
    return {
      orderNo: args.orderNo,
      status: 'shipping',
      carrier: '顺丰速运',
      trackingNo: 'SF1234567890',
      estimatedArrival: '2026-06-28 下午',
      items: [
        { name: '商品 A', qty: 1, price: 199.0 },
      ],
    };
  }

  queryRefundStatus(args: { orderNo: string }) {
    return {
      orderNo: args.orderNo,
      refundStatus: 'processing',
      refundAmount: 199.0,
      estimatedTime: '1-3 个工作日',
      channel: '原路退回',
    };
  }

  createPickupAppointment(args: {
    orderNo: string;
    date: string;
    timeSlot: string;
    address?: string;
  }) {
    return {
      appointmentId: `PKP-${randomUUID().slice(0, 8).toUpperCase()}`,
      orderNo: args.orderNo,
      date: args.date,
      timeSlot: args.timeSlot,
      message: `已为您预约 ${args.date} ${args.timeSlot} 上门取件，快递员会提前电话确认。`,
    };
  }

  createAfterSaleTicket(args: {
    orderNo: string;
    issueType: string;
    description: string;
  }) {
    return {
      ticketId: `AST-${randomUUID().slice(0, 8).toUpperCase()}`,
      orderNo: args.orderNo,
      issueType: args.issueType,
      status: 'open',
      message: `已为您创建售后工单，专员将在 4 小时内联系您。`,
    };
  }

  /** ===== 售前场景 ===== */

  queryCarModel(args: { model?: string }) {
    const models: Record<string, unknown> = {
      'Model S': {
        name: 'Model S 长续航版',
        range: '715km',
        acceleration: '3.2s (0-100km/h)',
        highlights: ['全轮驱动', 'Autopilot 辅助驾驶', '17 寸中控屏'],
      },
      'Model 3': {
        name: 'Model 3 标准续航版',
        range: '556km',
        acceleration: '6.1s (0-100km/h)',
        highlights: ['后轮驱动', '基础辅助驾驶', '15 寸中控屏'],
      },
    };
    return models[args.model ?? 'Model 3'] ?? models['Model 3'];
  }

  queryActivity(args: { activityId?: string }) {
    return {
      activityId: args.activityId ?? 'summer-test-drive',
      name: '夏日试驾季',
      period: '2026-06-15 至 2026-07-31',
      benefits: [
        '到店试驾赠送精美礼品一份',
        '当日订车额外赠送 5,000 元改装基金',
        '金融方案 0 首付 24 期免息',
      ],
      storeAddress: '上海市浦东新区 XX 路 88 号',
    };
  }

  createTestDriveAppointment(args: {
    customerName: string;
    phone: string;
    date: string;
    timeSlot: string;
    model?: string;
  }) {
    return {
      appointmentId: `TSD-${randomUUID().slice(0, 8).toUpperCase()}`,
      customerName: args.customerName,
      date: args.date,
      timeSlot: args.timeSlot,
      model: args.model ?? 'Model 3',
      message: `已为您预约 ${args.date} ${args.timeSlot} 试驾 ${args.model ?? 'Model 3'}，门店地址：上海市浦东新区 XX 路 88 号。请携带驾驶证到场。`,
    };
  }

  /** ===== 通用 ===== */

  transferToHuman(args: { reason: string }) {
    return {
      transferred: true,
      reason: args.reason,
      queuePosition: 3,
      estimatedWaitTime: '约 2 分钟',
      message: '正在为您转接人工专员，请稍候。',
    };
  }
}
