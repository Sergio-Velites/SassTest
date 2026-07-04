'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Button, Card, ErrorBox, Input, Spinner } from '../../../components/ui';
import { useApprovals, useResolveApproval } from '../../../lib/hooks';

export default function ApprovalsPage() {
  const approvals = useApprovals('pending');
  const resolve = useResolveApproval();
  const [comments, setComments] = useState<Record<string, string>>({});

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Aprobaciones pendientes</h1>
      {resolve.error ? <ErrorBox message={resolve.error.message} /> : null}
      {approvals.isLoading ? (
        <Spinner />
      ) : (approvals.data?.approvals.length ?? 0) === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">No hay aprobaciones pendientes. 🎉</p>
        </Card>
      ) : (
        approvals.data?.approvals.map((approval) => (
          <Card key={approval.id}>
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="font-semibold">{approval.title}</h2>
                <p className="text-xs text-slate-400">
                  Ejecución{' '}
                  <Link className="underline" href={`/executions/${approval.workflowExecutionId}`}>
                    {approval.workflowExecutionId.slice(0, 8)}
                  </Link>{' '}
                  · {new Date(approval.createdAt).toLocaleString()} · requiere rol{' '}
                  {approval.requiredRole}
                </p>
              </div>
              {approval.payload ? (
                <pre className="overflow-auto rounded bg-slate-50 p-3 text-xs">
                  {JSON.stringify(approval.payload, null, 2)}
                </pre>
              ) : null}
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Comentario (opcional)"
                  value={comments[approval.id] ?? ''}
                  onChange={(e) => setComments({ ...comments, [approval.id]: e.target.value })}
                />
                <Button
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate({
                      approvalId: approval.id,
                      decision: 'approved',
                      ...(comments[approval.id] ? { comment: comments[approval.id] } : {}),
                    })
                  }
                >
                  Aprobar
                </Button>
                <Button
                  variant="danger"
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate({
                      approvalId: approval.id,
                      decision: 'rejected',
                      ...(comments[approval.id] ? { comment: comments[approval.id] } : {}),
                    })
                  }
                >
                  Rechazar
                </Button>
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
