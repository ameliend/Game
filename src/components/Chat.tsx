import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Flag, MessageCircle, Send, Trash2 } from 'lucide-react';
import { client } from '../services/client';
import { chatService } from '../services/game';
import type { Message } from '../types';
export function MessageText({ content }: { content: string }) {
  return <p className="message-content">{content}</p>;
}
export function Chat({
  userId,
  admin,
  notify,
}: {
  userId: string;
  admin: boolean;
  notify: (s: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [messages, setMessages] = useState<Message[]>([]),
    [content, setContent] = useState(''),
    [busy, setBusy] = useState(false),
    [unread, setUnread] = useState(0),
    [status, setStatus] = useState('Connexion…');
  const openRef = useRef(open);
  openRef.current = open;
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const reload = () =>
      chatService
        .history()
        .then((d) => {
          if (alive) setMessages(d);
        })
        .catch((e) => notify(e.message));
    const channel = client()
      .channel('general-chat')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        (p) => {
          const m = p.new as Message;
          setMessages((v) => (v.some((x) => x.id === m.id) ? v : [...v, m].slice(-100)));
          if (!openRef.current && m.user_id !== userId) setUnread((n) => n + 1);
        },
      )
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, (p) =>
        setMessages((v) => v.filter((m) => m.id !== p.old.id)),
      )
      .subscribe((s) => {
        if (!alive) return;
        setStatus(
          s === 'SUBSCRIBED'
            ? 'En direct'
            : s === 'CHANNEL_ERROR'
              ? 'Connexion interrompue'
              : s === 'TIMED_OUT'
                ? 'Reconnexion…'
                : 'Connexion…',
        );
        if (s === 'SUBSCRIBED') void reload();
      });
    return () => {
      alive = false;
      void client().removeChannel(channel);
    };
  }, [userId]);
  useEffect(() => {
    if (open) {
      setUnread(0);
      bottom.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [open, messages]);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || busy) return;
    setBusy(true);
    try {
      await chatService.send(content);
      setContent('');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Échec du message');
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className={`chat ${open ? 'expanded' : ''}`} aria-label="Chat général">
      <button className="chat-heading" onClick={() => setOpen(!open)} aria-expanded={open}>
        <MessageCircle size={19} />
        <strong>Place du village</strong>
        <span className="live-dot" />
        {unread > 0 && <span className="badge">{unread}</span>}
        <ChevronDown size={17} style={{ transform: open ? 'rotate(0)' : 'rotate(180deg)' }} />
      </button>
      {open && (
        <>
          <div className="chat-status">{status} · Discussion générale</div>
          <div className="messages" role="log" aria-live="polite">
            {!messages.length && <p className="empty">Dites bonjour aux autres insulaires 👋</p>}
            {messages.map((m) => (
              <article key={m.id}>
                <div className="message-meta">
                  <strong>{m.username}</strong>
                  <time>
                    {new Date(m.created_at).toLocaleTimeString('fr-FR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                  {m.user_id === userId || admin ? (
                    <button
                      aria-label="Supprimer le message"
                      onClick={() =>
                        void chatService
                          .remove(m.id)
                          .then(() => setMessages((v) => v.filter((x) => x.id !== m.id)))
                          .catch((e) => notify(e.message))
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : (
                    <button
                      aria-label="Signaler le message"
                      onClick={() =>
                        void chatService
                          .report(m.id)
                          .then(() => notify('Message signalé'))
                          .catch((e) => notify(e.message))
                      }
                    >
                      <Flag size={12} />
                    </button>
                  )}
                </div>
                <MessageText content={m.content} />
              </article>
            ))}
            <div ref={bottom} />
          </div>
          <form onSubmit={send}>
            <input
              aria-label="Message général"
              maxLength={500}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Un petit mot aux voisins…"
            />
            <button className="primary" disabled={busy || !content.trim()} aria-label="Envoyer">
              <Send size={16} />
            </button>
          </form>
          <small className="chat-counter">{content.length}/500 · 2 s entre les messages</small>
        </>
      )}
    </aside>
  );
}
