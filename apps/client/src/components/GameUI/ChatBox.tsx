import React, { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  id: string;
  timestamp: Date;
  player?: string;
  message: string;
  type: 'chat' | 'system' | 'game';
}

export const ChatBox: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      timestamp: new Date(),
      message: 'Welcome to CivJS! Type your messages here.',
      type: 'system',
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (inputValue.trim()) {
      const newMessage: ChatMessage = {
        id: Date.now().toString(),
        timestamp: new Date(),
        player: 'You',
        message: inputValue.trim(),
        type: 'chat',
      };
      
      setMessages(prev => [...prev, newMessage]);
      setInputValue('');
      
      // TODO: Send message to server via gameClient
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getMessageStyle = (type: ChatMessage['type']) => {
    switch (type) {
      case 'system':
        return 'text-yellow-400';
      case 'game':
        return 'text-green-400';
      case 'chat':
      default:
        return 'text-white';
    }
  };

  return (
    <div className={`bg-gray-900 bg-opacity-90 border border-gray-600 rounded transition-all duration-200 ${
      isExpanded ? 'h-64' : 'h-32'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-300">Chat</span>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-gray-400 hover:text-white transition-colors"
        >
          {isExpanded ? '▼' : '▲'}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs">
        {messages.map((msg) => (
          <div key={msg.id} className="flex items-start space-x-2">
            <span className="text-gray-500 flex-shrink-0 text-xs">
              {formatTime(msg.timestamp)}
            </span>
            <div className="flex-1 min-w-0">
              {msg.player && (
                <span className="text-blue-400 font-medium">{msg.player}: </span>
              )}
              <span className={getMessageStyle(msg.type)}>{msg.message}</span>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-2 border-t border-gray-700">
        <div className="flex items-center space-x-2">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your message..."
            className="flex-1 bg-gray-800 text-white text-sm px-2 py-1 rounded border border-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            maxLength={255}
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-400 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
};