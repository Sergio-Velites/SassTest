'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Button, Card, ErrorBox, Input } from '../../components/ui';
import { useRegister } from '../../lib/hooks';

export default function RegisterPage() {
  const register = useRegister();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    register.mutate({ name, email, password }, { onSuccess: () => router.replace('/onboarding') });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-center text-2xl font-bold">FlowHub AI</h1>
      <Card title="Crear cuenta">
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <Input
            placeholder="Tu nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            type="email"
            placeholder="email@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Contraseña (mín. 8 caracteres)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          {register.error ? <ErrorBox message={register.error.message} /> : null}
          <Button type="submit" disabled={register.isPending}>
            {register.isPending ? 'Creando…' : 'Crear cuenta'}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-slate-500">
        ¿Ya tienes cuenta?{' '}
        <Link className="underline" href="/login">
          Inicia sesión
        </Link>
      </p>
    </main>
  );
}
