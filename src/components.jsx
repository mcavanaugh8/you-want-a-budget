import React, { useEffect, useRef, useId } from 'react';
import { X, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { money } from '../shared/money.js';
export function Modal({ title, subtitle, children, onClose, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const before = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      before?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <header className="modal-head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Field({ label, children, hint }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.Children.map(children, (child) =>
        React.isValidElement(child) && ['input', 'select', 'textarea'].includes(child.type)
          ? React.cloneElement(child, { id, 'aria-describedby': hint ? id + '-hint' : undefined })
          : child,
      )}
      {hint && <small id={id + '-hint'}>{hint}</small>}
    </div>
  );
}
export function Amount({ value, className = '' }) {
  return <span className={`money ${className}`}>{money(value)}</span>;
}
export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && (
        <span className="empty-icon">
          <Icon size={28} />
        </span>
      )}
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Direction({ amount }) {
  return (
    <span className={`direction ${amount >= 0 ? 'in' : 'out'}`}>
      {amount >= 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}
    </span>
  );
}
export function CategoryOptions({ data, includeReady = true }) {
  return (
    <>
      {includeReady && <option value="">Ready to assign / uncategorized</option>}
      {data.groups.map((g) => (
        <optgroup key={g.id} label={g.name}>
          {data.categories
            .filter((c) => c.groupId === g.id && !c.accountId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </optgroup>
      ))}
    </>
  );
}
