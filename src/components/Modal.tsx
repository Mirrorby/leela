import { tr } from '../i18n/language';
import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerDialog } from '../navigation/dialogStack';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  /** Не передан — модалку нельзя закрыть тапом по фону/Escape/крестиком (редкий случай, сейчас не используется, но задел). */
  onClose?: () => void;
  title?: ReactNode;
  ariaLabel?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Modal — единое диалоговое окно поверх GameHome, по центру экрана (не
 * нижняя шторка — правка после ревью: карточка снизу читалась как часть
 * доски и визуально путала). Ничего не знает об играх, бросках или
 * клетках — только "открыт/закрыт" и содержимое. Вся оркестрация (что
 * показать и когда) остаётся в GameHome: бросок кубика, подглядывание
 * клетки, тройная шестёрка — всё это разные наборы children, переданные в
 * один и тот же Modal.
 */
export function Modal({ open, onClose, title, ariaLabel, children, className }: ModalProps) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useLayoutEffect(() => {
    if (!open || !root.current || !panel.current) return;
    return registerDialog(root.current, panel.current, () => close.current);
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div ref={root} className="screen modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panel}
        className={`modal-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel ?? tr('Диалог')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || onClose) && (
          <div className="modal-header">
            {title ? <div id={titleId} className="modal-title">{title}</div> : <div />}
            {onClose && (
              <button className="modal-close" aria-label={tr("Закрыть")} onClick={onClose}>
                ✕
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>, document.body);
}
