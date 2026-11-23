import { memo } from 'react';
import type { Photo, ViewSize } from '@curador/core';
import { useView } from '../../app/useView';

/** Imagen generada localmente (miniatura o vista media). */
export const MPhoto = memo(function MPhoto({
  photo,
  size,
  priority = 0,
  className,
}: {
  photo: Photo;
  size: ViewSize;
  priority?: number;
  className?: string;
}) {
  const view = useView(photo, size, priority);
  return (
    <span className={['m-photo', className].filter(Boolean).join(' ')}>
      {view.status === 'ready' ? (
        <img src={view.url} alt="" draggable={false} />
      ) : view.status === 'loading' ? (
        <span className="tile-placeholder shimmer" />
      ) : (
        <span className="tile-placeholder no-preview">
          <span>{photo.extension.toUpperCase()}</span>
        </span>
      )}
    </span>
  );
});
