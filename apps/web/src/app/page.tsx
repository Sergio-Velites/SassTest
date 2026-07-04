import { ApiHealth } from '../components/api-health';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">FlowHub AI</h1>
        <p className="mt-2 text-slate-600">
          Plataforma de workflows empresariales instalables, con IA integrada y marketplace.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Estado del sistema
        </h2>
        <ApiHealth />
      </div>
      <p className="text-sm text-slate-400">
        Scaffold del Ciclo 3 — el MVP de interfaz (dashboard, catálogo, ejecuciones) llega en el
        Ciclo 7.
      </p>
    </main>
  );
}
