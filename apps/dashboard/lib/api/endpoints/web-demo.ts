import type { HttpAdapter } from '../types';

/** 首页匿名模拟外呼的公开流程条目（服务端已裁剪，不含流程定义） */
export interface WebDemoFlow {
  id: string;
  name: string;
  scenario: string | null;
}

/** POST /web-demo/calls 响应：attemptId 作为 WS 首帧 dialog_id */
export interface WebDemoCallResult {
  taskId: string;
  attemptId: string;
  status: string;
}

/** 首页匿名体验端点：无需登录（后端 @Public） */
export function webDemoEndpoints(http: HttpAdapter) {
  return {
    flows: () => http.request<WebDemoFlow[]>('/web-demo/flows'),
    startCall: (flowId: string) =>
      http.request<WebDemoCallResult>('/web-demo/calls', {
        method: 'POST',
        body: { flowId },
      }),
  };
}
