import { useStoreApi } from '../app/context';
import { Dialog } from './Dialog';

export const SHORTCUTS: [string, string][] = [
  ['← → ↑ ↓', 'Moverse entre fotos'],
  ['Intro o Espacio', 'Abrir la foto a pantalla completa'],
  ['1 … 9', 'Etapa 1 · Clasificar en el sector con ese número'],
  ['0 o ⌫', 'Etapa 1 · Dejar la foto sin clasificar'],
  ['A (o P)', 'Etapa 2 · Aprobar'],
  ['R (o X)', 'Etapa 2 · Rechazar'],
  ['U', 'Etapa 2 · Dejar por validar'],
  ['Z', 'Zoom al 100 % (original)'],
  ['Esc o G', 'Volver a la cuadrícula'],
  ['⌘Z / ⇧⌘Z', 'Deshacer / rehacer'],
  ['⇧ + clic / ⌘ + clic', 'Seleccionar rango / varias'],
  ['⌘A', 'Seleccionar todas las visibles'],
  ['E', 'Exportar aprobadas'],
  ['?', 'Mostrar esta ayuda'],
];

export function HelpDialog() {
  const store = useStoreApi();
  return (
    <Dialog title="Atajos de teclado" onClose={() => store.setDialog(null)}>
      <table className="shortcuts">
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <th scope="row">
                <kbd>{k}</kbd>
              </th>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        <strong>1 · Clasificar</strong> (fotógrafo): asigna un sector a cada foto con la lista bajo la miniatura, con las teclas o
        arrastrándola a una tarjeta. <strong>2 · Validar</strong> (validador): elige un sector y aprueba o rechaza foto por foto.
        <strong> 3 · Exportar</strong>: copia solo las aprobadas, una subcarpeta por sector. Para fijar el orden final, abre el
        sector (↗) en el panel de la derecha y arrastra las fotos.
      </p>
    </Dialog>
  );
}
