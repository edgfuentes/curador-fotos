import { useStoreApi } from '../app/context';
import { Dialog } from './Dialog';

export const SHORTCUTS: [string, string][] = [
  ['← → ↑ ↓', 'Moverse entre fotos'],
  ['Inicio / Fin', 'Primera / última foto'],
  ['Intro o Espacio', 'Abrir la foto a pantalla completa'],
  ['P', 'Marcar para publicar (otra vez: desmarcar)'],
  ['X', 'Descartar (otra vez: volver a pendiente)'],
  ['U', 'Volver a pendiente'],
  ['Z', 'Zoom al 100 % (original)'],
  ['Esc o G', 'Volver a la cuadrícula'],
  ['⌘Z / ⇧⌘Z', 'Deshacer / rehacer'],
  ['⌥← / ⌥→', 'Mover la foto en el orden manual'],
  ['⇧ + clic / ⌘ + clic', 'Seleccionar rango / varias'],
  ['⌘A', 'Seleccionar todas las visibles'],
  ['E', 'Exportar seleccionadas'],
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
        Arrastra y suelta miniaturas para fijar el orden final. El orden manual se guarda y prevalece sobre el orden por fecha;
        las fotos nuevas se intercalan por su hora de captura.
      </p>
    </Dialog>
  );
}
