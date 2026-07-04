'use client';

import Link from 'next/link';

import { Button, Card, Spinner, StatusBadge } from '../../../components/ui';
import { useWorkflows } from '../../../lib/hooks';

export default function WorkflowsPage() {
  const workflows = useWorkflows();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workflows</h1>
        <Link href="/workflows/new">
          <Button variant="secondary">Crear desde JSON</Button>
        </Link>
      </div>
      {workflows.isLoading ? (
        <Spinner />
      ) : (workflows.data?.workflows.length ?? 0) === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            No hay workflows instalados.{' '}
            <Link className="underline" href="/catalog">
              Explora el catálogo
            </Link>
            .
          </p>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="pb-2">Nombre</th>
                <th className="pb-2">Estado</th>
                <th className="pb-2">Instalado</th>
              </tr>
            </thead>
            <tbody>
              {workflows.data?.workflows.map((w) => (
                <tr key={w.id} className="border-t border-slate-100">
                  <td className="py-2">
                    <Link className="font-medium underline" href={`/workflows/${w.id}`}>
                      {w.name}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={w.status} />
                  </td>
                  <td className="text-slate-500">{new Date(w.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
