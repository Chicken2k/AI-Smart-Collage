import React, { useState } from 'react';
import { CrawlSettings, QueuedPost } from '../types';
import { Settings, Shield, Zap, Search, Layers, Clipboard, FileJson, PlayCircle } from 'lucide-react';

interface SettingsPanelProps {
  settings: CrawlSettings;
  setSettings: React.Dispatch<React.SetStateAction<CrawlSettings>>;
  isCrawling: boolean;
  onStartPhase1: () => void;
  onImportData: (data: QueuedPost[]) => void;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, setSettings, isCrawling, onStartPhase1, onImportData }) => {
  const [activeTab, setActiveTab] = useState<'auto' | 'manual'>('auto');
  const [importText, setImportText] = useState('');

  const handleChange = (key: keyof CrawlSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const copyScriptToClipboard = () => {
    const script = `
      // COPY TỪ DÒNG NÀY
      const links = Array.from(document.querySelectorAll('a'));
      const posts = links
        .filter(a => a.href.includes('/photo/') || (a.href.includes('/video/') && !a.href.includes('is_from_webapp')))
        .map(a => a.href)
        .filter((v, i, a) => a.indexOf(v) === i); // Unique
      
      const data = posts.map(url => {
         const id = url.split('/').pop()?.split('?')[0] || '';
         return { id, url, type: url.includes('/photo/') ? 'image' : 'video' };
      });
      console.log('Đã copy ' + data.length + ' bài!');
      copy(JSON.stringify(data));
      // HẾT
    `;
    navigator.clipboard.writeText(script);
    alert("Đã copy mã lệnh! \n1. Vào TikTok cá nhân cần tải (nhớ cuộn xuống để hiện nhiều bài)\n2. Bấm F12 -> Console\n3. Paste và Enter\n4. Quay lại đây dán kết quả.");
  };

  const handleProcessImport = () => {
    try {
        let parsed: any[] = [];
        
        // Try parsing JSON first
        try {
            parsed = JSON.parse(importText);
        } catch (e) {
            // If not JSON, try newline separated links
            parsed = importText.split('\n').filter(l => l.trim().length > 0).map(url => {
                const cleanUrl = url.trim();
                const id = cleanUrl.split('/').pop()?.split('?')[0] || `manual_${Date.now()}_${Math.random()}`;
                return { id, url: cleanUrl, type: 'image' }; // Assume image if manual link
            });
        }

        if (!Array.isArray(parsed)) throw new Error("Format không hợp lệ");

        // Convert to QueuedPost
        const queuedPosts: QueuedPost[] = parsed.map((p): QueuedPost => ({
            id: p.id || '',
            url: p.url || p,
            status: 'pending',
            type: p.type === 'video' ? 'video' : 'image', // Keep video type to filter later or simple logic
            scannedAt: Date.now()
        })).filter(p => p.url.includes('tiktok.com'));

        onImportData(queuedPosts);
        setImportText('');
    } catch (e) {
        alert("Lỗi đọc dữ liệu: Vui lòng dán đúng JSON hoặc danh sách Link.");
    }
  };

  return (
    <div className="bg-tiktok-surface p-6 rounded-xl border border-gray-700 shadow-xl">
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-white">
        <Settings className="text-tiktok-cyan" /> 
        Cấu Hình & Nguồn
      </h2>

      {/* Tabs */}
      <div className="flex bg-tiktok-dark rounded-lg p-1 mb-6 border border-gray-700">
        <button 
            onClick={() => setActiveTab('auto')}
            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'auto' ? 'bg-tiktok-surface text-tiktok-cyan shadow' : 'text-gray-400 hover:text-white'}`}
        >
            🤖 Tự Động (Auto Scan)
        </button>
        <button 
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'manual' ? 'bg-tiktok-surface text-tiktok-pink shadow' : 'text-gray-400 hover:text-white'}`}
        >
            🛠️ Thủ Công (Manual)
        </button>
      </div>

      <div className="space-y-6">
        
        {/* TAB AUTO */}
        {activeTab === 'auto' && (
            <>
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                        <Layers size={16} /> Link Kênh (Profile)
                    </label>
                    <input 
                        type="text" 
                        value={settings.url}
                        onChange={(e) => handleChange('url', e.target.value)}
                        placeholder="https://www.tiktok.com/@user"
                        className="w-full bg-tiktok-dark border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-tiktok-cyan focus:border-transparent outline-none transition-all"
                        disabled={isCrawling}
                    />
                </div>
                 {/* ... Limit Inputs (Hidden for brevity, reuse existing UI if desired or keep simple) ... */}
                 <div className="bg-tiktok-dark p-4 rounded-lg border border-gray-800">
                    <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Giới Hạn</h3>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                             <label className="text-xs text-gray-500 block mb-1">Max Post</label>
                             <input type="number" className="w-full bg-gray-700 rounded px-2 py-1 text-sm" value={settings.maxPosts} onChange={e => handleChange('maxPosts', +e.target.value)} />
                        </div>
                         <div>
                             <label className="text-xs text-gray-500 block mb-1">Ảnh/Post</label>
                             <input type="number" className="w-full bg-gray-700 rounded px-2 py-1 text-sm" value={settings.maxImagesPerPost} onChange={e => handleChange('maxImagesPerPost', +e.target.value)} />
                        </div>
                    </div>
                 </div>

                <button
                    onClick={onStartPhase1}
                    disabled={isCrawling || !settings.url}
                    className={`w-full py-4 rounded-lg font-bold text-lg uppercase tracking-wider transition-all flex items-center justify-center gap-2
                        ${isCrawling 
                            ? 'bg-gray-700 text-gray-400 cursor-not-allowed' 
                            : 'bg-white text-black border-2 border-tiktok-cyan hover:bg-tiktok-cyan hover:text-white hover:shadow-lg'
                        }
                    `}
                >
                    {isCrawling ? (
                        <>Đang Xử Lý...</>
                    ) : (
                        <><Search size={20} /> QUÉT KÊNH (AUTO)</>
                    )}
                </button>
                <p className="text-xs text-red-400 mt-2 text-center">*Nếu Auto bị lỗi 403/Kết nối, hãy dùng tab Thủ Công</p>
            </>
        )}

        {/* TAB MANUAL */}
        {activeTab === 'manual' && (
            <div className="animate-in fade-in zoom-in duration-300">
                <div className="bg-blue-900/20 border border-blue-800 p-3 rounded-lg mb-4">
                    <h4 className="text-blue-400 font-bold text-sm mb-2 flex items-center gap-2"><PlayCircle size={16}/> Cách lấy Link 100% thành công:</h4>
                    <ol className="list-decimal pl-4 text-xs text-gray-300 space-y-1">
                        <li>Mở TikTok Profile trên trình duyệt của bạn.</li>
                        <li>Cuộn chuột xuống để tải hết các bài muốn lấy.</li>
                        <li>Bấm <strong>F12</strong> (hoặc chuột phải chọn Inspect) &gt; chọn tab <strong>Console</strong>.</li>
                        <li>Bấm nút <strong>Copy Script</strong> bên dưới.</li>
                        <li>Dán (Ctrl+V) vào Console TikTok và nhấn <strong>Enter</strong>.</li>
                        <li>Quay lại đây và dán kết quả vào ô trống.</li>
                    </ol>
                    <button 
                        onClick={copyScriptToClipboard}
                        className="mt-3 w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded flex items-center justify-center gap-2 transition-colors"
                    >
                        <Clipboard size={14}/> COPY SCRIPT (JAVASCRIPT)
                    </button>
                </div>

                <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                    <FileJson size={16} /> Dán dữ liệu (JSON hoặc List Link)
                </label>
                <textarea
                    value={importText}
                    onChange={(e) => setImportText(e.target.value)}
                    placeholder='[{"id":"...", "url":"..."}, ...] HOẶC danh sách link mỗi dòng 1 cái'
                    className="w-full h-32 bg-tiktok-dark border border-gray-600 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:ring-2 focus:ring-tiktok-pink outline-none resize-none"
                ></textarea>

                <button 
                    onClick={handleProcessImport}
                    disabled={!importText}
                    className="mt-4 w-full py-3 bg-tiktok-pink hover:bg-pink-600 text-white font-bold rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <FileJson size={18} /> PHÂN TÍCH & THÊM VÀO QUEUE
                </button>
            </div>
        )}

      </div>
    </div>
  );
};

export default SettingsPanel;