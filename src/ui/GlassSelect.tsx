import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';
import './GlassSelect.css';

type Option = { value: string; label: string };
export default function GlassSelect({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: Option[]; onChange: (value: string) => void; disabled?: boolean }) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [active, setActive] = useState(0), [position, setPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>();
  const selected = options.find(option => option.value === value);
  const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect(), edge = 12;
    const below = innerHeight - rect.bottom - edge - 8, above = rect.top - edge - 8;
    const down = below >= 180 || below >= above, maxHeight = Math.max(40, Math.min(300, down ? below : above));
    const width = Math.min(Math.max(rect.width, 280), 520, innerWidth - edge * 2);
    setPosition({ left: Math.max(edge, Math.min(rect.left, innerWidth - width - edge)), ...(down ? { top: rect.bottom + 8 } : { bottom: innerHeight - rect.top + 8 }), width, maxHeight });
    setActive(Math.max(0, options.findIndex(option => option.value === value)));
    const outside = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(); };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(); };
    const resize = () => close();
    document.addEventListener('pointerdown', outside); document.addEventListener('scroll', scroll, true); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', scroll, true); window.removeEventListener('resize', resize); };
  }, [open, value, options.length]);
  useEffect(() => { if (open && position) menu.current?.focus(); }, [open, position]);
  useEffect(() => { if (open) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [active, open, position]);
  function choose(option: Option) { close(true); if (option.value !== value) onChange(option.value); }
  return <div className="zenix-select"><button type="button" ref={trigger} className="zenix-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} title={selected?.label || value} onClick={() => setOpen(!open)} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); } }}><span>{selected?.label || value || '请选择'}</span><ChevronDown size={17}/></button>
    {open && position && createPortal(<div ref={menu} id={id} className="zenix-select-menu" style={position} role="listbox" aria-label={label} aria-activedescendant={`${id}-${active}`} tabIndex={0} onClick={event => event.stopPropagation()} onKeyDown={event => {
      if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) { event.preventDefault(); setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); }
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (options[active]) choose(options[active]); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
      else if (event.key === 'Tab') close(true);
    }}>{options.map((option, index) => <button type="button" id={`${id}-${index}`} key={option.value} role="option" tabIndex={-1} aria-selected={option.value === value} data-index={index} className={active === index ? 'is-highlighted' : ''} onPointerMove={() => setActive(index)} onClick={() => choose(option)}><span>{option.label}</span>{option.value === value && <Check size={17}/>}</button>)}</div>, document.body)}
  </div>;
}
