import type { HttpAdapter } from '../types';
import { authEndpoints } from './auth';
import { tasksEndpoints } from './tasks';
import { taskFlowsEndpoints } from './task-flows';
import { scenariosEndpoints } from './scenarios';
import { knowledgeEndpoints } from './knowledge';
import { systemEndpoints } from './system';

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

  return {
    // 模块化嵌套（新代码推荐）
    auth,
    tasks,
    taskFlows,
    scenarios,
    knowledge,
    system,

    // 顶层扁平别名（兼容旧 apiClient.xxx 调用）
    // auth
    login: auth.login,
    logout: auth.logout,
    me: auth.me,
    // tasks
    listTasks: tasks.list,
    getTask: tasks.get,
    createTask: tasks.create,
    dispatchTask: tasks.dispatch,
    // scenarios
    listScenarios: scenarios.list,
    getScenario: scenarios.get,
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
