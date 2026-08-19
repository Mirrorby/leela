import { useEffect, type ReactNode } from 'react';
import './Modal.css';

export interface ModalProps {
  open: boolean;
  /** Не передан — модалку нельзя закрыть тапом по фону/Escape/крестиком (редкий случай, сейчас не используется, но задел). */
  onClose?: () => void;
  title?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Modal — единая нижняя шторка поверх GameHome. Ничего не знает об играх,
 * бросках или клетках — только "открыт/закрыт" и содержимое. Вся
 * оркестрация (что показать и когда) остаётся в GameHome: бросок кубика,
 * подглядывание клетки, тройная шестёрка — всё это разные наборы children,
 * переданные в один и тот же Modal.
 */
export function Modal({ open, onClose, title, children, className }: ModalProps) {
  useEffect(() => {
    if (!open || !onClose) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className={`modal-sheet${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-grabber" aria-hidden="true" />
        {(title || onClose) && (
          <div className="modal-header">
            {title ? <div className="modal-title">{title}</div> : <div />}
            {onClose && (
              <button className="modal-close" aria-label="Закрыть" onClick={onClose}>
                ✕
              </button>
            )}
          </div>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
