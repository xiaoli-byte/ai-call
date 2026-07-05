import { apiServer } from '@/lib/api/server';
import { TaskDetailView } from '@/components/outbound/task-detail-view';

export default async function TaskDetailPage({ params }: { params: { id: string } }) {
  const [task, scenarios] = await Promise.all([
    apiServer.tasks.get(params.id),
    apiServer.scenarios.list(),
  ]);
  const scenarioName = scenarios.find((item) => item.scenario === task.scenario)?.name ?? task.scenario;
  return <TaskDetailView task={task} scenarioName={scenarioName} />;
}
