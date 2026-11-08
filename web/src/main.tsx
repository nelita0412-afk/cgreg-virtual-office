import { lazy, StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles.css';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import Login, { CambiarPassword } from './pages/Login';
import Oficina from './pages/Oficina';
import { SolicitarAtencion, FirmarConsentimiento, ConsultarEstado } from './pages/Publico';
import { can, type Permiso } from '@shared/permissions';
import { ApiError } from './lib/api';
import { registrarServiceWorker, useEnLinea, useEsMovil } from './lib/pwa';
import { WifiOff } from 'lucide-react';

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
const Inicio = lazy(() => import('./pages/Inicio'));
const PortalServidor = lazy(() => import('./pages/PortalServidor'));

// Conexiones inestables: reintenta con espera creciente solo ante cortes de red o errores del servidor (nunca ante 4xx),
// y vuelve a consultar al recuperar la señal. La caché vive solo en memoria: nada clínico se guarda en el dispositivo.
const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      retry: (n, e) => (e instanceof ApiError && e.status >= 400 && e.status < 500 ? false : n < 3),
      retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    },
  },
});

function Guard({ perm, children }: { perm: Permiso[]; children: React.ReactNode }) {
  const { me } = useAuth();
  if (!perm.some((p) => can(me?.rol, p))) return <div className="p-6 text-sm muted">No tiene permisos para acceder a este módulo.</div>;
  return <>{children}</>;
}

/** Sin señal al abrir la app: explica qué pasa y vuelve a intentar sola cuando el teléfono recupera la conexión. */
function PantallaSinConexion({ reintentar }: { reintentar: () => void }) {
  const enLinea = useEnLinea();
  useEffect(() => {
    if (enLinea) reintentar();
  }, [enLinea, reintentar]);
  return (
    <div className="grid min-h-full place-items-center p-6" style={{ paddingTop: 'max(1.5rem, env(safe-area-inset-top))' }}>
      <div className="flex max-w-sm flex-col gap-4">
        <WifiOff size={36} className="text-amber-300" aria-hidden />
        <h1 className="text-2xl font-bold text-white">Sin conexión a internet</h1>
        <p className="muted">La app necesita conexión para mostrar información. Por seguridad, los datos de atenciones e historias clínicas no se guardan en el teléfono.</p>
        <p className="text-sm faint">Volverá a intentarlo sola cuando regrese la señal.</p>
        <button className="btn-primary min-h-12" onClick={reintentar}>Reintentar ahora</button>
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">Si usted o alguien cercano está en peligro, llame de inmediato al <a href="tel:911" className="font-semibold underline">ECU 911</a>.</p>
      </div>
    </div>
  );
}

function App() {
  const { me, loading, sinConexion, refetch } = useAuth();
  // Páginas públicas (sin cuenta): solicitud de atención abierta y aceptación electrónica del consentimiento.
  const path = window.location.pathname;
  const movil = useEsMovil();
  if (path.startsWith('/solicitar-atencion') || path.startsWith('/consentimiento/') || path === '/servidor' || path === '/servidor/estado') {
    return (
      <Routes>
        <Route path="/servidor" element={<Suspense fallback={<Spinner />}><PortalServidor /></Suspense>} />
        <Route path="/servidor/estado" element={<ConsultarEstado />} />
        <Route path="/solicitar-atencion" element={<SolicitarAtencion />} />
        <Route path="/consentimiento/:token" element={<FirmarConsentimiento />} />
      </Routes>
    );
  }
  if (loading) return <Spinner label="Verificando sesión…" />;
  if (sinConexion) return <PantallaSinConexion reintentar={refetch} />;
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
        {/* En el teléfono la portada es «Mi día»; en escritorio, la oficina virtual 3D. */}
        <Route index element={movil ? <Suspense fallback={<Spinner />}><Inicio /></Suspense> : <Oficina />} />
        <Route path="inicio" element={g(['oficina.ver'], <Inicio />)} />
        <Route path="oficina" element={<Oficina />} />
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

registrarServiceWorker();

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
