'use client';

import { useEffect, useState } from 'react';

type HealthState =
  { kind: 'loading' } | { kind: 'ok'; uptimeSeconds: number } | { kind: 'error'; message: string };

const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';

export function ApiHealth() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { status: string; uptimeSeconds: number };
        setState({ kind: 'ok', uptimeSeconds: body.uptimeSeconds });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: 'error', message: error instanceof Error ? error.message : 'unknown' });
      });
    return () => controller.abort();
  }, []);

  if (state.kind === 'loading') {
    return <p className="mt-2 text-slate-500">Comprobando API…</p>;
  }
  if (state.kind === 'error') {
    return (
      <p className="mt-2 text-red-600">
        API no disponible ({state.message}). Arranca la API con{' '}
        <code className="rounded bg-slate-100 px-1">pnpm --filter @flowhub/api dev</code>
      </p>
    );
  }
  return (
    <p className="mt-2 text-emerald-600">
      API operativa — uptime {state.uptimeSeconds}s ·{' '}
      <a className="underline" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
        OpenAPI docs
      </a>
    </p>
  );
}
