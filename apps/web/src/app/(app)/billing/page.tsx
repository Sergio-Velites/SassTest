'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

import { Button, Card, ErrorBox, Spinner, StatusBadge } from '../../../components/ui';
import {
  useBillingPlans,
  useBillingPortal,
  useBillingSubscription,
  useCheckout,
} from '../../../lib/hooks';

function priceLabel(cents: number, currency: string, slug: string): string {
  if (slug === 'enterprise') return 'A medida';
  if (cents === 0) return 'Gratis';
  return `${(cents / 100).toFixed(0)} ${currency}/mes`;
}

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit < 0;
  const ratio = unlimited ? 0 : Math.min(1, limit === 0 ? 1 : used / limit);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">{label}</span>
        <span className={ratio >= 1 ? 'font-semibold text-red-600' : 'text-slate-600'}>
          {used} / {unlimited ? '∞' : limit}
        </span>
      </div>
      <div className="h-1.5 w-full rounded bg-slate-100">
        <div
          className={`h-1.5 rounded ${ratio >= 1 ? 'bg-red-500' : 'bg-slate-700'}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

function BillingContent() {
  const searchParams = useSearchParams();
  const subscription = useBillingSubscription();
  const plans = useBillingPlans();
  const checkout = useCheckout();
  const portal = useBillingPortal();

  const upgraded = searchParams.get('upgraded');
  const cancelled = searchParams.get('cancelled');

  const sub = subscription.data;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Plan y facturación</h1>
        <p className="text-sm text-slate-500">
          Los límites se aplican por organización. El cobro real usa Stripe en test mode; sin claves
          configuradas el upgrade es simulado (gateway mock).
        </p>
      </div>

      {upgraded ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Plan actualizado a <span className="font-semibold">{upgraded}</span>. 🎉
        </div>
      ) : null}
      {cancelled ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Checkout cancelado — sigues en tu plan actual.
        </div>
      ) : null}
      {checkout.error ? <ErrorBox message={checkout.error.message} /> : null}
      {portal.error ? <ErrorBox message={portal.error.message} /> : null}

      <Card title="Plan actual">
        {subscription.isLoading || !sub ? (
          <Spinner />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold capitalize" data-testid="current-plan">
                  {sub.planSlug}
                </p>
                <StatusBadge status={sub.status} />
              </div>
              <Button
                variant="secondary"
                disabled={portal.isPending}
                onClick={() => portal.mutate()}
              >
                {sub.gateway === 'stripe' ? 'Portal de facturación' : 'Portal (mock)'}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <UsageRow
                label="Usuarios"
                used={sub.usage.users}
                limit={sub.limits['maxUsers'] ?? 0}
              />
              <UsageRow
                label="Workflows instalados"
                used={sub.usage.workflows}
                limit={sub.limits['maxInstalledWorkflows'] ?? 0}
              />
              <UsageRow
                label="Ejecuciones este mes"
                used={sub.usage.executionsThisMonth}
                limit={sub.limits['maxExecutionsPerMonth'] ?? 0}
              />
            </div>
          </div>
        )}
      </Card>

      <Card title="Planes disponibles">
        {plans.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {plans.data?.plans
              .filter((p) => p.slug !== 'enterprise')
              .map((plan) => {
                const isCurrent = sub?.planSlug === plan.slug;
                return (
                  <div
                    key={plan.slug}
                    className={`flex flex-col gap-2 rounded-md border p-4 ${
                      isCurrent ? 'border-slate-900' : 'border-slate-200'
                    }`}
                    data-testid={`plan-${plan.slug}`}
                  >
                    <p className="font-semibold capitalize">{plan.name}</p>
                    <p className="text-2xl font-bold">
                      {priceLabel(plan.priceCents, plan.currency, plan.slug)}
                    </p>
                    <ul className="flex-1 text-xs text-slate-500">
                      <li>
                        {plan.limits['maxUsers'] === -1 ? '∞' : plan.limits['maxUsers']} usuarios
                      </li>
                      <li>
                        {plan.limits['maxInstalledWorkflows'] === -1
                          ? '∞'
                          : plan.limits['maxInstalledWorkflows']}{' '}
                        workflows
                      </li>
                      <li>
                        {plan.limits['maxExecutionsPerMonth'] === -1
                          ? '∞'
                          : plan.limits['maxExecutionsPerMonth']}{' '}
                        ejecuciones/mes
                      </li>
                    </ul>
                    {isCurrent ? (
                      <span className="rounded bg-slate-100 px-2 py-1 text-center text-xs font-medium text-slate-600">
                        Plan actual
                      </span>
                    ) : (
                      <Button
                        disabled={checkout.isPending}
                        onClick={() => checkout.mutate(plan.slug)}
                        data-testid={`upgrade-${plan.slug}`}
                      >
                        {checkout.isPending ? 'Abriendo…' : 'Cambiar a este plan'}
                      </Button>
                    )}
                  </div>
                );
              })}
          </div>
        )}
        <p className="mt-4 text-xs text-slate-400">
          ¿Necesitas Enterprise (límites a medida, SSO, soporte dedicado)? Contacta con ventas.
        </p>
      </Card>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <BillingContent />
    </Suspense>
  );
}
