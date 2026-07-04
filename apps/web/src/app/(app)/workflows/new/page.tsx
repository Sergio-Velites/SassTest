'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, Card, ErrorBox, Input } from '../../../../components/ui';
import { useCreateWorkflow } from '../../../../lib/hooks';

const EXAMPLE = JSON.stringify(
  {
    name: 'Mi workflow',
    description: 'Ejemplo mínimo',
    nodes: [
      { id: 'start', kind: 'trigger', name: 'Inicio', config: { type: 'manual' } },
      {
        id: 'notify',
        kind: 'action',
        name: 'Notificar',
        config: {
          connector: 'slack-mock',
          action: 'send_message',
          params: { channel: '#general', text: 'Hola desde FlowHub' },
        },
      },
    ],
    edges: [{ from: 'start', to: 'notify' }],
  },
  null,
  2,
);

export default function NewWorkflowPage() {
  const create = useCreateWorkflow();
  const router = useRouter();
  const [name, setName] = useState('');
  const [json, setJson] = useState(EXAMPLE);
  const [parseError, setParseError] = useState<string | null>(null);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setParseError(null);
    let definition: Record<string, unknown>;
    try {
      definition = JSON.parse(json) as Record<string, unknown>;
    } catch {
      setParseError('El JSON no es válido (error de sintaxis).');
      return;
    }
    create.mutate(
      { name, definition },
      { onSuccess: (r) => router.push(`/workflows/${r.installedWorkflowId}`) },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Crear workflow desde JSON</h1>
      <Card>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <Input
            placeholder="Nombre del workflow"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <textarea
            className="h-96 w-full rounded-md border border-slate-300 p-3 font-mono text-xs focus:border-slate-500 focus:outline-none"
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
          />
          {parseError ? <ErrorBox message={parseError} /> : null}
          {create.error ? <ErrorBox message={create.error.message} /> : null}
          <div>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Validando…' : 'Crear workflow'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
