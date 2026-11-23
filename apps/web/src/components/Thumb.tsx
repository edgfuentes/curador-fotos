import { memo, type DragEvent } from 'react';
import { formatWallClock, type CurationStatus, type Photo } from '@curador/core';
import { useView } from '../app/useView';

export const STATUS_LABEL: Record<CurationStatus, string> = {
  pending: 'pendiente',
  marked: 'marcada',
  discarded: 'descartada',
};

interface Props {
  photo: Photo;
  status: CurationStatus;
  selected: boolean;
  focused: boolean;
  duplicate: boolean;
  time: number | undefined;
  size: number;
  dropSide: 'before' | 'after' | null;
  onClick(e: React.MouseEvent, id: string): void;
  onDoubleClick(id: string): void;
  onDragStart(e: DragEvent, id: string): void;
  onDragOver(e: DragEvent, id: string): void;
  onDrop(e: DragEvent, id: string): void;
  onDragEnd(): void;
}

export const Thumb = memo(function Thumb(p: Props) {
  const view = useView(p.photo, 'grid', 1);
  const cls = ['tile', `is-${p.status}`, p.selected && 'is-selected', p.focused && 'is-focused', p.dropSide && `drop-${p.dropSide}`]
    .filter(Boolean)
    .join(' ');
  const time = p.time !== undefined ? formatWallClock(p.time) : 'sin fecha EXIF';
  return (
    <div
      className={cls}
      style={{ width: p.size }}
      role="gridcell"
      aria-selected={p.selected}
      data-id={p.photo.id}
      draggable
      onDragStart={(e) => p.onDragStart(e, p.photo.id)}
      onDragOver={(e) => p.onDragOver(e, p.photo.id)}
      onDrop={(e) => p.onDrop(e, p.photo.id)}
      onDragEnd={p.onDragEnd}
    >
      <button
        className="tile-btn"
        tabIndex={p.focused ? 0 : -1}
        aria-label={`${p.photo.fileName}, ${STATUS_LABEL[p.status]}, ${time}`}
        onClick={(e) => p.onClick(e, p.photo.id)}
        onDoubleClick={() => p.onDoubleClick(p.photo.id)}
      >
        <span className="tile-img" style={{ height: p.size * 0.75 }}>
          {view.status === 'ready' ? (
            <img src={view.url} alt="" draggable={false} decoding="async" />
          ) : view.status === 'loading' ? (
            <span className="tile-placeholder shimmer" />
          ) : (
            <span className="tile-placeholder no-preview">
              <span>{p.photo.extension.toUpperCase()}</span>
              <small>sin vista previa</small>
            </span>
          )}
          {p.status !== 'pending' && (
            <span className={`badge badge-${p.status}`} aria-hidden="true">
              {p.status === 'marked' ? '✓' : '✕'}
            </span>
          )}
          {p.duplicate && (
            <span className="badge badge-dup" title="Duplicado exacto de otro archivo">
              =
            </span>
          )}
        </span>
        <span className="tile-caption">
          <span className="tile-name" title={p.photo.relativePath}>
            {p.photo.fileName}
          </span>
          <span className="tile-time">{time}</span>
        </span>
      </button>
    </div>
  );
});
