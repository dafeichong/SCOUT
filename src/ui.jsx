import { useEffect, useRef } from 'react';

const symbols = ['✦', '◈', '✺', '✧', '❋'];
export function Card({ card, index = 0, selected = false, onClick, small = false, disabled = false }) {
  const content = <><span className="card-top">{card.value}<i>{symbols[(card.value - 1) % symbols.length]}</i></span><span className="card-symbol">{symbols[(card.value - 1) % symbols.length]}</span><span className="card-bottom">{card.other}</span></>;
  const className = `card color-${(card.value - 1) % 5} ${selected ? 'selected' : ''} ${small ? 'small' : ''}`;
  return onClick ? <button className={className} onClick={onClick} disabled={disabled} aria-pressed={selected} aria-label={`第 ${index + 1} 张：${card.value}，反向 ${card.other}`}>{content}</button> : <div className={className} aria-label={`当前 ${card.value}，反向 ${card.other}`}>{content}</div>;
}

export function Modal({ title, onClose, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) onClose(); }}>
    <div><button className="modal-close" onClick={onClose} aria-label="关闭对话框">×</button>{children}</div>
  </dialog>;
}

export function chooseRange(current, index) {
  if (!current || current[0] !== current[1]) return [index, index];
  if (current[0] === index) return null;
  return [Math.min(current[0], index), Math.max(current[0], index)];
}
