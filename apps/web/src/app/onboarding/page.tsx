'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, Card, ErrorBox, Input } from '../../components/ui';
import { useCreateOrganization } from '../../lib/hooks';

export default function OnboardingPage() {
  const createOrg = useCreateOrganization();
  const router = useRouter();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    createOrg.mutate({ name, slug }, { onSuccess: () => router.replace('/dashboard') });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-center text-2xl font-bold">Crea tu organización</h1>
      <Card>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <Input
            placeholder="Nombre de la empresa"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSlug(
                e.target.value
                  .toLowerCase()
                  .normalize('NFD')
                  .replace(/[̀-ͯ]/g, '')
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-|-$/g, ''),
              );
            }}
            required
          />
          <Input
            placeholder="identificador-url"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            required
          />
          {createOrg.error ? <ErrorBox message={createOrg.error.message} /> : null}
          <Button type="submit" disabled={createOrg.isPending}>
            {createOrg.isPending ? 'Creando…' : 'Crear organización'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
