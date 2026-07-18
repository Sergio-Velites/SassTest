'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { Button, Card, ErrorBox, Spinner, StatusBadge } from '../../../../components/ui';
import { WorkflowGraph } from '../../../../components/workflow-graph';
import {
  useExecutions,
  useRunWorkflow,
  useWorkflow,
  useWorkflowVersions,
} from '../../../../lib/hooks';

export default function WorkflowDetailPage() {
  const params = useParams<{ workflowId: string }>();
  const workflow = useWorkflow(params.workflowId);
  const versions = useWorkflowVersions(params.workflowId);
  const executions = useExecutions({ workflowId: params.workflowId });
  const run = useRunWorkflow();
  const router = useRouter();

  if (workflow.isLoading) return <Spinner />;
  if (workflow.error) return <ErrorBox message={workflow.error.message} />;
  const data = workflow.data;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <p className="text-sm text-slate-500">
            <StatusBadge status={data.status} /> · versión {data.currentVersion}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push(`/workflows/${data.id}/edit`)}
            data-testid="edit-workflow"
          >
            ✎ Editar
          </Button>
          <Button
            disabled={run.isPending || data.status !== 'active'}
            onClick={() =>
              run.mutate(data.id, {
                onSuccess: (r) => router.push(`/executions/${r.executionId}`),
              })
            }
          >
            {run.isPending ? 'Lanzando…' : '▶ Ejecutar ahora'}
          </Button>
        </div>
      </div>
      {run.error ? <ErrorBox message={run.error.message} /> : null}

      <Card title="Grafo del workflow">
        <WorkflowGraph definition={data.definition} />
      </Card>

      <Card title="Ejecuciones de este workflow">
        {(executions.data?.executions.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">Sin ejecuciones todavía.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {executions.data?.executions.map((e) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="py-2">
                    <Link className="font-mono text-xs underline" href={`/executions/${e.id}`}>
                      {e.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="text-slate-500">{new Date(e.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Historial de versiones">
        {(versions.data?.versions.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">Sin versiones.</p>
        ) : (
          <ul
            className="flex flex-col divide-y divide-slate-100 text-sm"
            data-testid="version-history"
          >
            {versions.data?.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between py-2">
                <span className="font-medium">v{v.version}</span>
                <span className="text-xs text-slate-400">
                  {new Date(v.createdAt).toLocaleString()}
                </span>
                {v.isCurrent ? (
                  <StatusBadge status="active" />
                ) : (
                  <span className="text-xs text-slate-400">histórica</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Definición (JSON)">
        <pre className="max-h-96 overflow-auto rounded bg-slate-900 p-4 text-xs text-slate-100">
          {JSON.stringify(data.definition, null, 2)}
        </pre>
      </Card>
    </div>
  );
}
