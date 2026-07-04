'use client';

import { useParams } from 'next/navigation';

import { Card, ErrorBox, Spinner, StatusBadge } from '../../../../components/ui';
import { useExecution, useExecutionLogs, useExecutionSteps } from '../../../../lib/hooks';

export default function ExecutionDetailPage() {
  const params = useParams<{ executionId: string }>();
  const execution = useExecution(params.executionId);
  const steps = useExecutionSteps(params.executionId);
  const logs = useExecutionLogs(params.executionId);

  if (execution.isLoading) return <Spinner />;
  if (execution.error) return <ErrorBox message={execution.error.message} />;
  const data = execution.data;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">
          Ejecución <span className="font-mono text-lg">{data.id.slice(0, 8)}</span>
        </h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-slate-500">
          <StatusBadge status={data.status} />
          {data.startedAt ? `· inicio ${new Date(data.startedAt).toLocaleString()}` : null}
          {data.finishedAt ? `· fin ${new Date(data.finishedAt).toLocaleString()}` : null}
        </p>
        {data.error ? (
          <div className="mt-2">
            <ErrorBox message={`${String(data.error['code'])}: ${String(data.error['message'])}`} />
          </div>
        ) : null}
      </div>

      <Card title="Pasos">
        {(steps.data?.steps.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">
            Sin pasos todavía (el worker la tomará en breve).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2">Nodo</th>
                <th className="pb-2">Tipo</th>
                <th className="pb-2">Estado</th>
                <th className="pb-2">Intento</th>
                <th className="pb-2">Rama</th>
                <th className="pb-2">Output</th>
              </tr>
            </thead>
            <tbody>
              {steps.data?.steps.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 font-medium">{s.nodeId}</td>
                  <td className="text-slate-500">{s.nodeKind}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="text-slate-500">{s.attempt}</td>
                  <td className="text-slate-500">{s.branch ?? '—'}</td>
                  <td>
                    {s.output != null ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-slate-400">ver</summary>
                        <pre className="mt-1 max-w-xs overflow-auto rounded bg-slate-50 p-2 text-xs">
                          {JSON.stringify(s.output, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title="Logs">
        {(logs.data?.logs.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">Sin logs todavía.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded bg-slate-900 p-4 font-mono text-xs text-slate-200">
            {logs.data?.logs.map((l) => (
              <p key={l.id}>
                <span className="text-slate-500">{new Date(l.createdAt).toLocaleTimeString()}</span>{' '}
                <span
                  className={
                    l.level === 'error'
                      ? 'text-red-400'
                      : l.level === 'warn'
                        ? 'text-amber-400'
                        : 'text-slate-400'
                  }
                >
                  [{l.level}]
                </span>{' '}
                {l.message}
              </p>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
