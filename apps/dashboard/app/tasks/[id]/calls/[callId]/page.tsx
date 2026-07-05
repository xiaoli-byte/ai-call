import { apiServer } from '@/lib/api/server';
import { TaskDetailView } from '@/components/outbound/task-detail-view';
import { CallDetailDialog } from '@/components/outbound/call-detail-dialog';

export default async function TaskCallDetailPage({
  params,
}: {
  params: { id: string; callId: string };
}) {
  const [task, call, scenarios] = await Promise.all([
    apiServer.tasks.get(params.id),
    apiServer.calls.get(params.callId),
    apiServer.scenarios.list(),
  ]);
  const scenarioName = scenarios.find((item) => item.scenario === task.scenario)?.name ?? task.scenario;
  const customerName = task.variables.customerName || task.variables.name || '外呼客户';

  return (
    <TaskDetailView task={task} scenarioName={scenarioName}>
      <CallDetailDialog
        call={call}
        taskId={task.id}
        customerName={customerName}
        robotName={scenarioName}
      />
    </TaskDetailView>
  );
}
