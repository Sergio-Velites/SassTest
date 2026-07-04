'use client';

import { useRouter } from 'next/navigation';

import { Button, Card, ErrorBox, Spinner } from '../../../components/ui';
import { useCatalog, useInstallWorkflow } from '../../../lib/hooks';

export default function CatalogPage() {
  const catalog = useCatalog();
  const install = useInstallWorkflow();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">Catálogo de workflows</h1>
      {install.error ? <ErrorBox message={install.error.message} /> : null}
      {catalog.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(catalog.data?.templates ?? []).map((template) => (
            <Card key={template.id}>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{template.name}</h2>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {template.category}
                  </span>
                </div>
                <p className="text-sm text-slate-600">{template.description}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-slate-400">v{template.latestVersion ?? '—'}</span>
                  <Button
                    disabled={!template.latestVersionId || install.isPending}
                    onClick={() =>
                      template.latestVersionId &&
                      install.mutate(
                        { templateVersionId: template.latestVersionId },
                        {
                          onSuccess: (r) => router.push(`/workflows/${r.installedWorkflowId}`),
                        },
                      )
                    }
                  >
                    Instalar
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
