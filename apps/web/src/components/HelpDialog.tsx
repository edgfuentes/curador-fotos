import { useStoreApi } from '../app/context';
import { Dialog } from './Dialog';

export const SHORTCUTS: [string, string][] = [
  ['← → ↑ ↓', 'Moverse entre fotos'],
  ['Inicio / Fin', 'Primera / última foto'],
  ['Intro o Espacio', 'Abrir la foto a pantalla completa'],
  ['1 … 9', 'Marcar para el sector con ese número (panel derecho)'],
  ['P', 'Marcar en el sector de su carpeta (otra vez: desmarcar)'],
  ['X', 'Descartar (otra vez: volver a pendiente)'],
  ['U', 'Volver a pendiente'],
  ['Z', 'Zoom al 100 % (original)'],
  ['Esc o G', 'Volver a la cuadrícula'],
  ['⌘Z / ⇧⌘Z', 'Deshacer / rehacer'],
  ['⌥← / ⌥→', 'En la ventana de un sector: mover la foto en el orden'],
  ['⌫', 'En la ventana de un sector: quitar la foto del sector'],
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
        Bajo cada foto seleccionada hay una lista para marcarla en un sector, dejarla pendiente o descartarla. También puedes
        arrastrar fotos a una tarjeta del panel de sectores. Para fijar el orden final, abre el sector (↗) y arrastra las
        fotos en esa ventana: el orden manual prevalece sobre el orden por fecha.
      </p>
    </Dialog>
  );
}
