/**
 * @module client/components/GameUI/ChatBox
 * Defines the Chat Box client UI component.
 */
import React, { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { gameClient } from '../../services/GameClient';
import { useGameStore } from '../../store/gameStore';
import { HudIconButton } from './HudIconButton';
import { HudPanel } from './HudPanel';

export interface ChatBoxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ChatBox: React.FC<ChatBoxProps> = ({ open, onOpenChange }) => {
  const [inputValue, setInputValue] = useState('');
  const messages = useGameStore(state => state.chatMessages);
  const currentPlayer = useGameStore(state => state.players[state.currentPlayerId]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const message = inputValue.trim();
    if (!message) return;
    gameClient.sendChatMessage(message);
    setInputValue('');
  };

  if (!open) return null;

  return (
    <HudPanel
      aria-label="Chat"
      className="absolute bottom-full right-0 mb-2 flex h-[min(22rem,calc(100vh-8rem))] w-[min(22rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-2"
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-1 pb-2">
        <MessageSquare className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-100">
            Chat
          </div>
          <div className="text-[10px] text-slate-500">
            Game channel · {currentPlayer?.name ?? 'Player'}
          </div>
        </div>
        <HudIconButton label="Close chat" onClick={() => onOpenChange(false)}>
          <X className="h-4 w-4" aria-hidden="true" />
        </HudIconButton>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-1 py-2" aria-live="polite">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">
            No messages yet. Say hello to the other players.
          </div>
        ) : (
          messages.map(message => (
            <div key={message.id} className="rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-cyan-200">{message.sender}</span>
                <time className="text-[10px] tabular-nums text-slate-600">
                  {new Date(message.timestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </div>
              <p className="mt-0.5 break-words text-slate-300">{message.message}</p>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-white/10 pt-2"
      >
        <label htmlFor="chat-message" className="sr-only">
          Message
        </label>
        <input
          id="chat-message"
          type="text"
          value={inputValue}
          onChange={event => setInputValue(event.target.value)}
          placeholder="Write a message…"
          maxLength={255}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/50 focus:ring-2 focus:ring-cyan-300/20"
        />
        <button
          type="submit"
          aria-label="Send chat message"
          disabled={!inputValue.trim()}
          className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 p-2 text-cyan-200 transition-colors hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </HudPanel>
  );
};
