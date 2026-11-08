import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { HeartHandshake, ShieldCheck } from 'lucide-react';
import { Instalar } from '../components/AppMovil';
import { api } from '../lib/api';
import { ErrorMsg, Field, useSubmit } from '../components/ui';

export default function Login() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const s = useSubmit(
    () => api.post('/api/auth/login', { email, password }),
    () => qc.invalidateQueries({ queryKey: ['me'] }),
  );
  return (
    <div className="grid min-h-full place-items-center p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <img src="/icons/icono-192.png" alt="" className="h-14 w-14 shrink-0 rounded-2xl shadow-glow" />
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-cyan-200">Consejo de Gobierno del Régimen Especial de Galápagos</div>
            <h1 className="text-2xl font-bold tracking-tight">CGREG Virtual Office</h1>
            <div className="text-sm muted">Centro Digital de Operaciones de Atención Interdisciplinaria</div>
          </div>
        </div>
        <form
          className="panel space-y-4 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            s.run(undefined);
          }}
        >
          <Field label="Correo institucional">
            <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Contraseña">
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorMsg error={s.error} />
          <button className="btn-primary min-h-12 w-full" disabled={s.busy}>{s.busy ? 'Ingresando…' : 'Ingresar'}</button>
          <p className="flex gap-2 text-[11px] leading-snug faint">
            <ShieldCheck size={14} className="shrink-0" />
            Acceso restringido. La información se trata conforme a la Ley Orgánica de Protección de Datos Personales. Todas las acciones quedan registradas.
          </p>
        </form>
        <div className="mt-4 flex flex-col gap-3">
          <Link to="/servidor" reloadDocument className="flex min-h-14 items-center gap-3 rounded-2xl border px-4 text-sm transition-colors hover:bg-white/5" style={{ borderColor: 'var(--line)' }}>
            <HeartHandshake size={20} className="shrink-0 text-cyan-300" aria-hidden />
            <span><span className="font-semibold text-white">¿Es servidor del CGREG y necesita apoyo?</span> <span className="muted">Solicite atención sin cuenta.</span></span>
          </Link>
          <div className="rounded-2xl border p-4" style={{ borderColor: 'var(--line)' }}><Instalar /></div>
        </div>
      </div>
    </div>
  );
}

export function CambiarPassword({ obligatorio }: { obligatorio?: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ actual: '', nueva: '', repetir: '' });
  const [ok, setOk] = useState(false);
  const s = useSubmit(
    async () => {
      if (f.nueva !== f.repetir) throw new Error('Las contraseñas no coinciden.');
      await api.post('/api/auth/password', { actual: f.actual, nueva: f.nueva });
    },
    () => {
      setOk(true);
      setF({ actual: '', nueva: '', repetir: '' });
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  );
  const form = (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        s.run(undefined);
      }}
    >
      <Field label="Contraseña actual"><input className="input" type="password" autoComplete="current-password" required value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} /></Field>
      <Field label="Nueva contraseña" hint="Mínimo 12 caracteres, con letras y números."><input className="input" type="password" autoComplete="new-password" required value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} /></Field>
      <Field label="Repetir nueva contraseña"><input className="input" type="password" autoComplete="new-password" required value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} /></Field>
      <ErrorMsg error={s.error} />
      {ok && <div className="text-sm text-emerald-300">Contraseña actualizada. Se cerraron sus otras sesiones.</div>}
      <button className="btn-primary" disabled={s.busy}>Cambiar contraseña</button>
    </form>
  );
  if (!obligatorio) return form;
  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="panel w-full max-w-md p-6">
        <h1 className="mb-1 text-xl font-semibold">Cambie su contraseña temporal</h1>
        <p className="mb-4 text-sm muted">Por seguridad, debe definir una contraseña personal antes de continuar.</p>
        {form}
      </div>
    </div>
  );
}
