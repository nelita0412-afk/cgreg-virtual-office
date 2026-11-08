import colors from 'tailwindcss/colors';

/**
 * Identidad «bienestar y tranquilidad» (CGREG Virtual Office 2.0).
 *   Verde salvia  #78958A  principal        Eucalipto claro #DCE8E1  superficies
 *   Marfil        #F5F3EC  fondo general    Arena           #C5A989  acentos
 *   Verde profundo #34483F texto y contraste
 *
 * La interfaz nació con tema oscuro y usa clases como `text-white`, `text-slate-200` o `text-cyan-300`.
 * En lugar de reescribir cientos de clases, las familias se redefinen aquí para el tema claro:
 *  - `white`/`slate` pasan a la escala de verde profundo (texto oscuro sobre marfil; `bg-white/5` = velo verde).
 *  - `cyan`/`sky`/`blue` pasan a la escala salvia, invertida (los tonos «claros» dan verde legible sobre marfil).
 *  - Los colores de estado (verde, ámbar, naranja, rojo, violeta) se invierten: conservan su significado con buen contraste.
 * Las clases nuevas del sistema usan los nombres semánticos: `salvia`, `eucalipto`, `marfil`, `arena`, `profundo`, `papel`.
 */
const invertir = (p) => ({
  50: p[950], 100: p[900], 200: p[800], 300: p[700], 400: p[600], 500: p[500],
  600: p[400], 700: p[300], 800: p[200], 900: p[100], 950: p[50],
});

const salvia = {
  50: '#F1F5F2', 100: '#DCE8E1', 200: '#C3D5CB', 300: '#A5BDB1', 400: '#8CA89C', 500: '#78958A',
  600: '#607D72', 700: '#4D665C', 800: '#3D5249', 900: '#34483F', 950: '#26352E',
};
const profundo = {
  50: '#F5F3EC', 100: '#EEF2EF', 200: '#E2E9E4', 300: '#C9D3CD', 400: '#A3B2AA', 500: '#7A8C83',
  600: '#5F7369', 700: '#4A5E54', 800: '#3F544A', 900: '#34483F', 950: '#26352E',
};
const arena = {
  50: '#FAF6F0', 100: '#F3EADF', 200: '#E8D9C6', 300: '#D9C2A6', 400: '#C5A989', 500: '#B08F6C',
  600: '#957556', 700: '#785C43', 800: '#5C4634', 900: '#46362A',
};

export default {
  content: [new URL('./web/index.html', import.meta.url).pathname, new URL('./web/src', import.meta.url).pathname + '/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        white: salvia[900],
        slate: invertir(profundo),
        gray: invertir(profundo),
        cyan: { ...invertir(salvia), 350: salvia[700] },
        sky: invertir(salvia),
        blue: invertir(salvia),
        emerald: invertir(colors.emerald),
        amber: invertir(colors.amber),
        orange: invertir(colors.orange),
        red: invertir(colors.red),
        violet: invertir(colors.violet),
        // Superficies de formularios (antes «navy»).
        navy: { 950: '#FFFFFF', 900: '#FBFAF6', 850: '#F5F3EC', 800: '#EEF2EF', 700: '#DCE8E1', 600: '#C3D5CB' },
        salvia,
        profundo,
        arena,
        eucalipto: '#DCE8E1',
        marfil: '#F5F3EC',
        papel: '#FFFFFF',
        nieve: '#FFFFFF',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
      boxShadow: {
        glow: '0 1px 2px rgba(52,72,63,.06), 0 8px 24px -12px rgba(52,72,63,.28)',
        suave: '0 1px 2px rgba(52,72,63,.05), 0 12px 32px -16px rgba(52,72,63,.22)',
      },
      transitionTimingFunction: {
        salida: 'cubic-bezier(0.23, 1, 0.32, 1)',
        cajon: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
};
