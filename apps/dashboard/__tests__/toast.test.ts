/**
 * appToast（lib/toast.ts）防刷屏逻辑单元测试
 *
 * mock 掉 sonner 的 toast，只验证 appToast 内部的编排逻辑本身：
 * 自动消失时长 / 同屏最多 3 条丢最旧 / 相同文案去重窗口。
 * 每个用例前用 vi.resetModules() 重新动态 import，避免模块级状态
 * （activeToastIds / recentMessages）跨用例互相污染。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  dismiss: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: mocks.success,
    error: mocks.error,
    info: mocks.info,
    dismiss: mocks.dismiss,
  },
}));

describe('appToast 防刷屏', () => {
  let appToast: typeof import('../lib/toast').appToast;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.resetModules();
    ({ appToast } = await import('../lib/toast'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('每条 toast 都设置 4 秒自动消失时长', () => {
    appToast.success('操作成功');

    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.success.mock.calls[0][1]).toMatchObject({ duration: 4000 });
  });

  it('error 会从 ApiError/Error/未知错误中提取文案', () => {
    appToast.error(new Error('保存失败'));
    appToast.error('纯字符串不算 Error，走兜底文案');

    expect(mocks.error).toHaveBeenNthCalledWith(1, '保存失败', expect.anything());
    expect(mocks.error).toHaveBeenNthCalledWith(2, '操作失败', expect.anything());
  });

  it('2 秒去重窗口内重复触发相同类型+文案会被忽略', () => {
    appToast.error(new Error('没有权限执行此操作'));
    appToast.error(new Error('没有权限执行此操作'));
    appToast.error(new Error('没有权限执行此操作'));

    expect(mocks.error).toHaveBeenCalledTimes(1);
  });

  it('超过去重窗口后，相同文案可以再次触发', () => {
    appToast.error(new Error('没有权限执行此操作'));
    vi.advanceTimersByTime(2000);
    appToast.error(new Error('没有权限执行此操作'));

    expect(mocks.error).toHaveBeenCalledTimes(2);
  });

  it('不同类型即使文案相同也不会互相去重', () => {
    appToast.success('已完成');
    appToast.info('已完成');

    expect(mocks.success).toHaveBeenCalledTimes(1);
    expect(mocks.info).toHaveBeenCalledTimes(1);
  });

  it('同屏超过 3 条时丢弃最旧的一条', () => {
    appToast.success('提示一');
    appToast.success('提示二');
    appToast.success('提示三');
    const firstId = mocks.success.mock.calls[0][1].id;

    appToast.success('提示四');

    expect(mocks.success).toHaveBeenCalledTimes(4);
    expect(mocks.dismiss).toHaveBeenCalledTimes(1);
    expect(mocks.dismiss).toHaveBeenCalledWith(firstId);
  });

  it('toast 关闭回调触发后释放名额，未占满 3 条时不会丢弃', () => {
    appToast.success('提示一');
    const { onAutoClose } = mocks.success.mock.calls[0][1];
    onAutoClose();

    appToast.success('提示二');
    appToast.success('提示三');

    expect(mocks.dismiss).not.toHaveBeenCalled();
  });
});
