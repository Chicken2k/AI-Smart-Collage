import React from 'react';
import { QueuedPost } from '../types';
import { CheckCircle, Circle, Loader2, XCircle, FileJson, Play, PauseOctagon } from 'lucide-react';

interface QueueListProps {
  queue: QueuedPost[];
  isProcessing: boolean;
  onTogglePhase2: () => void;
  onClearQueue: () => void;
}

const QueueList: React.FC<QueueListProps> = ({ queue, isProcessing, onTogglePhase2, onClearQueue }) => {
  if (queue.length === 0) return null;

  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const doneCount = queue.filter(q => q.status === 'done').length;
  const failCount = queue.filter(q => q.status === 'failed').length;

  const exportQueueJson = () => {
    const dataStr = JSON.stringify(queue, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tiktok_queue_${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="bg-tiktok-surface border border-gray-700 rounded-xl overflow-hidden shadow-xl mt-6">
        {/* Header */}
        <div className="p-4 bg-tiktok-dark border-b border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <span className="bg-tiktok-cyan text-black text-xs px-2 py-0.5 rounded font-mono">PHASE 1</span>
                    Danh Sách Quét Được
                    <span className="text-gray-400 text-sm font-normal">({queue.length} Post)</span>
                </h3>
                <div className="flex gap-4 mt-2 text-xs font-mono">
                    <span className="text-gray-400">Pending: <span className="text-white">{pendingCount}</span></span>
                    <span className="text-green-400">Done: <span className="text-white">{doneCount}</span></span>
                    <span className="text-red-400">Failed: <span className="text-white">{failCount}</span></span>
                </div>
            </div>

            <div className="flex items-center gap-2">
                <button 
                    onClick={exportQueueJson}
                    className="p-2 text-gray-400 hover:text-white border border-gray-600 rounded hover:bg-gray-700"
                    title="Export JSON"
                >
                    <FileJson size={18} />
                </button>
                <button
                     onClick={onClearQueue}
                     disabled={isProcessing}
                     className="px-3 py-2 text-red-400 hover:bg-red-900/20 rounded text-sm disabled:opacity-50"
                >
                    Xóa List
                </button>
                
                {/* TOGGLE BUTTON START/PAUSE */}
                <button
                    onClick={onTogglePhase2}
                    disabled={!isProcessing && pendingCount === 0}
                    className={`flex items-center gap-2 px-4 py-2 rounded font-bold text-sm transition-all min-w-[160px] justify-center
                        ${isProcessing 
                            ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/20 animate-pulse' 
                            : 'bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20 disabled:bg-gray-700 disabled:text-gray-500'
                        }
                    `}
                >
                    {isProcessing ? (
                        <><PauseOctagon size={16} /> DỪNG (PAUSE)</>
                    ) : (
                        <><Play size={16} /> CHẠY / TIẾP TỤC</>
                    )}
                </button>
            </div>
        </div>

        {/* Table List */}
        <div className="max-h-[300px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
                <thead className="bg-gray-800 text-xs text-gray-400 uppercase sticky top-0">
                    <tr>
                        <th className="px-4 py-2 w-16 text-center">STT</th>
                        <th className="px-4 py-2">Post ID</th>
                        <th className="px-4 py-2">Trạng Thái</th>
                        <th className="px-4 py-2 text-right">Link</th>
                    </tr>
                </thead>
                <tbody className="text-sm font-mono divide-y divide-gray-800">
                    {queue.map((item, index) => (
                        <tr key={item.id} className="hover:bg-gray-800/50 transition-colors">
                            <td className="px-4 py-2 text-center text-gray-500">{index + 1}</td>
                            <td className="px-4 py-2 text-white">{item.id}</td>
                            <td className="px-4 py-2">
                                {item.status === 'pending' && <span className="flex items-center gap-1 text-gray-500"><Circle size={14} /> Chờ</span>}
                                {item.status === 'processing' && <span className="flex items-center gap-1 text-tiktok-cyan animate-pulse"><Loader2 size={14} className="animate-spin" /> Xử lý...</span>}
                                {item.status === 'done' && <span className="flex items-center gap-1 text-green-500"><CheckCircle size={14} /> OK</span>}
                                {item.status === 'failed' && <span className="flex items-center gap-1 text-red-500" title={item.errorMsg}><XCircle size={14} /> Lỗi</span>}
                            </td>
                            <td className="px-4 py-2 text-right">
                                <a href={item.url} target="_blank" rel="noreferrer" className="text-tiktok-cyan hover:underline truncate block max-w-[200px] ml-auto">
                                    {item.url}
                                </a>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
  );
};

export default QueueList;