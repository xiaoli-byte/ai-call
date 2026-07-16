import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateScenarioDto } from './create-scenario.dto.js';
import { UpdateScenarioDto } from './update-scenario.dto.js';

describe('CreateScenarioDto dialogRepair 校验', () => {
  it('接受合法的对话修复话术配置（natural 模式）', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: {
        noInputPrompt: '抱歉，我没有听到您的回答。{question}',
        sideQuestionBridge: 'natural',
      },
    }));
    assert.equal(errors.length, 0);
  });

  it('接受合法的对话修复话术配置（template 模式，携带模板话术）', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: {
        sideQuestionBridge: 'template',
        sideQuestionBridgeTemplate: '回到刚才的问题，{question}',
      },
    }));
    assert.equal(errors.length, 0);
  });

  it('省略 dialogRepair 时不报错', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
    }));
    assert.equal(errors.length, 0);
  });

  it('拒绝非法的 sideQuestionBridge 枚举值', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: {
        sideQuestionBridge: 'auto',
      },
    }));
    const nested = errors.find((error) => error.property === 'dialogRepair');
    assert.ok(nested, 'dialogRepair 字段应报出嵌套校验错误');
    const bridgeError = nested?.children?.find((child) => child.property === 'sideQuestionBridge');
    assert.ok(bridgeError, 'sideQuestionBridge 应报出非法枚举值错误');
  });

  it('拒绝非字符串类型的话术字段', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: {
        noInputPrompt: 12345,
      },
    }));
    const nested = errors.find((error) => error.property === 'dialogRepair');
    assert.ok(nested, 'dialogRepair 字段应报出嵌套校验错误');
    const promptError = nested?.children?.find((child) => child.property === 'noInputPrompt');
    assert.ok(promptError, 'noInputPrompt 应报出类型错误');
  });

  it('接受合法的静默配置（transfer 模式，携带转人工提示语）', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: {
        silencePrompt: '- 复述上一轮对话的内容\n- 保证上下文自然衔接',
        silenceTimeoutMs: 8000,
        maxSilenceRounds: 3,
        silenceAction: 'transfer',
        silenceTransferPrompt: '请稍等，正在为您转接人工客服。',
      },
    }));
    assert.equal(errors.length, 0);
  });

  it('拒绝越界的 silenceTimeoutMs', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: {
        silenceTimeoutMs: 500,
      },
    }));
    const nested = errors.find((error) => error.property === 'dialogRepair');
    assert.ok(nested, 'dialogRepair 字段应报出嵌套校验错误');
    const timeoutError = nested?.children?.find((child) => child.property === 'silenceTimeoutMs');
    assert.ok(timeoutError, 'silenceTimeoutMs 低于下限应报错');
  });

  it('拒绝越界的 maxSilenceRounds', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: {
        maxSilenceRounds: 11,
      },
    }));
    const nested = errors.find((error) => error.property === 'dialogRepair');
    assert.ok(nested, 'dialogRepair 字段应报出嵌套校验错误');
    const roundsError = nested?.children?.find((child) => child.property === 'maxSilenceRounds');
    assert.ok(roundsError, 'maxSilenceRounds 超出上限应报错');
  });

  it('拒绝非法的 silenceAction 枚举值', async () => {
    const errors = await validate(plainToInstance(CreateScenarioDto, {
      scenario: 'test_scene',
      name: '测试场景',
      dialogRepair: {
        silenceAction: 'ignore',
      },
    }));
    const nested = errors.find((error) => error.property === 'dialogRepair');
    assert.ok(nested, 'dialogRepair 字段应报出嵌套校验错误');
    const actionError = nested?.children?.find((child) => child.property === 'silenceAction');
    assert.ok(actionError, 'silenceAction 应报出非法枚举值错误');
  });
});

describe('UpdateScenarioDto dialogRepair 校验', () => {
  it('更新时支持只传部分对话修复话术字段', async () => {
    const errors = await validate(plainToInstance(UpdateScenarioDto, {
      dialogRepair: {
        noMatchPrompt: '抱歉，我还没理解您的回答。{question}',
      },
    }));
    assert.equal(errors.length, 0);
  });

  it('更新时拒绝非法的 sideQuestionBridge 枚举值', async () => {
    const errors = await validate(plainToInstance(UpdateScenarioDto, {
      dialogRepair: {
        sideQuestionBridge: 'invalid',
      },
    }));
    const nested = errors.find((error) => error.property === 'dialogRepair');
    assert.ok(nested, 'dialogRepair 字段应报出嵌套校验错误');
  });
});
