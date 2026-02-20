
import React, { useState, useCallback, useRef } from 'react';
import SettingsPanel from './components/SettingsPanel';
import TerminalLog from './components/TerminalLog';
import GalleryView from './components/GalleryView';
import QueueList from './components/QueueList';
import ShopeeManager from './components/ShopeeManager'; // Import Shopee Component
import CollageManager from './components/CollageManager'; // Import Collage Component
import { scanUserDataSource, fetchPostDetails } from './services/crawlerService';
import { CrawlSettings, CrawledPost, LogEntry, LogType, QueuedPost } from './types';
import { Layers, Zap, Info, ShoppingBag, Video, Layout } from 'lucide-react';

const App: React.FC = () => {
  // --- GLOBAL STATE ---
  const [currentModule, setCurrentModule] = useState<'tiktok' | 'shopee' | 'collage'>('tiktok');

  // --- TIKTOK STATE ---
  const [isBusy, setIsBusy] = useState(false); 
  const [isPhase2Running, setIsPhase2Running] = useState(false);
  
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [queue, setQueue] = useState<QueuedPost[]>([]);
  const [results, setResults] = useState<CrawledPost[]>([]);
  const stopPhase2Ref = useRef(false);
  
  const [settings, setSettings] = useState<CrawlSettings>({
    url: '',
    maxPosts: 50, 
    maxImagesPerPost: 10,
    minDelay: 2,
    maxDelay: 5,
    useSmartNaming: true,
  });

  const addLog = useCallback((message: string, type: LogType) => {
    setLogs(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      timestamp: new Date(),
      message,
      type
    }]);
  }, []);

  const handleRemovePost = useCallback((id: string) => {
    setResults(prev => prev.filter(post => post.id !== id));
  }, []);

  const handleClearAll = useCallback(() => {
    if (window.confirm('Xóa kết quả đã tải?')) {
      setResults([]);
    }
  }, []);

  const handleClearQueue = useCallback(() => {
      setQueue([]);
      addLog('Đã xóa danh sách hàng đợi.', LogType.SYSTEM);
  }, [addLog]);

  const handleImportData = useCallback((importedPosts: QueuedPost[]) => {
      addLog(`📥 Đã nhận ${importedPosts.length} bài từ nhập thủ công.`, LogType.SYSTEM);
      const imagePosts = importedPosts.filter(p => p.type !== 'video' || p.url.includes('photo'));
      setQueue(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNewItems = imagePosts.filter(p => !existingIds.has(p.id));
          if (uniqueNewItems.length === 0) {
              addLog('⚠️ Tất cả bài nhập vào đều đã tồn tại trong hàng đợi.', LogType.WARNING);
              return prev;
          }
          addLog(`✅ Đã thêm ${uniqueNewItems.length} bài mới vào hàng đợi Phase 1.`, LogType.SUCCESS);
          return [...prev, ...uniqueNewItems];
      });
  }, [addLog]);

  const startPhase1 = async () => {
    if (!settings.url) {
      addLog("Vui lòng nhập URL Kênh.", LogType.ERROR);
      return;
    }
    setIsBusy(true);
    setLogs([]); 
    try {
      const newItems = await scanUserDataSource(settings.url, settings.maxPosts, addLog);
      setQueue(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const uniqueNewItems = newItems.filter(p => !existingIds.has(p.id));
          return [...prev, ...uniqueNewItems];
      });
    } catch (error: any) {
      addLog(`Lỗi Phase 1: ${error.message}`, LogType.ERROR);
    } finally {
      setIsBusy(false);
    }
  };

  const handleTogglePhase2 = async () => {
      if (isPhase2Running) {
          stopPhase2Ref.current = true;
          addLog('⏸️ Đang gửi lệnh tạm dừng...', LogType.WARNING);
          return;
      }
      if (queue.length === 0) return;

      setIsPhase2Running(true);
      setIsBusy(true);
      stopPhase2Ref.current = false;
      addLog('🚀 BẮT ĐẦU / TIẾP TỤC PHASE 2...', LogType.SYSTEM);

      const processNext = async () => {
          if (stopPhase2Ref.current) {
              setIsPhase2Running(false);
              setIsBusy(false);
              addLog('⏹️ Đã tạm dừng Phase 2.', LogType.WARNING);
              return;
          }

          let nextItem: QueuedPost | null = null;
          setQueue(currentQueue => {
              const idx = currentQueue.findIndex(q => q.status === 'pending');
              if (idx !== -1) {
                  nextItem = currentQueue[idx];
                  const newQ = [...currentQueue];
                  newQ[idx] = { ...newQ[idx], status: 'processing' };
                  return newQ;
              }
              return currentQueue;
          });

          await new Promise(r => setTimeout(r, 100));

          if (!nextItem) {
              addLog('🏁 PHASE 2 HOÀN TẤT.', LogType.SUCCESS);
              setIsPhase2Running(false);
              setIsBusy(false);
              return;
          }

          const itemToProcess = nextItem as QueuedPost;
          try {
              const result = await fetchPostDetails(itemToProcess, settings, addLog);
              setResults(prev => [result, ...prev]);
              setQueue(prev => prev.map(p => p.id === itemToProcess.id ? { ...p, status: 'done', data: result } : p));
          } catch (error: any) {
              addLog(`❌ Lỗi tải bài ${itemToProcess.id}: ${error.message}`, LogType.ERROR);
              setQueue(prev => prev.map(p => p.id === itemToProcess.id ? { ...p, status: 'failed', errorMsg: error.message } : p));
          }
          processNext();
      };
      processNext();
  };

  return (
    <div className="min-h-screen bg-tiktok-black pb-20">
      
      {/* Header */}
      <header className="border-b border-gray-800 sticky top-0 z-50 bg-tiktok-black/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
             <div className="bg-gradient-to-br from-tiktok-cyan to-tiktok-pink p-2 rounded-lg">
                <Layers className="text-white" size={24} />
             </div>
             <div>
                <h1 className="text-xl font-bold tracking-tight text-white">Universal <span className="text-tiktok-cyan">Crawler</span></h1>
                <p className="text-xs text-gray-400">Multi-platform Data Tool</p>
             </div>
          </div>

          {/* MAIN NAVIGATION TABS */}
          <div className="flex bg-gray-900 p-1 rounded-lg border border-gray-700 overflow-x-auto">
              <button
                onClick={() => setCurrentModule('tiktok')}
                className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap
                    ${currentModule === 'tiktok' 
                        ? 'bg-tiktok-surface text-tiktok-cyan shadow-lg' 
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'}
                `}
              >
                <Video size={16} /> TikTok
              </button>
              <button
                onClick={() => setCurrentModule('shopee')}
                className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap
                    ${currentModule === 'shopee' 
                        ? 'bg-tiktok-surface text-orange-500 shadow-lg' 
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'}
                `}
              >
                <ShoppingBag size={16} /> Shopee
              </button>
              <button
                onClick={() => setCurrentModule('collage')}
                className={`flex items-center gap-2 px-6 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap
                    ${currentModule === 'collage' 
                        ? 'bg-tiktok-surface text-purple-400 shadow-lg' 
                        : 'text-gray-400 hover:text-white hover:bg-gray-800'}
                `}
              >
                <Layout size={16} /> AI Collage
              </button>
          </div>

          <div className="text-xs text-gray-500 border border-gray-800 px-3 py-1 rounded-full hidden md:block">
            Mode: <span className="text-white uppercase">{currentModule}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        
        {/* === TIKTOK MODULE === */}
        {currentModule === 'tiktok' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-6 bg-gray-900 border border-gray-700 p-4 rounded-lg flex gap-3 text-sm text-gray-300">
                    <span className="shrink-0 text-tiktok-cyan"><Info size={20} /></span>
                    <div>
                        <strong className="text-white block mb-1">Mẹo xử lý khi lỗi Proxy (403):</strong>
                        <ul className="list-disc pl-4 space-y-1 text-gray-400 text-xs">
                            <li>Dùng tab <strong>"Thủ Công (Manual)"</strong> và script có sẵn để lấy link 100% thành công.</li>
                        </ul>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                    <div className="lg:col-span-4 space-y-6">
                        <SettingsPanel 
                            settings={settings} 
                            setSettings={setSettings} 
                            isCrawling={isBusy}
                            onStartPhase1={startPhase1}
                            onImportData={handleImportData}
                        />
                        <div className="h-[400px]">
                            <TerminalLog logs={logs} />
                        </div>
                    </div>

                    <div className="lg:col-span-8 space-y-8">
                        <QueueList 
                            queue={queue} 
                            isProcessing={isPhase2Running} 
                            onTogglePhase2={handleTogglePhase2}
                            onClearQueue={handleClearQueue}
                        />
                        {results.length > 0 && (
                            <GalleryView 
                                posts={results} 
                                onRemovePost={handleRemovePost}
                                onClearAll={handleClearAll}
                            />
                        )}
                        {queue.length === 0 && results.length === 0 && (
                            <div className="h-[200px] flex flex-col items-center justify-center text-gray-600 border-2 border-dashed border-gray-800 rounded-xl">
                                <Layers size={48} className="mb-4 opacity-30" />
                                <p>TikTok Downloader Ready</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {/* === SHOPEE MODULE === */}
        {currentModule === 'shopee' && (
            <ShopeeManager />
        )}

        {/* === COLLAGE MODULE === */}
        {currentModule === 'collage' && (
            <CollageManager />
        )}

      </main>
    </div>
  );
};

export default App;
