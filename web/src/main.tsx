import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import Login, { CambiarPassword } from './pages/Login';
import Oficina from './pages/Oficina';
import { SolicitarAtencion, FirmarConsentimiento } from './pages/Publico';
import { can, type Permiso } from '@shared/permissions';

const Comando = lazy(() => import('./pages/Comando'));
const Equipo = lazy(() => import('./pages/Equipo'));
const Agenda = lazy(() => import('./pages/Agenda'));
const Servidores = lazy(() => import('./pages/Servidores'));
const ServidorDetalle = lazy(() => import('./pages/ServidorDetalle'));
const Atenciones = lazy(() => import('./pages/Atenciones'));
const AtencionDetalle = lazy(() => import('./pages/AtencionDetalle'));
const Derivaciones = lazy(() => import('./pages/Derivaciones'));
const DerivacionDetalle = lazy(() => import('./pages/DerivacionDetalle'));
const Solicitudes = lazy(() => import('./pages/Solicitudes'));
const SolicitudDetalle = lazy(() => import('./pages/SolicitudDetalle'));
const Debriefing = lazy(() => import('./pages/Debriefing'));
const Capacitacion = lazy(() => import('./pages/Capacitacion'));
const Territorio = lazy(() => import('./pages/Territorio'));
const Reportes = lazy(() => import('./pages/Reportes'));
const Configuracion = lazy(() => import('./pages/Configuracion'));
const Auditoria = lazy(() => import('./pages/Auditoria'));
const AtencionPrioritaria = lazy(() => import('./pages/AtencionPrioritaria'));
const AtencionAbierta = lazy(() => import('./pages/AtencionAbierta'));
const Expedientes = lazy(() => import('./pages/Expedientes'));
const Expediente = lazy(() => import('./pages/Expediente'));

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true } } });

function Guard({ perm, children }: { perm: Permiso[]; children: React.ReactNode }) {
  const { me } = useAuth();
  if (!perm.some((p) => can(me?.rol, p))) return <div className="p-6 text-sm muted">No tiene permisos para acceder a este módulo.</div>;
  return <>{children}</>;
}

function App() {
  const { me, loading } = useAuth();
  // Páginas públicas (sin cuenta): solicitud de atención abierta y aceptación electrónica del consentimiento.
  const path = window.location.pathname;
  if (path.startsWith('/solicitar-atencion') || path.startsWith('/consentimiento/')) {
    return (
      <Routes>
        <Route path="/solicitar-atencion" element={<SolicitarAtencion />} />
        <Route path="/consentimiento/:token" element={<FirmarConsentimiento />} />
      </Routes>
    );
  }
  if (loading) return <Spinner label="Verificando sesión…" />;
  if (!me) return <Login />;
  if (me.debe_cambiar_password) return <CambiarPassword obligatorio />;
  const g = (perm: Permiso[], el: React.ReactNode) => (
    <Guard perm={perm}>
      <Suspense fallback={<Spinner />}>{el}</Suspense>
    </Guard>
  );
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Oficina />} />
        <Route path="comando" element={g(['indicadores.agregados'], <Comando />)} />
        <Route path="equipo" element={g(['equipo.ver'], <Equipo />)} />
        <Route path="agenda" element={g(['agenda.ver_todas', 'agenda.propia'], <Agenda />)} />
        <Route path="servidores" element={g(['servidores.ver_todos', 'servidores.ver_asignados'], <Servidores />)} />
        <Route path="servidores/:id" element={g(['servidores.ver_todos', 'servidores.ver_asignados'], <ServidorDetalle />)} />
        <Route path="atenciones" element={g(['agenda.ver_todas', 'agenda.propia'], <Atenciones />)} />
        <Route path="atenciones/:id" element={g(['agenda.ver_todas', 'agenda.propia'], <AtencionDetalle />)} />
        <Route path="derivaciones" element={g(['derivaciones.crear', 'derivaciones.coordinar'], <Derivaciones />)} />
        <Route path="derivaciones/:id" element={g(['derivaciones.crear', 'derivaciones.coordinar'], <DerivacionDetalle />)} />
        <Route path="solicitudes" element={g(['solicitudes.crear', 'solicitudes.gestionar'], <Solicitudes />)} />
        <Route path="solicitudes/:id" element={g(['solicitudes.crear', 'solicitudes.gestionar'], <SolicitudDetalle />)} />
        <Route path="debriefing" element={g(['actividades.ver'], <Debriefing />)} />
        <Route path="capacitacion" element={g(['actividades.ver'], <Capacitacion />)} />
        <Route path="territorio" element={g(['territorio.registrar'], <Territorio />)} />
        <Route path="reportes" element={g(['reportes.ver'], <Reportes />)} />
        <Route path="auditoria" element={g(['auditoria.ver'], <Auditoria />)} />
        <Route path="configuracion" element={g(['oficina.ver'], <Configuracion />)} />
        <Route path="atencion-prioritaria" element={g(['prioritaria.ver'], <AtencionPrioritaria />)} />
        <Route path="atencion-abierta" element={g(['abierta.ver'], <AtencionAbierta />)} />
        <Route path="historias-clinicas" element={g(['hce.ver'], <Expedientes />)} />
        <Route path="servidores/:id/expediente" element={g(['hce.ver'], <Expediente />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
