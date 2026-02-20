import { CrawledPost, LogEntry, LogType, TikTokImage, QueuedPost } from '../types';
import { generateSmartMetadata } from './geminiService';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Endpoints
const API_ENDPOINT_POST = 'https://www.tikwm.com/api/';
const API_ENDPOINT_USER_FEED = 'https://www.tikwm.com/api/user/posts';

// --- HELPER FUNCTIONS ---

const extractUsername = (url: string): string | null => {
  const match = url.match(/@([a-zA-Z0-9_.]+)/);
  return match ? match[1] : null;
};

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return date.toISOString().split('T')[0];
};

const getFirstHashtag = (title: string): string => {
  const match = title.match(/#([a-zA-Z0-9_]+)/);
  return match ? match[1] : 'nohashtag';
};

/**
 * PROXY ROTATION STRATEGY (ENHANCED)
 * Includes CodeTabs (High Success Rate) and improved AllOrigins handling.
 */
const fetchWithProxy = async (targetUrl: string): Promise<any> => {
    
    const strategies = [
        // 1. CodeTabs: Thường xuyên bypass được 403 của TikWM tốt nhất
        {
            name: 'CodeTabs',
            buildUrl: (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
            isWrapped: false
        },
        // 2. AllOrigins (/get mode): Ổn định hơn /raw, trả về JSON bọc trong { contents: "..." }
        {
            name: 'AllOrigins',
            buildUrl: (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
            isWrapped: true 
        },
        // 3. CorsProxy: Backup cuối cùng
        {
            name: 'CorsProxy',
            buildUrl: (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
            isWrapped: false
        }
    ];

    let lastError: any = null;

    for (const strategy of strategies) {
        try {
            const proxyUrl = strategy.buildUrl(targetUrl);
            
            // Timeout 15s
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);

            const response = await fetch(proxyUrl, { 
                signal: controller.signal,
                headers: { 'Accept': 'application/json' }
            });
            
            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            let data = await response.json();

            // Xử lý Wrapped JSON (cho AllOrigins)
            if (strategy.isWrapped) {
                if (data.contents) {
                    try {
                        data = JSON.parse(data.contents);
                    } catch (e) {
                        // Nếu contents không phải JSON (có thể là lỗi HTML từ Cloudflare)
                        throw new Error("AllOrigins trả về dữ liệu không hợp lệ (Cloudflare Block?)");
                    }
                } else {
                    throw new Error("AllOrigins không trả về contents");
                }
            }

            // Kiểm tra Logic TikWM: Đôi khi nó trả 200 OK nhưng nội dung báo lỗi code: -1
            if (data && data.code === -1) {
                // Nếu code -1, có thể do Proxy bị chặn hoặc ID sai.
                // Ta coi như lỗi Proxy để thử Proxy khác (trừ khi msg quá rõ ràng)
                throw new Error(`TikWM API Error: ${data.msg}`);
            }

            return data; // Thành công!

        } catch (error: any) {
            // console.warn(`Proxy ${strategy.name} failed:`, error.message);
            lastError = error;
            await sleep(800); // Nghỉ nhẹ trước khi đổi chiến thuật
        }
    }

    throw new Error(`Hết cách! Tất cả Proxy đều thất bại. Lỗi cuối: ${lastError?.message || 'Unknown'}`);
};

// --- PHASE 1: SCAN LIST ONLY ---

export const scanUserDataSource = async (
    url: string,
    limit: number,
    addLog: (msg: string, type: LogType) => void
): Promise<QueuedPost[]> => {
    
    const username = extractUsername(url);
    if (!username) {
        throw new Error("Link không hợp lệ. Vui lòng nhập link kênh (VD: https://www.tiktok.com/@user)");
    }

    addLog(`🚀 PHASE 1: Bắt đầu quét @${username}`, LogType.SYSTEM);
    addLog(`🛡️ Sử dụng Proxy: CodeTabs & AllOrigins để vượt tường lửa...`, LogType.INFO);
    
    let allPosts: QueuedPost[] = [];
    let cursor = 0;
    let hasMore = true;
    let pageCount = 0;
    let consecutiveErrors = 0;

    while (hasMore && allPosts.length < limit) {
        pageCount++;
        addLog(`📄 Đang tải trang ${pageCount}... (Cursor: ${cursor})`, LogType.INFO);
        
        try {
            const targetUrl = `${API_ENDPOINT_USER_FEED}?unique_id=${username}&count=33&cursor=${cursor}`;
            const data = await fetchWithProxy(targetUrl);
            
            consecutiveErrors = 0; // Reset error count

            // Check TikWM response structure
            if (!data || !data.data) {
                addLog(`⚠️ API không trả về dữ liệu (Có thể kênh Private hoặc sai ID).`, LogType.WARNING);
                break;
            }

            const rawPosts = data.data.videos || [];
            
            if (rawPosts.length === 0) {
                hasMore = false;
                addLog(`ℹ️ Đã hết danh sách.`, LogType.INFO);
                break;
            }

            // Filter and Map
            let newItemsCount = 0;
            for (const post of rawPosts) {
                // FILTER: Only Image Carousel
                if (!post.images || post.images.length === 0) continue;

                if (allPosts.length >= limit) break;

                // Check duplicate
                if (allPosts.find(p => p.id === post.video_id)) continue;

                allPosts.push({
                    id: post.video_id,
                    url: `https://www.tiktok.com/@${post.author.unique_id}/photo/${post.video_id}`,
                    status: 'pending',
                    type: 'image',
                    scannedAt: Date.now()
                });
                newItemsCount++;
            }

            addLog(`✅ Trang ${pageCount}: +${newItemsCount} bài ảnh.`, LogType.SUCCESS);

            // Update Cursor
            if (data.data.cursor && data.data.hasMore) {
                cursor = data.data.cursor;
                await sleep(2000); // Tăng delay lên 2s để tránh bị block khi request trang tiếp theo
            } else {
                hasMore = false;
            }

        } catch (error: any) {
            consecutiveErrors++;
            addLog(`❌ Lỗi trang ${pageCount}: ${error.message}`, LogType.ERROR);
            
            if (consecutiveErrors >= 3) {
                addLog(`🔥 Dừng Phase 1 do lỗi liên tiếp (Bảo vệ IP).`, LogType.ERROR);
                break;
            }
            
            addLog(`🔄 Đang thử lại với Proxy khác...`, LogType.WARNING);
            await sleep(3000);
        }
    }

    addLog(`🏁 PHASE 1 HOÀN TẤT: ${allPosts.length} bài trong hàng đợi.`, LogType.SYSTEM);
    return allPosts;
};

// --- PHASE 2: DOWNLOAD SINGLE DETAIL ---

export const fetchPostDetails = async (
    queuedPost: QueuedPost,
    settings: any,
    addLog: (msg: string, type: LogType) => void
): Promise<CrawledPost> => {
    
    const delay = Math.floor(Math.random() * (settings.maxDelay - settings.minDelay + 1) + settings.minDelay) * 1000;
    if (delay > 0) await sleep(delay);

    addLog(`⬇️ Đang tải bài: ${queuedPost.id}`, LogType.INFO);

    const targetUrl = `${API_ENDPOINT_POST}?url=${encodeURIComponent(queuedPost.url)}`;
    
    try {
        const data = await fetchWithProxy(targetUrl);

        if (!data || !data.data) {
             throw new Error(data?.msg || 'Dữ liệu trống');
        }

        const postData = data.data;

        let images: TikTokImage[] = [];
        if (postData.images && Array.isArray(postData.images)) {
            images = postData.images.map((imgUrl: string, index: number) => ({
                url: imgUrl,
                originalName: `image_${index + 1}.jpg`
            }));
        } else {
            throw new Error("Bài viết không có ảnh (Skipping).");
        }

        if (images.length > settings.maxImagesPerPost) {
            images = images.slice(0, settings.maxImagesPerPost);
        }

        // Naming Logic
        const dateStr = formatDate(postData.create_time);
        const hashtag = getFirstHashtag(postData.title);
        let smartTitle = `post_${postData.id}_${dateStr}_${hashtag}`;
        
        return {
            id: postData.id,
            username: postData.author.unique_id,
            originalLink: queuedPost.url,
            crawledAt: new Date().toISOString(),
            caption: postData.title || '',
            hashtags: (postData.title || '').match(/#[a-z0-9_]+/gi) || [],
            images: images,
            smartTitle: smartTitle,
            isCarousel: true
        };
    } catch (err: any) {
        throw err;
    }
};