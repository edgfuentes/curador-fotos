import { useMemo, useState } from 'react';
import { cameraDisplayName, formatOffset, formatWallClock, groupByCamera, UNKNOWN_CAMERA_ID, type CameraGroup } from '@curador/core';
import { useSession, useStoreApi } from '../app/context';
import { Dialog } from './Dialog';

export function CamerasDialog() {
  const store = useStoreApi();
  const photos = useSession((s) => s.photos);
  const groups = useMemo(() => groupByCamera(photos).filter((g) => g.cameraId !== UNKNOWN_CAMERA_ID), [photos]);
  const unknown = useMemo(() => photos.filter((p) => !p.camera).length, [photos]);

  return (
    <Dialog title="Cámaras y ajuste de hora" onClose={() => store.setDialog(null)} wide>
      <p className="muted">
        Si el reloj de una cámara estaba adelantado o atrasado, define un desfase. Se aplica a todas sus fotos (identificadas por
        marca, modelo y número de serie) y el orden se recalcula al instante. Los ajustes quedan guardados en este navegador.
      </p>
      {groups.length === 0 && <p>No se encontraron datos de cámara en el EXIF.</p>}
      <div className="cameras">
        {groups.map((g) => (
          <CameraRow key={g.cameraId} group={g} />
        ))}
      </div>
      {unknown > 0 && <p className="muted small">{unknown} fotos no tienen datos de cámara: se ordenan por su fecha EXIF o por nombre.</p>}
    </Dialog>
  );
}

function CameraRow({ group }: { group: CameraGroup }) {
  const store = useStoreApi();
  const settings = useSession((s) => s.cameras[group.cameraId]);
  const offset = settings?.offsetSeconds ?? 0;
  // El sentido se recuerda aunque el desfase sea 0 (para poder elegir "restar" antes de escribir los minutos).
  const [chosenSign, setChosenSign] = useState(offset < 0 ? -1 : 1);
  const sign = offset !== 0 ? (offset < 0 ? -1 : 1) : chosenSign;
  const abs = Math.abs(offset);
  const [realTime, setRealTime] = useState('');

  const setParts = (s: number, h: number, m: number, sec: number) => {
    setChosenSign(s);
    void store.updateCamera(group.cameraId, { offsetSeconds: s * (h * 3600 + m * 60 + sec) });
  };

  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const sec = abs % 60;

  const applyRealTime = () => {
    if (!realTime || group.firstMs === undefined) return;
    const [hh, mm, ss] = realTime.split(':').map(Number);
    const first = new Date(group.firstMs);
    const real = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate(), hh ?? 0, mm ?? 0, ss ?? 0);
    void store.updateCamera(group.cameraId, { offsetSeconds: Math.round((real - group.firstMs) / 1000) });
  };

  const id = `cam-${group.cameraId.replace(/[^a-z0-9]/gi, '_')}`;
  return (
    <fieldset className="camera">
      <legend>
        <strong>{cameraDisplayName(group.camera!)}</strong> <span className="muted">· {group.count} fotos</span>
      </legend>
      <div className="camera-grid">
        <label htmlFor={`${id}-label`}>Fotógrafo / etiqueta</label>
        <input
          id={`${id}-label`}
          defaultValue={settings?.label ?? ''}
          placeholder="p. ej. Ana (Canon)"
          onBlur={(e) => void store.updateCamera(group.cameraId, { label: e.target.value.trim() })}
        />

        <span id={`${id}-off`}>Desfase</span>
        <div className="offset" role="group" aria-labelledby={`${id}-off`}>
          <select aria-label="Sentido" value={sign} onChange={(e) => setParts(Number(e.target.value), h, m, sec)}>
            <option value={1}>+ sumar</option>
            <option value={-1}>− restar</option>
          </select>
          <input aria-label="Horas" type="number" min={0} max={167} value={h} onChange={(e) => setParts(sign, Number(e.target.value) || 0, m, sec)} />
          <span>h</span>
          <input aria-label="Minutos" type="number" min={0} max={59} value={m} onChange={(e) => setParts(sign, h, Number(e.target.value) || 0, sec)} />
          <span>min</span>
          <input aria-label="Segundos" type="number" min={0} max={59} value={sec} onChange={(e) => setParts(sign, h, m, Number(e.target.value) || 0)} />
          <span>s</span>
          {offset !== 0 && (
            <button className="btn btn-sm" onClick={() => void store.updateCamera(group.cameraId, { offsetSeconds: 0 })}>
              Quitar
            </button>
          )}
        </div>

        {group.firstMs !== undefined && (
          <>
            <span>Primera foto</span>
            <span>
              {formatWallClock(group.firstMs)}
              {offset !== 0 && <> → <strong>{formatWallClock(group.firstMs + offset * 1000)}</strong> ({formatOffset(offset)})</>}
            </span>
            <label htmlFor={`${id}-real`}>Hora real de esa foto</label>
            <div className="row">
              <input id={`${id}-real`} type="time" step={1} value={realTime} onChange={(e) => setRealTime(e.target.value)} />
              <button className="btn btn-sm" onClick={applyRealTime} disabled={!realTime}>
                Calcular desfase
              </button>
            </div>
          </>
        )}
      </div>
    </fieldset>
  );
}
