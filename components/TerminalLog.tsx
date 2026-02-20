import React, { useEffect, useRef } from 'react';
import { LogEntry, LogType } from '../types';
import { Terminal, AlertCircle, CheckCircle, Info, ShieldAlert } from 'lucide-react';

interface TerminalLogProps {
  logs: LogEntry[];
}

const TerminalLog: React.FC<TerminalLogProps> = ({ logs }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getIcon = (type: LogType) => {
    switch (type) {
      case LogType.SUCCESS: return <CheckCircle size={14} className="text-green-400" />;
      case LogType.ERROR: return <AlertCircle size={14} className="text-red-500" />;
      case LogType.WARNING: return <ShieldAlert size={14} className="text-yellow-400" />;
      case LogType.SYSTEM: return <Terminal size={14} className="text-tiktok-cyan" />;
      default: return <Info size={14} className="text-gray-400" />;
    }
  };

  const getColor = (type: LogType) => {
    switch (type) {
      case LogType.SUCCESS: return 'text-green-400';
      case LogType.ERROR: return 'text-red-500';
      case LogType.WARNING: return 'text-yellow-400';
      case LogType.SYSTEM: return 'text-tiktok-cyan font-bold';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="bg-tiktok-black border border-gray-800 rounded-lg overflow-hidden shadow-2xl flex flex-col h-full">
      <div className="bg-gray-900 px-4 py-2 flex items-center justify-between border-b border-gray-800">
        <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500"></div>
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <div className="w-3 h-3 rounded-full bg-green-500"></div>
        </div>
        <span className="text-xs text-gray-400 font-mono">system_logs.log</span>
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto font-mono text-sm space-y-2 bg-tiktok-black/90 backdrop-blur-sm"
        style={{ maxHeight: '300px', minHeight: '200px' }}
      >
        {logs.length === 0 && (
            <div className="text-gray-600 italic text-center mt-10">Đang chờ lệnh crawl...</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-3 animate-in fade-in slide-in-from-left-2 duration-300">
            <span className="text-gray-600 shrink-0 text-xs mt-0.5">
              [{log.timestamp.toLocaleTimeString().split(' ')[0]}]
            </span>
            <div className="mt-0.5 shrink-0">
                {getIcon(log.type)}
            </div>
            <span className={`${getColor(log.type)} break-all`}>
              {log.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TerminalLog;