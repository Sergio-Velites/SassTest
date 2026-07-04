'use client';

import Link from 'next/link';

import { Card, Spinner, StatusBadge } from '../../../components/ui';
import { useApprovals, useExecutions, useWorkflows } from '../../../lib/hooks';

export default function DashboardPage() {
  const executions = useExecutions();
  const approvals = useApprovals('pending');
  const workflows = useWorkflows();

  const list = executions.data?.executions ?? [];
  const succeeded = list.filter((e) => e.status === 'succeeded').length;
  const successRate = list.length > 0 ? Math.round((succeeded / list.length) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card title="Workflows instalados">
          <p className="text-3xl font-bold">{workflows.data?.workflows.length ?? '—'}</p>
        </Card>
        <Card title="Tasa de éxito (últimas 25)">
          <p className="text-3xl font-bold">{successRate === null ? '—' : `${successRate}%`}</p>
        </Card>
        <Card title="Aprobaciones pendientes">
          <p className="text-3xl font-bold">{approvals.data?.approvals.length ?? '—'}</p>
          {approvals.data && approvals.data.approvals.length > 0 ? (
            <Link className="text-sm text-slate-500 underline" href="/approvals">
              Revisar ahora →
            </Link>
          ) : null}
        </Card>
      </div>
      <Card title="Ejecuciones recientes">
        {executions.isLoading ? (
          <Spinner />
        ) : list.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aún no hay ejecuciones.{' '}
            <Link className="underline" href="/catalog">
              Instala un workflow del catálogo
            </Link>{' '}
            para empezar.
          </p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {list.slice(0, 10).map((e) => (
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
    </div>
  );
}
