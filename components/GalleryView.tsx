import React, { useState } from 'react';
import { CrawledPost } from '../types';
import { Download, Hash, Calendar, Image as ImageIcon, Loader2, Trash2, XCircle } from 'lucide-react';
import JSZip from 'jszip';

interface GalleryViewProps {
  posts: CrawledPost[];
  onRemovePost: (id: string) => void;
  onClearAll: () => void;
}

const BATCH_SIZE = 5; 
const BATCH_DELAY = 2000; 

const GalleryView: React.FC<GalleryViewProps> = ({ posts, onRemovePost, onClearAll }) => {
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; status: string } | null>(null);

  // Helper to pause execution
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Native saveAs implementation
  const saveAs = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Helper to fetch image using wsrv.nl Proxy
  const fetchImageBlob = async (url: string, attempt = 1): Promise<Blob | null> => {
    try {
      // Clean the URL: remove https:// protocol to pass to wsrv
      const cleanUrl = url.replace(/^https?:\/\//, '');
      
      // Use wsrv.nl proxy. 
      // ?url=... : The target image
      // &output=jpg : Force output format to prevent webp issues
      // &q=100 : High quality
      const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&output=jpg&q=100`;
      
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.blob();
    } catch (error) {
      console.error(`Attempt ${attempt} failed for ${url}:`, error);
      if (attempt < 3) {
        await sleep(1500 * attempt); // Backoff
        return fetchImageBlob(url, attempt + 1);
      }
      return null;
    }
  };

  const handleBatchDownload = async () => {
    setIsDownloading(true);
    
    // Chunk the posts array
    const chunks = [];
    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
        chunks.push(posts.slice(i, i + BATCH_SIZE));
    }

    const totalBatches = chunks.length;

    for (let i = 0; i < totalBatches; i++) {
        const chunk = chunks[i];
        const batchNum = i + 1;
        
        setProgress({ 
            current: batchNum, 
            total: totalBatches, 
            status: `Đang kết nối server ảnh... (Lô ${batchNum}/${totalBatches})` 
        });

        const zip = new JSZip();

        // Process posts in this chunk
        for (const post of chunk) {
            const folderName = post.smartTitle || post.id;
            const folder = zip.folder(folderName);
            
            if (folder) {
                // Add Metadata
                const metadata = {
                    id: post.id,
                    username: post.username,
                    originalLink: post.originalLink,
                    crawledAt: post.crawledAt,
                    caption: post.caption,
                    hashtags: post.hashtags
                };
                folder.file('metadata.json', JSON.stringify(metadata, null, 2));

                // Add Images
                for (let idx = 0; idx < post.images.length; idx++) {
                    const img = post.images[idx];
                    setProgress(prev => ({ ...prev!, status: `Đang tải ảnh ${idx + 1}/${post.images.length} của @${post.username}...` }));
                    
                    const blob = await fetchImageBlob(img.url);
                    if (blob) {
                        const fileName = `${post.smartTitle || 'image'}_${idx + 1}.jpg`;
                        folder.file(fileName, blob);
                    } else {
                        folder.file(`error_log_${idx}.txt`, `Failed to download: ${img.url}`);
                    }
                }
            }
        }

        // Generate and Save ZIP
        setProgress(prev => ({ ...prev!, status: `Đang nén file ZIP...` }));
        const content = await zip.generateAsync({ type: 'blob' });
        const zipName = `tiktok_images_vol_${batchNum}_${Date.now()}.zip`;
        
        saveAs(content, zipName);

        // Cooldown
        if (i < totalBatches - 1) {
            setProgress(prev => ({ ...prev!, status: `Đang chờ ${BATCH_DELAY/1000}s...` }));
            await sleep(BATCH_DELAY);
        }
    }

    setProgress({ current: totalBatches, total: totalBatches, status: "Tải xuống hoàn tất!" });
    setTimeout(() => {
        setIsDownloading(false);
        setProgress(null);
    }, 2000);
  };

  if (posts.length === 0) return null;

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 className="text-2xl font-bold flex items-center gap-2">
            <ImageIcon className="text-tiktok-pink" /> 
            Danh sách bài viết
            <span className="text-sm bg-gray-800 text-gray-300 px-2 py-1 rounded-full">{posts.length} Bài</span>
        </h3>
        
        <div className="flex items-center gap-3">
            {isDownloading && progress && (
                <div className="flex flex-col items-end mr-2">
                    <span className="text-xs font-mono text-tiktok-cyan animate-pulse">
                        {progress.status}
                    </span>
                    <div className="w-32 h-1 bg-gray-700 rounded-full mt-1 overflow-hidden">
                        <div 
                            className="h-full bg-tiktok-cyan transition-all duration-500"
                            style={{ width: `${(progress.current / progress.total) * 100}%` }}
                        ></div>
                    </div>
                </div>
            )}
            
            <button
                onClick={onClearAll}
                disabled={isDownloading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm text-red-400 border border-red-900/50 hover:bg-red-900/20 transition-all"
            >
                <Trash2 size={16} /> Xóa tất cả
            </button>

            <button 
                onClick={handleBatchDownload}
                disabled={isDownloading}
                className={`flex items-center gap-2 px-6 py-2 rounded-lg font-bold transition-all
                    ${isDownloading 
                        ? 'bg-gray-700 text-gray-400 cursor-wait' 
                        : 'bg-white text-black hover:bg-gray-200 hover:scale-105 active:scale-95'
                    }`}
            >
                {isDownloading ? (
                    <><Loader2 size={18} className="animate-spin" /> Đang tải...</>
                ) : (
                    <><Download size={18} /> Tải ZIP Ảnh</>
                )}
            </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {posts.map((post) => (
            <div key={post.id} className="bg-tiktok-surface border border-gray-700 rounded-xl overflow-hidden hover:border-gray-500 transition-colors group/card">
                <div className="p-4 border-b border-gray-700 bg-tiktok-dark flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-gray-700 to-gray-600 flex items-center justify-center font-bold text-white text-lg">
                            {post.username[0].toUpperCase()}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h4 className="font-bold text-white">@{post.username}</h4>
                                <span className="text-xs bg-tiktok-cyan/20 text-tiktok-cyan px-2 rounded">
                                    {post.isCarousel ? 'Ảnh Cuộn' : 'Video/Ảnh bìa'}
                                </span>
                            </div>
                            <div className="flex items-center gap-4 text-xs text-gray-400 mt-1">
                                <span className="flex items-center gap-1"><Calendar size={10} /> {new Date(post.crawledAt).toLocaleDateString('vi-VN')}</span>
                                <span className="flex items-center gap-1" title={post.id}><Hash size={10} /> ID: {post.id.slice(0, 10)}...</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                         {post.smartTitle && (
                            <div className="flex items-center gap-2 px-3 py-1 bg-green-900/30 border border-green-800 rounded text-green-400 text-xs">
                                <span className="font-mono">{post.smartTitle}</span>
                            </div>
                        )}
                        <button 
                            onClick={() => onRemovePost(post.id)}
                            className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-all"
                            title="Xóa bài này"
                        >
                            <XCircle size={20} />
                        </button>
                    </div>
                </div>

                <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {post.images.map((img, i) => (
                        <div key={i} className="group relative aspect-[3/4] rounded-lg overflow-hidden bg-gray-900">
                             {/* Display using wsrv to fix broken preview images if any */}
                            <img 
                                src={`https://wsrv.nl/?url=${encodeURIComponent(img.url.replace(/^https?:\/\//, ''))}&w=400&output=jpg`}
                                alt="" 
                                className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" 
                            />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                <span className="text-xs font-mono text-white bg-black/70 px-2 py-1 rounded">
                                    img_{i+1}.jpg
                                </span>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="px-4 py-3 bg-tiktok-black/50 text-sm text-gray-400 border-t border-gray-800">
                    <p className="line-clamp-2"><span className="text-tiktok-pink font-bold">Mô tả:</span> {post.caption}</p>
                </div>
            </div>
        ))}
      </div>
    </div>
  );
};

export default GalleryView;