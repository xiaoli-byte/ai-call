import type { HttpAdapter } from '../types';
import { authEndpoints } from './auth';
import { tasksEndpoints } from './tasks';
import { taskFlowsEndpoints } from './task-flows';
import { scenariosEndpoints } from './scenarios';
import { knowledgeEndpoints } from './knowledge';
import { systemEndpoints } from './system';
import { callsEndpoints } from './calls';
import { globalConfigEndpoints } from './global-config';
import { voiceClonesEndpoints } from './voice-clones';
import { campaignsEndpoints } from './campaigns';
import { analyticsEndpoints } from './analytics';
import { qualityEndpoints } from './quality';
import { complianceEndpoints } from './compliance';

/**
 * 工厂：根据传入的 HttpAdapter（client 或 server）创建完整 API 对象。
 * 两个实例方法名、签名、返回类型完全一致，仅底层 request 实现不同。
 *
 * 同时暴露模块化嵌套（apiClient.tasks.list，新代码推荐）与顶层扁平别名
 * （apiClient.listTasks，兼容旧调用），迁移期零认知成本。
 */
export function createApi(http: HttpAdapter) {
  const auth = authEndpoints(http);
  const tasks = tasksEndpoints(http);
  const taskFlows = taskFlowsEndpoints(http);
  const scenarios = scenariosEndpoints(http);
  const knowledge = knowledgeEndpoints(http);
  const system = systemEndpoints(http);
  const calls = callsEndpoints(http);
  const globalConfig = globalConfigEndpoints(http);
  const voiceClones = voiceClonesEndpoints(http);
  const campaigns = campaignsEndpoints(http);
  const analytics = analyticsEndpoints(http);
  const quality = qualityEndpoints(http);
  const compliance = complianceEndpoints(http);

  return {
    // 模块化嵌套（新代码推荐）
    auth,
    tasks,
    taskFlows,
    scenarios,
    knowledge,
    system,
    calls,
    globalConfig,
    voiceClones,
    campaigns,
    analytics,
    quality,
    compliance,

    // 顶层扁平别名（兼容旧 apiClient.xxx 调用）
    // auth
    login: auth.login,
    logout: auth.logout,
    me: auth.me,
    // tasks
    listTasks: tasks.list,
    getTask: tasks.get,
    createTask: tasks.create,
    createTaskBatch: tasks.createBatch,
    dispatchTask: tasks.dispatch,
    // campaigns
    listCampaigns: campaigns.list,
    getCampaign: campaigns.get,
    createCampaign: campaigns.create,
    updateCampaignStatus: campaigns.updateStatus,
    // analytics
    getAnalyticsOverview: analytics.overview,
    // quality
    listQualityAnalyses: quality.list,
    analyzeCall: quality.analyze,
    correctCallAnalysis: quality.correct,
    // compliance
    getCompliancePolicy: compliance.getPolicy,
    updateCompliancePolicy: compliance.updatePolicy,
    listComplianceAuditLogs: compliance.listAuditLogs,
    // calls
    listCalls: calls.list,
    getCall: calls.get,
    // scenarios
    listScenarios: scenarios.list,
    getScenario: scenarios.get,
    createScenario: scenarios.create,
    updateScenario: scenarios.update,
    deactivateScenario: scenarios.deactivate,
    // global config
    getGlobalConfig: globalConfig.get,
    updateGlobalConfig: globalConfig.update,
    // voice clones
    listVoiceClones: voiceClones.list,
    createVoiceClone: voiceClones.create,
    synthesizeVoiceClone: voiceClones.synthesize,
    deleteVoiceClone: voiceClones.remove,
    // knowledge
    listKnowledgeBases: knowledge.list,
    getKnowledgeBase: knowledge.get,
    retrieve: knowledge.retrieve,
    // system（旧代码用 apiClient.users / apiClient.roles / apiClient.permissions）
    users: system.users,
    roles: system.roles,
    permissions: system.permissions,
  };
}

export type Api = ReturnType<typeof createApi>;
