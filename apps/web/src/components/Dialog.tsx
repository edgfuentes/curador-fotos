import { useEffect, useRef, type ReactNode } from 'react';

/** Diálogo modal nativo (<dialog>): gestiona foco, Esc y accesibilidad. */
export function Dialog({
  title,
  onClose,
  children,
  wide,
  closable = true,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
  closable?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    // El navegador enfoca el primer botón (cerrar); preferir el campo marcado con data-autofocus.
    d?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? 'dialog dialog-wide' : 'dialog'}
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (closable) onClose();
      }}
    >
      <header className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        {closable && (
          <button className="btn btn-ghost" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        )}
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
