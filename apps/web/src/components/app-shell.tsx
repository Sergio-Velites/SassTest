'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { ApiError } from '../lib/api';
import { useLogout, useMe } from '../lib/hooks';
import { Spinner } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/catalog', label: 'Catálogo' },
  { href: '/workflows', label: 'Workflows' },
  { href: '/approvals', label: 'Aprobaciones' },
];

/** Authenticated layout: redirects to login/onboarding when needed. */
export function AppShell({ children }: { children: ReactNode }) {
  const { data: me, error, isLoading } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const logout = useLogout();

  const unauthenticated = error instanceof ApiError && error.status === 401;
  const needsOrganization = me && me.activeOrganizationId === null;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
    else if (needsOrganization) router.replace('/onboarding');
  }, [unauthenticated, needsOrganization, router]);

  if (isLoading || unauthenticated || needsOrganization) return <Spinner />;

  const activeOrg = me?.memberships.find((m) => m.organizationId === me.activeOrganizationId);

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <Link href="/dashboard" className="text-lg font-bold tracking-tight">
              FlowHub AI
            </Link>
            <nav className="flex gap-4">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`text-sm ${
                    pathname.startsWith(item.href)
                      ? 'font-semibold text-slate-900'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span>
              {activeOrg?.organizationName ?? '—'} · {me?.user.name}
            </span>
            <button
              className="text-slate-400 underline hover:text-slate-700"
              onClick={() =>
                logout.mutate(undefined, { onSuccess: () => router.replace('/login') })
              }
            >
              Salir
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
