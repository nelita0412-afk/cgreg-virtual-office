import { PDFDocument, StandardFonts, rgb, degrees, type PDFFont } from 'pdf-lib';

export interface SeccionFormato {
  titulo: string;
  texto: string;
}

/** Reemplaza {{variables}} del formato. Las variables sin valor quedan como línea para completar a mano. */
export function renderSecciones(secciones: SeccionFormato[], vars: Record<string, string | null | undefined>): SeccionFormato[] {
  return secciones.map((s) => ({
    titulo: s.titulo,
    texto: s.texto.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] && String(vars[k]).trim() ? String(vars[k]) : '______________________________')),
  }));
}

// Las fuentes estándar de PDF usan WinAnsi: se sustituyen los caracteres no representables.
const limpiar = (t: string) =>
  t
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ—•…€]/g, '-');

function envolver(texto: string, font: PDFFont, size: number, ancho: number): string[] {
  const lineas: string[] = [];
  for (const parrafo of limpiar(texto).split('\n')) {
    if (!parrafo.trim()) {
      lineas.push('');
      continue;
    }
    let actual = '';
    for (const palabra of parrafo.split(/\s+/)) {
      const prueba = actual ? `${actual} ${palabra}` : palabra;
      if (font.widthOfTextAtSize(prueba, size) > ancho && actual) {
        lineas.push(actual);
        actual = palabra;
      } else actual = prueba;
    }
    lineas.push(actual);
  }
  return lineas;
}

export async function generarFormatoPdf(p: {
  titulo: string;
  servicio: string;
  version: string;
  aprobada: boolean;
  referencia?: string | null;
  secciones: SeccionFormato[];
  codigoConsentimiento?: string | null;
}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(limpiar(p.titulo));
  doc.setAuthor('CGREG — Brigada de Atención Psicosocial y de Salud');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [595.28, 841.89];
  const M = 56;
  const ancho = W - 2 * M;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const paginas = [page];
  const nueva = () => {
    page = doc.addPage([W, H]);
    paginas.push(page);
    y = H - M;
  };
  const linea = (t: string, f: PDFFont, size: number, color = rgb(0.1, 0.12, 0.2), gap = 4) => {
    if (y < M + 40) nueva();
    page.drawText(t, { x: M, y, size, font: f, color });
    y -= size + gap;
  };
  linea('CONSEJO DE GOBIERNO DEL RÉGIMEN ESPECIAL DE GALÁPAGOS', bold, 9, rgb(0.05, 0.3, 0.55));
  linea('Brigada de Atención Psicosocial y de Salud · Santa Cruz', font, 9, rgb(0.3, 0.35, 0.45), 10);
  for (const l of envolver(p.titulo, bold, 15, ancho)) linea(l, bold, 15, rgb(0.03, 0.09, 0.2), 5);
  linea(
    `Formato: ${p.servicio} · versión ${p.version} · ${p.aprobada ? `APROBADO${p.referencia ? ` (ref. ${p.referencia})` : ''}` : 'BORRADOR PENDIENTE DE APROBACIÓN INSTITUCIONAL'}`,
    font,
    8.5,
    p.aprobada ? rgb(0.1, 0.45, 0.2) : rgb(0.7, 0.2, 0.1),
    4,
  );
  if (p.codigoConsentimiento) linea(`Código de consentimiento: ${p.codigoConsentimiento}`, font, 8.5, rgb(0.3, 0.35, 0.45), 4);
  y -= 8;
  for (const s of p.secciones) {
    if (y < M + 80) nueva();
    y -= 4;
    for (const l of envolver(s.titulo, bold, 11, ancho)) linea(l, bold, 11, rgb(0.05, 0.2, 0.4), 4);
    for (const l of envolver(s.texto, font, 10, ancho)) linea(l, font, 10, rgb(0.1, 0.12, 0.2), 3.5);
    y -= 6;
  }
  paginas.forEach((pg, i) => {
    pg.drawText(limpiar(`${p.titulo} · v${p.version} · Página ${i + 1} de ${paginas.length}`), { x: M, y: 28, size: 7.5, font, color: rgb(0.45, 0.5, 0.6) });
    if (!p.aprobada) {
      pg.drawText('BORRADOR — NO VÁLIDO', { x: 110, y: 300, size: 54, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.16, rotate: degrees(40) });
    }
  });
  return doc.save();
}

/** Tipo real del archivo por su firma binaria (no se confía en la extensión ni en el encabezado HTTP). */
export function detectarMime(b: Buffer): 'application/pdf' | 'image/jpeg' | 'image/png' | null {
  if (b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}
