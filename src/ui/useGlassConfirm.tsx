import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import './GlassDialog.css';

type Question = { title: string; message: string; confirmLabel?: string; danger?: boolean };
/** Native dialog supplies focus trapping and the top layer, including over update dialogs. */
export function useGlassConfirm() {
  const [question, setQuestion] = useState<Question>();
  const answer = useRef<((accepted: boolean) => void) | undefined>(undefined);
  const element = useRef<HTMLDialogElement>(null);
  const finish = useCallback((accepted: boolean) => {
    const resolve = answer.current; answer.current = undefined;
    element.current?.close(); setQuestion(undefined); resolve?.(accepted);
  }, []);
  const confirm = useCallback((next: Question) => {
    answer.current?.(false);
    return new Promise<boolean>(resolve => { answer.current = resolve; setQuestion(next); });
  }, []);
  useEffect(() => () => { answer.current?.(false); answer.current = undefined; }, []);
  useEffect(() => {
    if (!question || !element.current) return;
    const dialog = element.current, previous = document.activeElement as HTMLElement | null;
    dialog.showModal(); dialog.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    const back = (event: Event) => { event.stopImmediatePropagation(); finish(false); };
    document.addEventListener('zenix-back', back, true);
    return () => { document.removeEventListener('zenix-back', back, true); dialog.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [question, finish]);
  const dialog = question && createPortal(<dialog ref={element} className="zenix-glass-dialog" aria-label={question.title} onCancel={event => { event.preventDefault(); finish(false); }} onKeyDown={event => event.stopPropagation()} onClick={event => { if (event.target === event.currentTarget) finish(false); }}>
    <section className="zenix-glass-dialog-card" onClick={event => event.stopPropagation()}>
      <header><h2>{question.title}</h2><button aria-label="关闭确认" onClick={() => finish(false)}><X size={18}/></button></header>
      <p>{question.message}</p>
      <footer><button data-cancel onClick={() => finish(false)}>取消</button><button className={question.danger ? 'is-danger' : 'is-primary'} onClick={() => finish(true)}>{question.confirmLabel || '确定'}</button></footer>
    </section>
  </dialog>, document.body);
  return { confirm, dialog };
}
