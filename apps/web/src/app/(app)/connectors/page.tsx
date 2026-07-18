'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { Button, Card, ErrorBox, Input, Spinner, StatusBadge } from '../../../components/ui';
import {
  useAuthorizeConnector,
  useConnectApiKey,
  useConnectorAccounts,
  useConnectorCatalog,
  useRevokeConnectorAccount,
} from '../../../lib/hooks';

/** Field layout for the api_key connect forms (mirrors the server-side Zod schemas). */
const API_KEY_FORMS: Record<
  string,
  Array<{ key: string; label: string; required: boolean; type?: 'password' }>
> = {
  email: [
    { key: 'user', label: 'Usuario', required: true },
    { key: 'password', label: 'Contraseña', required: true, type: 'password' },
    { key: 'smtpHost', label: 'Host SMTP', required: true },
    { key: 'smtpPort', label: 'Puerto SMTP (587)', required: false },
    { key: 'imapHost', label: 'Host IMAP (opcional)', required: false },
    { key: 'imapPort', label: 'Puerto IMAP (opcional)', required: false },
    { key: 'from', label: 'Remitente From (opcional)', required: false },
  ],
  holded: [{ key: 'apiKey', label: 'API key de Holded', required: true, type: 'password' }],
};

const CALLBACK_ERRORS: Record<string, string> = {
  missing_state: 'La sesión de autorización expiró o falta el estado. Vuelve a intentarlo.',
  invalid_state: 'El estado de OAuth no es válido. Vuelve a intentarlo.',
  provider_unavailable: 'El proveedor no está configurado en el servidor.',
  exchange_failed: 'El intercambio del código OAuth falló. Vuelve a intentarlo.',
  persist_failed: 'No se pudo guardar la cuenta conectada.',
  access_denied: 'Has cancelado la autorización en el proveedor.',
};

function ApiKeyForm({ slug, onDone }: { slug: string; onDone: () => void }) {
  const connect = useConnectApiKey();
  const fields = API_KEY_FORMS[slug] ?? [];
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});

  const missingRequired =
    name.trim().length === 0 || fields.some((f) => f.required && !(values[f.key] ?? '').trim());

  return (
    <form
      className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        const credentials = Object.fromEntries(
          Object.entries(values).filter(([, v]) => v.trim().length > 0),
        );
        connect.mutate({ slug, name: name.trim(), credentials }, { onSuccess: onDone });
      }}
    >
      <Input
        placeholder="Nombre de la cuenta (p. ej. Email corporativo)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {fields.map((field) => (
        <Input
          key={field.key}
          type={field.type ?? 'text'}
          placeholder={field.label}
          value={values[field.key] ?? ''}
          onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
        />
      ))}
      {connect.error ? <ErrorBox message={connect.error.message} /> : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={connect.isPending || missingRequired}>
          {connect.isPending ? 'Conectando…' : 'Guardar credenciales'}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function ConnectorsContent() {
  const searchParams = useSearchParams();
  const catalog = useConnectorCatalog();
  const accounts = useConnectorAccounts();
  const authorize = useAuthorizeConnector();
  const revoke = useRevokeConnectorAccount();
  const [openForm, setOpenForm] = useState<string | null>(null);

  const connected = searchParams.get('connected');
  const errorParam = searchParams.get('error');

  const realConnectors = catalog.data?.connectors.filter((c) => c.kind === 'real') ?? [];
  const mockConnectors = catalog.data?.connectors.filter((c) => c.kind === 'mock') ?? [];
  const activeAccounts = accounts.data?.accounts.filter((a) => a.status !== 'revoked') ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Conectores</h1>
        <p className="text-sm text-slate-500">
          Conecta cuentas reales (OAuth o API key) para que los workflows actúen sobre tus
          herramientas. Los conectores mock funcionan siempre y no requieren credenciales.
        </p>
      </div>

      {connected ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Cuenta de <span className="font-semibold">{connected}</span> conectada correctamente.
        </div>
      ) : null}
      {errorParam ? (
        <ErrorBox
          message={CALLBACK_ERRORS[errorParam] ?? `Error al conectar el proveedor: ${errorParam}`}
        />
      ) : null}
      {authorize.error ? <ErrorBox message={authorize.error.message} /> : null}
      {revoke.error ? <ErrorBox message={revoke.error.message} /> : null}

      <Card title="Cuentas conectadas">
        {accounts.isLoading ? (
          <Spinner />
        ) : activeAccounts.length === 0 ? (
          <p className="text-sm text-slate-500">
            Todavía no hay cuentas conectadas en esta organización.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {activeAccounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium">{account.name}</p>
                  <p className="text-xs text-slate-400">
                    {account.connectorSlug} · {account.authType} ·{' '}
                    {new Date(account.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={account.status} />
                  <Button
                    variant="danger"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(account.id)}
                  >
                    Revocar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Conectores reales">
        {catalog.isLoading ? (
          <Spinner />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {realConnectors.map((connector) => (
              <div
                key={connector.slug}
                className="rounded-md border border-slate-200 p-4"
                data-testid={`connector-${connector.slug}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{connector.displayName}</p>
                    <p className="text-xs text-slate-400">
                      {connector.slug} · {connector.auth === 'oauth2' ? 'OAuth 2.0' : 'API key'}
                    </p>
                  </div>
                  {!connector.available ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      no configurado
                    </span>
                  ) : null}
                </div>
                {connector.available ? (
                  connector.auth === 'oauth2' ? (
                    <Button
                      className="mt-3"
                      disabled={authorize.isPending}
                      onClick={() => authorize.mutate(connector.slug)}
                    >
                      {authorize.isPending ? 'Redirigiendo…' : 'Conectar con OAuth'}
                    </Button>
                  ) : openForm === connector.slug ? (
                    <ApiKeyForm slug={connector.slug} onDone={() => setOpenForm(null)} />
                  ) : (
                    <Button
                      className="mt-3"
                      variant="secondary"
                      onClick={() => setOpenForm(connector.slug)}
                    >
                      Introducir credenciales
                    </Button>
                  )
                ) : (
                  <p className="mt-3 text-xs text-slate-400">
                    {connector.auth === 'oauth2'
                      ? 'El operador debe configurar las credenciales OAuth del proveedor (client ID/secret) en el servidor.'
                      : 'El operador debe configurar CONNECTOR_SECRETS_KEY en el servidor.'}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Conectores mock (siempre disponibles)">
        {catalog.isLoading ? (
          <Spinner />
        ) : (
          <div className="flex flex-wrap gap-2">
            {mockConnectors.map((connector) => (
              <span
                key={connector.slug}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
              >
                {connector.displayName}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function ConnectorsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <ConnectorsContent />
    </Suspense>
  );
}
