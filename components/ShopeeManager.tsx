
import React, { useState, useMemo } from 'react';
import { ShoppingBag, Search, Terminal, Download, Image as ImageIcon, ExternalLink, Settings, Clipboard, FileJson, PlayCircle, Layers, ArrowUpDown, ArrowUp, ArrowDown, Tag, Filter, Loader2, Link as LinkIcon, Copy, Store, Shirt, Scissors, Sparkles, Wand2, List } from 'lucide-react';
import { LogEntry, LogType, ShopeeProduct } from '../types';
import { crawlShopeeShop, extractShopId } from '../services/shopeeService';
import JSZip from 'jszip';
import { GoogleGenAI, Type } from "@google/genai";

// Initialize Gemini
const getApiKey = () => {
    try {
      return typeof process !== 'undefined' ? process.env.API_KEY : '';
    } catch (e) {
      return '';
    }
};
const ai = new GoogleGenAI({ apiKey: getApiKey() });

const ShopeeManager: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'auto' | 'manual'>('manual'); // Default to manual as per user request
    const [inputUrl, setInputUrl] = useState('');
    const [importText, setImportText] = useState('');
    const [maxItems, setMaxItems] = useState(50);
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [products, setProducts] = useState<ShopeeProduct[]>([]);
    const [isBusy, setIsBusy] = useState(false);
    
    // Download State
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState<{ current: number, total: number, fileName: string } | null>(null);

    // AI State
    const [isAIProcessing, setIsAIProcessing] = useState(false);

    // Sorting & Filtering State
    const [sortConfig, setSortConfig] = useState<{ key: keyof ShopeeProduct | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });
    const [filterCategory, setFilterCategory] = useState<string>('all');

    const addLog = (msg: string, type: LogType) => {
        setLogs(prev => [...prev, {
            id: Math.random().toString(36),
            timestamp: new Date(),
            message: msg,
            type
        }]);
    };

    // --- HELPER: Wait ---
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // --- MAPPING ABBREVIATIONS FOR SET_CODE (PROJECT CODE) ---
    const getCategoryAbbr = (cat: string): string => {
        const map: Record<string, string> = {
            'Set Bộ': 'SB',
            'Áo Dài': 'AD',
            'Đầm/Váy': 'DV',
            'Chân Váy': 'CV',
            'Áo Khoác': 'AK',
            'Áo Len/Nỉ': 'AL',
            'Áo Sơ Mi': 'SM',
            'Áo Thun': 'AT',
            'Áo Kiểu': 'AK', // Trùng Áo Khoác nhưng ngữ cảnh khác, có thể dùng AO
            'Quần Dài': 'QD',
            'Quần Short': 'QS',
            'Quần Giả Váy': 'QG',
            'Đồ Lót': 'DL',
            'Đồ Ngủ': 'DN',
            'Đồ Bơi': 'DB',
            'Phụ Kiện': 'PK',
            'Khác': 'OT'
        };
        return map[cat] || 'OT';
    };

    // --- DETAILED FASHION CLASSIFIER LOGIC (REFINED V3) ---
    const classifyProduct = (name: string): string => {
        const n = name.toLowerCase();

        // 1. ÁO DÀI (Ưu tiên cao nhất - Fix lỗi người dùng báo)
        if (n.includes('áo dài') || n.includes('cách tân') || n.includes('nhật bình') || n.includes('tứ thân')) return 'Áo Dài';

        // 2. SET BỘ / JUMPSUIT
        if (n.includes('set') || n.includes('bộ') || n.includes('combo') || n.includes('jum') || n.includes('jumpsuit') || n.includes('suit') || n.includes('đồ bộ')) return 'Set Bộ';

        // 3. ĐỒ LÓT / ĐỒ NGỦ / ĐỒ BƠI
        if (n.includes('đồ lót') || n.includes('áo lót') || n.includes('quần lót') || n.includes('bra') || n.includes('su đúc') || n.includes('gen nịt') || n.includes('nội y') || n.includes('lọt khe')) return 'Đồ Lót';
        if (n.includes('đồ ngủ') || n.includes('pijama') || n.includes('váy ngủ') || n.includes('bộ ngủ') || n.includes('kimono')) return 'Đồ Ngủ';
        if (n.includes('bikini') || n.includes('đồ bơi') || n.includes('áo tắm') || n.includes('monokini')) return 'Đồ Bơi';

        // 4. ÁO KHOÁC (Outerwear)
        if (n.includes('khoác') || n.includes('jacket') || n.includes('blazer') || n.includes('vest') || n.includes('phao') || n.includes('gió') || n.includes('cardigan') || n.includes('măng tô') || n.includes('mangto') || n.includes('bomber') || n.includes('gile') || n.includes('varsity')) return 'Áo Khoác';

        // 5. ÁO LEN / NỈ / HOODIE (Top Warm)
        if (n.includes('len') || n.includes('dệt kim') || n.includes('hoodie') || n.includes('sweater') || n.includes('nỉ') || n.includes('lông') || n.includes('sweatshirt')) return 'Áo Len/Nỉ';

        // 6. VÁY / ĐẦM / CHÂN VÁY
        if (n.includes('chân váy') || n.includes('váy ngắn') || n.includes('váy dài') || n.includes('xếp ly') || n.includes('chữ a') || n.includes('tennis') || n.includes('tutu') || n.includes('cv ')) return 'Chân Váy';
        
        if (n.includes('đầm') || n.includes('váy') || n.includes('yếm') || n.includes('body') || n.includes('maxi') || n.includes('babydoll') || n.includes('cổ yếm')) return 'Đầm/Váy';

        // 7. QUẦN (Bottoms)
        // Lưu ý: Đã xóa "suông", "ống rộng" đứng một mình để tránh nhầm với Áo dài dáng suông
        if (n.includes('quần váy') || n.includes('giả váy')) return 'Quần Giả Váy';
        if (n.includes('short') || n.includes('quần đùi') || n.includes('quần ngố') || n.includes('quần lửng') || n.includes('biker') || n.includes('sooc') || n.includes('sóc')) return 'Quần Short';
        
        // Phải có chữ "quần" hoặc tên chất liệu quần cụ thể
        if (n.includes('quần') || n.includes('jeans') || n.includes('bò') || n.includes('kaki') || n.includes('legging') || n.includes('baggy') || n.includes('jogger') || n.includes('culottes')) return 'Quần Dài';

        // 8. ÁO (Tops)
        if (n.includes('sơ mi') || n.includes('sơmi') || n.includes('chemise')) return 'Áo Sơ Mi';
        if (n.includes('thun') || n.includes('phông') || n.includes('tee') || n.includes('t-shirt') || n.includes('polo') || n.includes('baby tee')) return 'Áo Thun';
        
        // Các loại áo còn lại
        if (n.includes('áo') || n.includes('top') || n.includes('croptop') || n.includes('2 dây') || n.includes('hai dây') || n.includes('ba lỗ') || n.includes('cúp ngực') || n.includes('trễ vai') || n.includes('bẹt vai') || n.includes('tay dài') || n.includes('tay ngắn') || n.includes('tay lỡ')) return 'Áo Kiểu';

        // 9. PHỤ KIỆN
        if (n.includes('túi') || n.includes('giày') || n.includes('dép') || n.includes('guốc') || n.includes('sandal') || n.includes('boot') || n.includes('bốt') || n.includes('nón') || n.includes('mũ') || n.includes('kính') || n.includes('thắt lưng') || n.includes('dây nịt') || n.includes('vớ') || n.includes('tất') || n.includes('băng đô') || n.includes('kẹp')) return 'Phụ Kiện';

        return 'Khác';
    };

    // Configuration for Category Filter Buttons
    const CATEGORY_CONFIG = [
        { id: 'all', label: 'Tất cả' },
        { id: 'Áo Dài', label: 'Áo Dài' },
        { id: 'Set Bộ', label: 'Set Bộ' },
        { id: 'Đầm/Váy', label: 'Đầm/Váy' },
        { id: 'Chân Váy', label: 'Chân Váy' },
        { id: 'Áo Khoác', label: 'Áo Khoác' },
        { id: 'Áo Len/Nỉ', label: 'Len/Nỉ' },
        { id: 'Áo Sơ Mi', label: 'Sơ Mi' },
        { id: 'Áo Thun', label: 'Áo Thun' },
        { id: 'Áo Kiểu', label: 'Áo Kiểu' },
        { id: 'Quần Dài', label: 'Quần Dài' },
        { id: 'Quần Short', label: 'Quần Short' },
        { id: 'Quần Giả Váy', label: 'Quần Giả Váy' },
        { id: 'Đồ Lót', label: 'Đồ Lót' },
        { id: 'Đồ Ngủ', label: 'Đồ Ngủ' },
        { id: 'Đồ Bơi', label: 'Đồ Bơi' },
        { id: 'Phụ Kiện', label: 'Phụ Kiện' },
        { id: 'Khác', label: 'Khác' },
    ];

    // --- HELPER: PAD ZERO ---
    const pad = (num: number, size: number) => {
        let s = String(num);
        while (s.length < size) s = "0" + s;
        return s;
    };

    const callAIWithRetry = async (prompt: string, retryCount = 0): Promise<any> => {
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            items: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        id: { type: Type.STRING },
                                        category: { type: Type.STRING }
                                    }
                                }
                            }
                        }
                    }
                }
            });
            return response;
        } catch (error: any) {
            if (retryCount < 5) {
                const waitTime = 15000 * (retryCount + 1); // 15s, 30s...
                addLog(`⚠️ AI bận, đang chờ ${waitTime/1000}s... (Lần ${retryCount + 1})`, LogType.WARNING);
                await wait(waitTime);
                return callAIWithRetry(prompt, retryCount + 1);
            }
            throw error;
        }
    };

    // --- AI CLASSIFICATION LOGIC ---
    const handleAIClassify = async () => {
        if (products.length === 0) return;
        const apiKey = getApiKey();
        if (!apiKey) {
            alert("Chưa cấu hình API Key để dùng tính năng AI.");
            return;
        }

        setIsAIProcessing(true);
        addLog("🤖 Đang gửi danh sách sản phẩm cho AI phân tích...", LogType.SYSTEM);

        // Batch processing to avoid token limits (20 items per batch)
        const BATCH_SIZE = 20;
        let updatedProducts = [...products];
        const batches = [];

        for (let i = 0; i < products.length; i += BATCH_SIZE) {
            batches.push(products.slice(i, i + BATCH_SIZE));
        }

        try {
            for (let i = 0; i < batches.length; i++) {
                const batch = batches[i];
                const productNames = batch.map(p => ({ id: p.itemid, name: p.name }));
                
                addLog(`🤖 Đang xử lý nhóm ${i + 1}/${batches.length}...`, LogType.INFO);

                const prompt = `
                    You are a fashion expert. Classify these products into ONE of these specific categories based on Vietnamese fashion names:
                    ['Áo Dài', 'Set Bộ', 'Đầm/Váy', 'Chân Váy', 'Áo Khoác', 'Áo Len/Nỉ', 'Áo Sơ Mi', 'Áo Thun', 'Áo Kiểu', 'Quần Dài', 'Quần Short', 'Quần Giả Váy', 'Đồ Lót', 'Đồ Ngủ', 'Đồ Bơi', 'Phụ Kiện', 'Khác'].
                    
                    Rules:
                    - "Áo dài cách tân", "Áo dài gấm" -> 'Áo Dài'
                    - "Áo phông", "Tee" -> 'Áo Thun'
                    - "Jumpsuit", "Đồ bộ" -> 'Set Bộ'
                    - "Váy" (dress) -> 'Đầm/Váy', "Chân váy" (skirt) -> 'Chân Váy'
                    
                    Input JSON: ${JSON.stringify(productNames)}
                    
                    Return a JSON object with a property 'items' which is an array of objects. Each object must have 'id' (string) and 'category' (string).
                `;

                // USE WRAPPER WITH RETRY
                const response = await callAIWithRetry(prompt);

                const resultText = response.text || '{}';
                const resultJson = JSON.parse(resultText);
                const itemsList = resultJson.items || [];
                
                // Create map from list for easier lookup
                const classificationMap: Record<string, string> = {};
                itemsList.forEach((item: any) => {
                    if(item.id && item.category) classificationMap[String(item.id)] = item.category;
                });

                // Update products locally
                updatedProducts = updatedProducts.map(p => {
                    // @ts-ignore
                    const newCat = classificationMap[String(p.itemid)];
                    if (newCat) {
                        // UPDATE SET CODE BASED ON NEW CATEGORY
                        // Format: PROJECT(2) + Last4ID(4) + "_" + SEQ(3)
                        const newAbbr = getCategoryAbbr(newCat);
                        let newSetCode = p.set_code;
                        
                        // If existing set_code follows pattern, preserve sequence logic
                        if (p.set_code && p.set_code.length >= 7) {
                            // Extract suffix (everything after first 2 chars) from old code
                            const suffix = p.set_code.slice(2); 
                            newSetCode = `${newAbbr}${suffix}`;
                        }
                        
                        return { ...p, category: newCat, set_code: newSetCode };
                    }
                    return p;
                });

                // Update UI progressively
                setProducts(updatedProducts);
                
                // CRITICAL FIX: WAIT 10 SECONDS BETWEEN BATCHES (Heavy Context)
                await wait(10000);
            }
            addLog("✅ Hoàn tất phân loại bằng AI!", LogType.SUCCESS);
        } catch (error: any) {
            addLog(`❌ Lỗi AI: ${error.message}`, LogType.ERROR);
            alert("Lỗi khi gọi AI. Vui lòng thử lại sau.");
        } finally {
            setIsAIProcessing(false);
        }
    };

    // --- SORTING & FILTERING ---
    const handleSort = (key: keyof ShopeeProduct | 'category') => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        // @ts-ignore
        setSortConfig({ key, direction });
    };

    const processedProducts = useMemo(() => {
        // 1. Filter
        let result = products;
        if (filterCategory !== 'all') {
            result = result.filter(p => p.category === filterCategory);
        }

        // 2. Sort
        if (sortConfig.key !== null) {
            result = [...result].sort((a, b) => {
                // @ts-ignore
                const aValue = a[sortConfig.key];
                // @ts-ignore
                const bValue = b[sortConfig.key];

                // Handle string comparison for Category/Name
                if (typeof aValue === 'string' && typeof bValue === 'string') {
                    return sortConfig.direction === 'asc' 
                        ? aValue.localeCompare(bValue) 
                        : bValue.localeCompare(aValue);
                }

                if (aValue < bValue) {
                    return sortConfig.direction === 'asc' ? -1 : 1;
                }
                if (aValue > bValue) {
                    return sortConfig.direction === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }
        return result;
    }, [products, sortConfig, filterCategory]);

    // --- DOWNLOAD LOGIC ---
    const sanitizeFilename = (name: string) => {
        return name.replace(/[/\\?%*:|"<>]/g, '-').trim().slice(0, 100);
    };

    const cleanId = (id: string) => {
        if (!id) return '';
        return id.replace(/_tn$/, '').trim();
    };

    const fetchImageBlob = async (url: string) => {
        try {
            // Shopee Image URL Construction
            let targetUrl = url;
            // Nếu chỉ là ID (không chứa http), ghép vào link CDN Shopee
            if (!url.startsWith('http')) {
                // Đảm bảo tải ảnh gốc (clean ID)
                targetUrl = `https://down-vn.img.susercontent.com/file/${cleanId(url)}`;
            }

            // Dùng Proxy wsrv.nl để tải ảnh về trình duyệt mà không bị lỗi CORS
            // output=jpg để đảm bảo tương thích
            const cleanUrlStr = targetUrl.replace(/^https?:\/\//, '');
            const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(cleanUrlStr)}&output=jpg&q=100`;
            
            const response = await fetch(proxyUrl);
            if (!response.ok) throw new Error('Network error');
            return await response.blob();
        } catch (error) {
            return null;
        }
    };

    const handleDownloadImages = async () => {
        if (processedProducts.length === 0) return;
        
        setIsDownloading(true);
        const zip = new JSZip();
        
        const totalProducts = processedProducts.length;
        
        try {
            for (let i = 0; i < totalProducts; i++) {
                const p = processedProducts[i];
                
                // Update Progress
                setDownloadProgress({
                    current: i + 1,
                    total: totalProducts,
                    fileName: p.name
                });

                // STRUCTURE REQUEST: 
                // Root: Category Name
                // Product Folder: {SetCode}_{ProductName}
                // Image Name: {SetCode}_{Index}.jpg
                
                const catFolder = zip.folder(sanitizeFilename(p.category || 'Khác'));
                const setCode = p.set_code || `NOCODE_${p.itemid}`;
                const productFolderName = `${setCode}_${sanitizeFilename(p.name)}`;
                const productFolder = catFolder?.folder(productFolderName);

                if (productFolder) {
                    // Lấy danh sách ảnh đã gộp
                    let allImageIds = p.images && p.images.length > 0 ? p.images : [];
                    
                    // Nếu không có list ảnh, dùng ảnh bìa làm fallback
                    if (allImageIds.length === 0 && p.image) {
                        allImageIds.push(p.image);
                    }
                    
                    // Loại bỏ trùng lặp (Strict Deduplication)
                    const uniqueSet = new Set<string>();
                    const finalIds: string[] = [];
                    
                    allImageIds.forEach(id => {
                        const clean = cleanId(id);
                        if (clean && !uniqueSet.has(clean)) {
                            uniqueSet.add(clean);
                            finalIds.push(clean);
                        }
                    });

                    if (finalIds.length === 0) {
                         productFolder.file("no_images.txt", "No images found for this product.");
                    }

                    for (let j = 0; j < finalIds.length; j++) {
                        const imgId = finalIds[j];
                        if (!imgId) continue;
                        
                        const blob = await fetchImageBlob(imgId);
                        if (blob) {
                            // IMAGE NAME: {SetCode}_{Index}.jpg
                            const imgName = `${setCode}_${pad(j + 1, 2)}.jpg`;
                            productFolder.file(imgName, blob);
                        }
                    }
                }

                // Delay nhẹ để tránh treo trình duyệt
                if (i % 5 === 0) await new Promise(r => setTimeout(r, 100));
            }

            // Generate ZIP
            setDownloadProgress({ current: totalProducts, total: totalProducts, fileName: "Đang nén file ZIP..." });
            const content = await zip.generateAsync({ type: "blob" });
            
            // Save
            const url = URL.createObjectURL(content);
            const link = document.createElement("a");
            link.href = url;
            
            // --- NEW ZIP FILENAME FORMAT: shopee_{ShopName}_{Timestamp}.zip ---
            const firstShopName = processedProducts.length > 0 ? sanitizeFilename(processedProducts[0].shop_name || 'Unknown') : 'ShopeeData';
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            const timestamp = `${yyyy}${mm}${dd}_${hh}${min}`;
            
            link.download = `shopee_${firstShopName}_${timestamp}.zip`;

            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            addLog('✅ Tải xuống file ZIP hình ảnh thành công!', LogType.SUCCESS);

        } catch (error: any) {
            addLog(`❌ Lỗi tải ảnh: ${error.message}`, LogType.ERROR);
            alert("Có lỗi xảy ra khi tải ảnh: " + error.message);
        } finally {
            setIsDownloading(false);
            setDownloadProgress(null);
        }
    };

    // --- HELPER: PARSE SOLD COUNT ---
    const parseSoldCount = (val: number, text: string): number => {
        if (val > 0) return val;
        if (!text) return 0;
        let clean = text.replace(/Đã bán|Sold|k|m/gi, (match) => {
             return match.toLowerCase() === 'k' ? 'k' : (match.toLowerCase() === 'm' ? 'm' : ''); 
        }).trim();
        let multiplier = 1;
        if (text.toLowerCase().includes('k')) multiplier = 1000;
        if (text.toLowerCase().includes('tr') || text.toLowerCase().includes('m')) multiplier = 1000000;
        clean = clean.replace(/[^0-9.,]/g, '');
        clean = clean.replace(',', '.');
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : Math.round(num * multiplier);
    };

    // --- AUTO CRAWL LOGIC ---
    const handleStartCrawl = async () => {
        if (!inputUrl) return;

        setIsBusy(true);
        setLogs([]);
        addLog(`🚀 Bắt đầu quét Shop từ URL: ${inputUrl}`, LogType.SYSTEM);

        const shopId = extractShopId(inputUrl);

        if (!shopId) {
            addLog(`❌ Không tìm thấy Shop ID. Vui lòng kiểm tra lại Link.`, LogType.ERROR);
            setIsBusy(false);
            return;
        }

        try {
            const results = await crawlShopeeShop(shopId, maxItems, addLog);

            // Add categories & Set Code
            const classified = results.map((p, idx) => {
                const cat = classifyProduct(p.name);
                const abbr = getCategoryAbbr(cat);
                
                // NEW FORMAT: PROJECT(2) + Last4ItemID(4) + "_" + SEQ(3)
                const itemIdStr = String(p.itemid);
                // Ensure at least 4 digits, pad start with 0 if necessary (though itemid usually long)
                const idSuffix = itemIdStr.length >= 4 ? itemIdStr.slice(-4) : itemIdStr.padStart(4, '0');
                
                const setCode = `${abbr}${idSuffix}_${pad(idx + 1, 3)}`;
                
                return {
                    ...p,
                    category: cat,
                    set_code: setCode
                };
            });
            
            setProducts(prev => {
                const existingIds = new Set(prev.map(p => p.itemid));
                const newItems = classified.filter(p => !existingIds.has(p.itemid));
                
                if (newItems.length > 0) {
                    addLog(`✅ Đã thêm ${newItems.length} sản phẩm mới.`, LogType.SUCCESS);
                    return [...prev, ...newItems]; // Append to end
                } else {
                    addLog(`⚠️ Không tìm thấy sản phẩm mới (trùng lặp).`, LogType.WARNING);
                    return prev;
                }
            });

        } catch (e: any) {
            addLog(`❌ Lỗi Auto Scan: ${e.message}`, LogType.ERROR);
        } finally {
            setIsBusy(false);
        }
    };

    // --- MANUAL IMPORT UTILS ---
    
    // Logic chính để xử lý JSON bạn dán vào
    const handleProcessImport = () => {
        if (!importText.trim()) return;
        setIsBusy(true);
        setLogs([]);
        
        try {
            let jsonObjects: any[] = [];
            const cleanText = importText.trim();

            try {
                const single = JSON.parse(cleanText);
                jsonObjects = [single];
            } catch (e) {
                // Hỗ trợ dán nhiều JSON object liên tiếp (nếu có)
                addLog('⚠️ Phát hiện nhiều khối dữ liệu, đang tự động ghép nối...', LogType.WARNING);
                const fixedText = '[' + cleanText
                    .replace(/}\s*{/g, '},{')
                    .replace(/]\s*\[/g, '],[')
                    .replace(/]\s*{/g, '],{')
                    .replace(/}\s*\[/g, '},[')
                    + ']';
                try {
                    jsonObjects = JSON.parse(fixedText);
                } catch (e2) {
                    throw new Error("Không thể đọc dữ liệu JSON. Vui lòng kiểm tra lại cú pháp.");
                }
            }

            let parsedProducts: ShopeeProduct[] = [];

            let globalIndex = 1; // Track index across multiple JSON blocks

            jsonObjects.forEach((rawData, index) => {
                let batchProducts: ShopeeProduct[] = [];
                let items: any[] = [];

                // 1. Tìm danh sách sản phẩm trong cấu trúc JSON (Ưu tiên cấu trúc bạn cung cấp)
                if (rawData.data?.centralize_item_card?.item_cards) {
                    items = rawData.data.centralize_item_card.item_cards;
                } else if (rawData.data?.items) {
                    items = rawData.data.items;
                } else if (Array.isArray(rawData)) {
                    // Trường hợp dán mảng trực tiếp
                    items = rawData;
                }

                if (items && Array.isArray(items)) {
                    batchProducts = items.map((item: any) => {
                         // --- MAPPING LOGIC ---
                         
                         const asset = item.item_card_displayed_asset || {};
                         const name = asset.name || item.name || "Sản phẩm không tên";
                         const mainImage = asset.image || item.image || "";
                         
                         const shopName = item.shop_data?.shop_name || item.shop_name || item.shop_location || "Unknown Shop";

                         let price = 0;
                         if (item.item_card_display_price?.price) {
                             price = item.item_card_display_price.price;
                         } else if (item.price) {
                             price = item.price;
                         }
                         if (price > 10000000) price = price / 100000;

                         let sold = item.historical_sold || 0;
                         let soldText = "";
                         if (item.item_card_display_sold_count) {
                             sold = item.item_card_display_sold_count.historical_sold_count;
                             soldText = item.item_card_display_sold_count.historical_sold_count_text;
                         }

                         let collectedImages: string[] = [];
                         if (asset.images && Array.isArray(asset.images)) {
                             collectedImages = [...asset.images];
                         }
                         if (collectedImages.length === 0 && mainImage) {
                             collectedImages.push(mainImage);
                         }

                         const uniqueSet = new Set<string>();
                         const uniqueImages: string[] = [];
                         collectedImages.forEach(img => {
                             const clean = cleanId(img);
                             if (clean && !uniqueSet.has(clean)) {
                                 uniqueSet.add(clean);
                                 uniqueImages.push(clean);
                             }
                         });

                         const cat = classifyProduct(name);
                         const abbr = getCategoryAbbr(cat);
                         
                         // Generate SET CODE: ABBR + Last4ItemID + "_" + SEQ(3)
                         const itemIdStr = String(item.itemid);
                         const idSuffix = itemIdStr.length >= 4 ? itemIdStr.slice(-4) : itemIdStr.padStart(4, '0');
                         const setCode = `${abbr}${idSuffix}_${pad(globalIndex++, 3)}`;

                         return {
                            itemid: item.itemid,
                            shopid: item.shopid,
                            shop_name: shopName,
                            name: name,
                            image: mainImage,
                            images: uniqueImages, 
                            price: price,
                            stock: item.stock || 999,
                            historical_sold: parseSoldCount(sold, soldText),
                            rating_star: item.item_rating?.rating_star || 0,
                            currency: 'VND',
                            status: 'active',
                            category: cat,
                            set_code: setCode
                         };
                    });
                }

                if (batchProducts.length > 0) {
                    addLog(`📦 Khối #${index + 1}: Phân tích thành công ${batchProducts.length} sản phẩm.`, LogType.INFO);
                    parsedProducts = [...parsedProducts, ...batchProducts];
                }
            });

            if (parsedProducts.length === 0) throw new Error("Không tìm thấy sản phẩm hợp lệ trong JSON.");

            // Gộp vào danh sách hiện tại (loại bỏ trùng itemid)
            setProducts(prev => {
                const existingIds = new Set(prev.map(p => p.itemid));
                const newItems = parsedProducts.filter(p => !existingIds.has(p.itemid));
                if (newItems.length === 0) {
                     addLog(`⚠️ Dữ liệu hợp lệ nhưng tất cả sản phẩm đã có trong danh sách.`, LogType.WARNING);
                     return prev;
                }
                addLog(`✅ Đã thêm ${newItems.length} sản phẩm mới!`, LogType.SUCCESS);
                return [...prev, ...newItems]; // Append to end
            });
            setImportText('');

        } catch (e: any) {
            addLog(`❌ Lỗi phân tích JSON: ${e.message}`, LogType.ERROR);
        } finally {
            setIsBusy(false);
        }
    };

    const downloadExcelCSV = () => {
        // Updated Header: Name moved before Link Product
        const headers = ["No", "Set Code", "Category", "Shop Name", "Name", "Link Product", "ShopID", "ItemID", "Price", "Sold", "Stock", "Rating", "Image Cover", "Total Images"];
        const rows = processedProducts.map((p, index) => {
             const imgUrl = p.image.startsWith('http') 
                ? p.image 
                : `https://down-vn.img.susercontent.com/file/${cleanId(p.image)}`;
             
             // Construct Product URL
             const productUrl = `https://shopee.vn/product/${p.shopid}/${p.itemid}`;

             return [
                index + 1,
                p.set_code || '', // Add Set Code
                p.category || 'Khác',
                `"${(p.shop_name || 'Unknown').replace(/"/g, '""')}"`, // Shop Name
                `"${p.name.replace(/"/g, '""')}"`, // Name moved here
                productUrl, // Link Product moved here
                p.shopid,
                p.itemid,
                p.price,
                p.historical_sold,
                p.stock,
                p.rating_star,
                imgUrl,
                p.images.length
            ];
        });

        const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
        const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        
        // --- NEW CSV FILENAME FORMAT: shopee_{ShopName}_{Timestamp}.csv ---
        const firstShopName = processedProducts.length > 0 ? sanitizeFilename(processedProducts[0].shop_name || 'Unknown') : 'ShopeeData';
        
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const timestamp = `${yyyy}${mm}${dd}_${hh}${min}`;

        link.download = `shopee_${firstShopName}_${timestamp}.csv`;
        
        document.body.appendChild(link);
        link.click();
    };

    const handleCopyAllLinks = () => {
         if (processedProducts.length === 0) return;
         // Changed join('\n') to join(',') as requested
         const links = processedProducts.map(p => `https://shopee.vn/product/${p.shopid}/${p.itemid}`).join(',');
         navigator.clipboard.writeText(links).then(() => {
             alert(`Đã copy ${processedProducts.length} link vào bộ nhớ tạm (ngăn cách bởi dấu phẩy)!`);
         });
    };

    // Category Buttons Component
    const CategoryButton = ({ id, label }: any) => {
        // Calculate count for this specific category
        const count = id === 'all' 
            ? products.length 
            : products.filter(p => p.category === id).length;
        
        // If count is 0 and it's not the 'All' button, don't render
        if (id !== 'all' && count === 0) return null;

        return (
            <button
                onClick={() => setFilterCategory(id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all border shrink-0 ${
                    filterCategory === id 
                    ? 'bg-orange-600 border-orange-500 text-white shadow-lg' 
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white'
                }`}
            >
                {label}
                <span className={`ml-1 text-xs px-1.5 py-0.5 rounded-full ${filterCategory === id ? 'bg-white/20' : 'bg-gray-900'}`}>
                    {count}
                </span>
            </button>
        );
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
             {/* HEADER & TABS */}
            <div className="bg-tiktok-surface p-6 rounded-xl border border-gray-700 shadow-xl">
                <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-orange-500">
                    <ShoppingBag /> Shopee Image Extractor
                </h2>

                {/* Tabs */}
                <div className="flex bg-tiktok-dark rounded-lg p-1 mb-6 border border-gray-700">
                    <button 
                        onClick={() => setActiveTab('manual')}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'manual' ? 'bg-tiktok-surface text-tiktok-cyan shadow' : 'text-gray-400 hover:text-white'}`}
                    >
                        📝 JSON Paste (Khuyên dùng)
                    </button>
                    <button 
                        onClick={() => setActiveTab('auto')}
                        className={`flex-1 py-2 text-sm font-bold rounded-md transition-all ${activeTab === 'auto' ? 'bg-tiktok-surface text-orange-500 shadow' : 'text-gray-400 hover:text-white'}`}
                    >
                        🤖 Auto Scan (Thử nghiệm)
                    </button>
                </div>

                {/* CONTENT: AUTO */}
                {activeTab === 'auto' && (
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-2">
                                Nhập Link Shop hoặc Shop ID
                            </label>
                            <input 
                                type="text" 
                                value={inputUrl}
                                onChange={(e) => setInputUrl(e.target.value)}
                                placeholder="VD: https://shopee.vn/shop-abc-123456"
                                className="w-full bg-tiktok-dark border border-gray-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-orange-500 outline-none"
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                 <label className="text-xs text-gray-500 block mb-1">Số lượng tối đa</label>
                                 <input 
                                    type="number" 
                                    value={maxItems}
                                    onChange={(e) => setMaxItems(Number(e.target.value))}
                                    className="w-full bg-gray-700 text-white rounded px-3 py-2 text-sm border border-gray-600"
                                />
                             </div>
                        </div>
                        <button
                            onClick={handleStartCrawl}
                            disabled={isBusy || !inputUrl}
                            className={`w-full py-3 rounded-lg font-bold transition-all flex items-center justify-center gap-2
                                ${isBusy 
                                    ? 'bg-gray-700 text-gray-400 cursor-wait' 
                                    : 'bg-orange-600 hover:bg-orange-500 text-white shadow-lg'
                                }`}
                        >
                            {isBusy ? 'Đang kết nối API Shopee...' : <><Search size={20}/> QUÉT SẢN PHẨM</>}
                        </button>
                    </div>
                )}

                {/* CONTENT: MANUAL (JSON Paste) */}
                {activeTab === 'manual' && (
                    <div className="animate-in fade-in zoom-in duration-300">
                         <div className="bg-blue-900/20 border border-blue-800 p-3 rounded-lg mb-4">
                            <h4 className="text-blue-400 font-bold text-sm mb-2 flex items-center gap-2"><PlayCircle size={16}/> Hướng dẫn lấy JSON chuẩn:</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-300">
                                <div>
                                    <strong className="text-white">Bước 1: Mở Network Tab</strong>
                                    <ol className="list-decimal pl-4 space-y-1 mt-1">
                                        <li>Vào Shopee (Trang Shop hoặc Search).</li>
                                        <li>Bấm <strong>F12</strong> -&gt; Tab <strong>Network</strong> -&gt; Chọn filter <strong>Fetch/XHR</strong>.</li>
                                        <li>Cuộn trang xuống để Shopee tải thêm sản phẩm.</li>
                                    </ol>
                                </div>
                                <div>
                                    <strong className="text-white">Bước 2: Copy Response</strong>
                                    <ol className="list-decimal pl-4 space-y-1 mt-1">
                                        <li>Tìm request tên: <code className="bg-gray-800 px-1 rounded text-orange-300">rcmd_items</code></li>
                                        <li>Click vào request đó -&gt; Tab <strong>Response</strong>.</li>
                                        <li>Bấm chuột phải vào nội dung -&gt; <strong>Select All</strong> -&gt; <strong>Copy</strong>.</li>
                                        <li>Dán vào ô bên dưới.</li>
                                    </ol>
                                </div>
                            </div>
                        </div>
                        <label className="block text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                            <FileJson size={16} /> Dán nội dung JSON vào đây
                        </label>
                        <textarea
                            value={importText}
                            onChange={(e) => setImportText(e.target.value)}
                            placeholder='{"error": 0, "data": { "centralize_item_card": ... } }'
                            className="w-full h-40 bg-tiktok-dark border border-gray-600 rounded-lg px-3 py-2 text-xs font-mono text-gray-300 focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                        ></textarea>
                        <button 
                            onClick={handleProcessImport}
                            disabled={!importText}
                            className="mt-4 w-full py-3 bg-tiktok-cyan hover:bg-cyan-500 text-black font-bold rounded-lg flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                        >
                            <FileJson size={18} /> PHÂN TÍCH & GỘP DỮ LIỆU
                        </button>
                    </div>
                )}
            </div>

            {/* LOGS */}
            <div className="bg-black border border-gray-800 rounded-lg p-4 font-mono text-xs h-40 overflow-y-auto">
                {logs.length === 0 && <span className="text-gray-600">Nhật ký xử lý sẽ hiện ở đây...</span>}
                {logs.map((log) => (
                    <div key={log.id} className={`mb-1 ${
                        log.type === LogType.ERROR ? 'text-red-500' :
                        log.type === LogType.SUCCESS ? 'text-green-500' :
                        log.type === LogType.WARNING ? 'text-yellow-500' :
                        'text-gray-300'
                    }`}>
                        [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                    </div>
                ))}
            </div>

            {/* RESULTS */}
            {products.length > 0 && (
                <div className="bg-tiktok-surface border border-gray-700 rounded-xl overflow-hidden">
                    
                    {/* FILTER TOOLBAR (UPDATED) */}
                    <div className="p-4 border-b border-gray-700 bg-tiktok-dark/50">
                         <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
                             <div className="flex items-center gap-2 text-gray-400 text-sm font-bold">
                                <Filter size={16} /> BỘ LỌC THỜI TRANG:
                             </div>
                             
                             {/* AI RE-CLASSIFY BUTTON */}
                             <button 
                                onClick={handleAIClassify}
                                disabled={isAIProcessing || products.length === 0}
                                className={`px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all shadow-lg
                                    ${isAIProcessing 
                                        ? 'bg-purple-900/50 text-purple-300 cursor-wait' 
                                        : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white'
                                    }
                                `}
                             >
                                {isAIProcessing ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
                                {isAIProcessing ? 'Đang phân tích...' : '✨ AI Phân Loại Lại (Chính Xác 100%)'}
                             </button>
                         </div>

                        <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                            {CATEGORY_CONFIG.map(cat => (
                                <CategoryButton key={cat.id} id={cat.id} label={cat.label} />
                            ))}
                        </div>
                    </div>

                    <div className="p-4 border-b border-gray-700 flex flex-col md:flex-row justify-between items-center bg-tiktok-dark gap-4">
                        <div className="flex flex-col">
                            <h3 className="font-bold text-white flex items-center gap-2">
                                Danh sách sản phẩm ({processedProducts.length})
                            </h3>
                            {isDownloading && downloadProgress && (
                                <span className="text-xs text-tiktok-cyan animate-pulse mt-1">
                                    Đang tải: {downloadProgress.current}/{downloadProgress.total} - {downloadProgress.fileName.slice(0, 30)}...
                                </span>
                            )}
                        </div>
                        <div className="flex gap-2">
                             <button
                                onClick={() => setProducts([])}
                                disabled={isDownloading}
                                className="bg-red-900/50 hover:bg-red-800 text-red-200 px-3 py-1.5 rounded text-sm font-bold disabled:opacity-50"
                            >
                                Xóa tất cả
                            </button>
                            <button 
                                onClick={handleCopyAllLinks}
                                disabled={isDownloading}
                                className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                                title="Copy toàn bộ link vào bộ nhớ tạm"
                            >
                                <Copy size={16} /> Copy Link
                            </button>
                            {/* REMOVED CATALOG BUTTON AS REQUESTED */}
                            <button 
                                onClick={handleDownloadImages}
                                disabled={isDownloading}
                                className={`px-3 py-1.5 rounded text-sm font-bold flex items-center gap-2 border transition-all
                                    ${isDownloading
                                        ? 'bg-gray-700 border-gray-600 text-gray-400 cursor-wait'
                                        : 'bg-tiktok-cyan text-black border-cyan-400 hover:bg-cyan-400'
                                    }`}
                            >
                                {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <ImageIcon size={16} />}
                                {isDownloading ? 'Đang nén ZIP...' : 'Tải Ảnh (ZIP)'}
                            </button>
                            <button 
                                onClick={downloadExcelCSV}
                                disabled={isDownloading}
                                className="bg-green-600 hover:bg-green-500 text-white px-3 py-1.5 rounded text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                            >
                                <Download size={16}/> Export Excel
                            </button>
                        </div>
                    </div>
                    
                    {/* PROGRESS BAR */}
                    {isDownloading && downloadProgress && (
                        <div className="h-1 w-full bg-gray-800">
                            <div 
                                className="h-full bg-tiktok-cyan transition-all duration-300"
                                style={{ width: `${(downloadProgress.current / downloadProgress.total) * 100}%` }}
                            ></div>
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-800 text-xs text-gray-400 uppercase sticky top-0">
                                <tr>
                                    <th className="px-4 py-3 w-16 text-center text-gray-500">No.</th>
                                    <th className="px-4 py-3 w-28 text-center">Set Code</th>
                                    <th 
                                        className="px-4 py-3 w-28 cursor-pointer hover:bg-gray-700 select-none group transition-colors"
                                        onClick={() => handleSort('category')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Loại
                                            {sortConfig.key === 'category' ? (
                                                sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-orange-500"/> : <ArrowDown size={14} className="text-orange-500"/>
                                            ) : <ArrowUpDown size={14} className="text-gray-600 group-hover:text-gray-400"/>}
                                        </div>
                                    </th>
                                    <th className="px-4 py-3">Hình ảnh</th>
                                    <th className="px-4 py-3">Tên sản phẩm / Shop</th>
                                    <th 
                                        className="px-4 py-3 cursor-pointer hover:bg-gray-700 select-none group transition-colors"
                                        onClick={() => handleSort('price')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Giá
                                            {sortConfig.key === 'price' ? (
                                                sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-orange-500"/> : <ArrowDown size={14} className="text-orange-500"/>
                                            ) : <ArrowUpDown size={14} className="text-gray-600 group-hover:text-gray-400"/>}
                                        </div>
                                    </th>
                                    <th 
                                        className="px-4 py-3 cursor-pointer hover:bg-gray-700 select-none group transition-colors"
                                        onClick={() => handleSort('historical_sold')}
                                    >
                                        <div className="flex items-center gap-1">
                                            Đã bán
                                            {sortConfig.key === 'historical_sold' ? (
                                                sortConfig.direction === 'asc' ? <ArrowUp size={14} className="text-orange-500"/> : <ArrowDown size={14} className="text-orange-500"/>
                                            ) : <ArrowUpDown size={14} className="text-gray-600 group-hover:text-gray-400"/>}
                                        </div>
                                    </th>
                                    <th className="px-4 py-3 text-right">Tổng Ảnh</th>
                                    <th className="px-4 py-3 w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800 text-sm">
                                {processedProducts.map((p, index) => {
                                    // Hiển thị ảnh bìa để preview (thêm _tn để nhẹ load)
                                    const previewUrl = p.image.startsWith('http') 
                                        ? p.image 
                                        : `https://down-vn.img.susercontent.com/file/${cleanId(p.image)}_tn`;
                                    
                                    // Color badge based on category
                                    let badgeColor = 'bg-gray-700 text-gray-300';
                                    if (p.category?.includes('Set')) badgeColor = 'bg-purple-900 text-purple-200';
                                    else if (p.category?.includes('Váy') || p.category?.includes('Đầm')) badgeColor = 'bg-pink-900 text-pink-200';
                                    else if (p.category?.includes('Áo Dài')) badgeColor = 'bg-red-900 text-red-200 border border-red-700';
                                    else if (p.category?.includes('Áo Khoác')) badgeColor = 'bg-blue-900 text-blue-200';
                                    else if (p.category?.includes('Áo')) badgeColor = 'bg-cyan-900 text-cyan-200';
                                    else if (p.category?.includes('Quần')) badgeColor = 'bg-green-900 text-green-200';
                                    else if (p.category?.includes('Lót') || p.category?.includes('Ngủ')) badgeColor = 'bg-rose-900 text-rose-200';

                                    const productUrl = `https://shopee.vn/product/${p.shopid}/${p.itemid}`;

                                    return (
                                        <tr key={p.itemid} className="hover:bg-gray-800/50">
                                            <td className="px-4 py-2 text-center text-gray-500 font-mono">
                                                {index + 1}
                                            </td>
                                            <td className="px-4 py-2 font-mono text-yellow-500 text-xs font-bold">
                                                {p.set_code || '-'}
                                            </td>
                                            <td className="px-4 py-2">
                                                <span className={`text-[10px] px-2 py-1 rounded font-bold whitespace-nowrap ${badgeColor}`}>
                                                    {p.category}
                                                </span>
                                            </td>
                                            <td className="px-4 py-2">
                                                <img 
                                                    src={previewUrl} 
                                                    alt="" 
                                                    className="w-12 h-12 object-cover rounded border border-gray-700"
                                                    onError={(e) => {
                                                        (e.target as HTMLImageElement).src = 'https://placehold.co/50x50?text=NoImg';
                                                    }}
                                                />
                                            </td>
                                            <td className="px-4 py-2 text-white font-medium max-w-xs truncate" title={p.name}>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <Store size={12} className="text-tiktok-cyan"/>
                                                    <span className="text-xs font-bold text-tiktok-cyan truncate">{p.shop_name}</span>
                                                </div>
                                                <a href={productUrl} target="_blank" rel="noreferrer" className="hover:text-orange-400 transition-colors block truncate">
                                                    {p.name}
                                                </a>
                                                <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                                    ID: {p.itemid} | ShopID: {p.shopid}
                                                </div>
                                            </td>
                                            <td className="px-4 py-2 text-orange-400 font-mono">
                                                {p.price.toLocaleString()} {p.currency}
                                            </td>
                                            <td className="px-4 py-2 text-gray-300 font-mono">
                                                {p.historical_sold.toLocaleString()}
                                            </td>
                                            <td className="px-4 py-2 text-right">
                                                 <span className="bg-gray-700 text-white text-xs px-2 py-1 rounded-full font-bold">
                                                    {p.images.length}
                                                 </span>
                                            </td>
                                            <td className="px-4 py-2">
                                                <a 
                                                    href={productUrl} 
                                                    target="_blank" 
                                                    rel="noreferrer"
                                                    className="text-gray-500 hover:text-white"
                                                >
                                                    <ExternalLink size={14} />
                                                </a>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShopeeManager;
