'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, Card, ErrorBox, Input } from '../../components/ui';
import { useLogin } from '../../lib/hooks';

export default function LoginPage() {
  const login = useLogin();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate(
      { email, password },
      {
        onSuccess: (me) => router.replace(me.activeOrganizationId ? '/dashboard' : '/onboarding'),
      },
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-center text-2xl font-bold">FlowHub AI</h1>
      <Card title="Iniciar sesión">
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <Input
            type="email"
            placeholder="email@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {login.error ? <ErrorBox message={login.error.message} /> : null}
          <Button type="submit" disabled={login.isPending}>
            {login.isPending ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-slate-500">
        ¿Sin cuenta?{' '}
        <Link className="underline" href="/register">
          Regístrate
        </Link>
      </p>
    </main>
  );
}
