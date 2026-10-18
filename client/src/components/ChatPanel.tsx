import { useEffect, useRef, useState } from 'react';
import { MessageCircle, SendHorizontal, Sparkles, X } from 'lucide-react';
import { api, type ChatMessage, type RecipeDetail } from '../api.ts';

/** Rendu minimal du Markdown des réponses : **gras** et puces « - ». */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.replace(/^#+\s*/gm, '').replace(/^[-*]\s+/gm, '• ').split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
      )}
    </>
  );
}

const SUGGESTIONS = ['Par quoi remplacer un ingrédient qui me manque ?', 'Je peux la préparer à l’avance ?', 'Quel accompagnement avec ?'];

/** Panneau latéral repliable « Demander à l'IA » (Q16, Q39), replié par défaut. */
export function ChatPanel({ recipe }: { recipe: RecipeDetail }) {
  // ?chat=open ouvre le panneau d'emblée (captures d'écran de contrôle).
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).get('chat') === 'open');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => { api.chat(recipe.id).then(setMessages).catch(() => {}); }, [recipe.id]);
  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight, behavior: 'smooth' }); }, [messages, pending, open]);
  useEffect(() => {
    document.body.classList.toggle('chat-open', open);
    return () => document.body.classList.remove('chat-open');
  }, [open]);

  const send = async (text: string) => {
    const t = text.trim();
    if (!t || pending) return;
    setPending(t); setError(null); setInput('');
    try { setMessages(await api.ask(recipe.id, t)); }
    catch (e) { setError((e as Error).message); setInput(t); }
    finally { setPending(null); }
  };

  if (!open) {
    return (
      <button className="fab" onClick={() => setOpen(true)}>
        <MessageCircle size={18} />Demander à l'IA{messages.length > 0 && <span className="fab-count">{messages.length / 2}</span>}
      </button>
    );
  }

  return (
    <aside className="chat" aria-label="Discussion avec l'IA">
      <header className="chat-h">
        <Sparkles size={17} /><b>Demander à l'IA</b>
        <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Fermer"><X size={18} /></button>
      </header>
      <div className="chat-b" ref={body}>
        {messages.length === 0 && !pending && (
          <>
            <p className="chat-hint">L'IA connaît déjà cette recette, ton stock et tes goûts.</p>
            <div className="sugg">{SUGGESTIONS.map(s => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
          </>
        )}
        {messages.map(m => <div key={m.id} className={`msg ${m.role === 'user' ? 'me' : 'ai'}`}>{m.role === 'assistant' ? <Rich text={m.text} /> : m.text}</div>)}
        {pending && (
          <>
            <div className="msg me">{pending}</div>
            <div className="msg ai typing" aria-label="L'IA réfléchit"><i /><i /><i /></div>
          </>
        )}
        {error && <div className="chat-error">{error}</div>}
      </div>
      <form className="chat-f" onSubmit={e => { e.preventDefault(); send(input); }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Pose ta question…"
          rows={1}
          disabled={!!pending}
        />
        <button className="send" disabled={!input.trim() || !!pending} aria-label="Envoyer"><SendHorizontal size={17} /></button>
      </form>
    </aside>
  );
}
