
import React, { useState, useRef } from 'react';
import { Layout as LayoutIcon, Image as ImageIcon, Sparkles, Upload, Grid, Columns, Rows, Download, Trash2, XCircle, CheckCircle, Eraser, Loader2, Type as TypeIcon, AlignLeft, AlignCenter, FolderInput, Play, Archive, RefreshCw, Settings, Repeat, ZapOff, Zap, Scissors, MoveHorizontal, User, Users, FileText, Hash, Calendar, RefreshCcw, Save, MessageSquare, Tag, Wand2 } from 'lucide-react';
import { LocalImage, LayoutType, LogType, BatchFolderItem, LogoBox } from '../types';
import { GoogleGenAI, Type } from "@google/genai";
import { generateCollage, processAndCropSingleImage, processCoverImage916 } from '../services/collageService';
import JSZip from 'jszip';

// Initialize Gemini (Reusing existing env key logic)
const getApiKey = () => {
    try {
      return typeof process !== 'undefined' ? process.env.API_KEY : '';
    } catch (e) {
      return '';
    }
};
const ai = new GoogleGenAI({ apiKey: getApiKey() });

const CollageManager: React.FC = () => {
    // MODES: Single vs Batch
    const [mode, setMode] = useState<'single' | 'batch'>('single');

    // SINGLE MODE STATE
    const [images, setImages] = useState<LocalImage[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [selectedLayout, setSelectedLayout] = useState<LayoutType>('2x1');
    const [collageResult, setCollageResult] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    
    // BATCH MODE STATE
    const [batchQueue, setBatchQueue] = useState<BatchFolderItem[]>([]);
    const [isBatchProcessing, setIsBatchProcessing] = useState(false);
    const [isDownloadingBatch, setIsDownloadingBatch] = useState(false);
    
    // BATCH CONFIG
    const [startSetNum, setStartSetNum] = useState(1);
    const [endSetNum, setEndSetNum] = useState(4); // CHANGED: Explicit End Set instead of Cycle
    const [batchPrefix, setBatchPrefix] = useState('Set'); // NEW: Custom Prefix
    const [useBatchAI, setUseBatchAI] = useState(true); // Toggle AI for Batch
    // NEW: Filter Mode (Single Person vs Smart Fallback)
    const [modelFilterMode, setModelFilterMode] = useState<'strict' | 'smart'>('smart');
    
    // CAPTION CONFIG
    const [batchTitle, setBatchTitle] = useState(''); // Title Input
    const [batchProductType, setBatchProductType] = useState(''); // NEW: Product Type Input
    const [batchOccasion, setBatchOccasion] = useState(''); // Occasion Input
    const [batchHashtags, setBatchHashtags] = useState('#thoitrang #xuhuong #ootd');
    
    // AI HOOK STATE
    const [generatedHooks, setGeneratedHooks] = useState<string[]>([]); // Store multiple hooks
    const [isGeneratingHook, setIsGeneratingHook] = useState(false);
    
    // PREVIEW MODAL STATE
    const [previewImage, setPreviewImage] = useState<string | null>(null);
    
    // Feature Toggles (Global)
    const [enableLogoRemoval, setEnableLogoRemoval] = useState(false);
    const [enableAutoCrop, setEnableAutoCrop] = useState(true); // Default ON
    const [gapSize, setGapSize] = useState(0); // Default 0 for no white borders
    // UPDATED: Default to 'center' as requested
    const [textPosition, setTextPosition] = useState<'bottom-left' | 'center'>('center');
    // Global Text acts as the "Input Name" suffix (e.g., "Set1")
    const [globalText, setGlobalText] = useState('Set 1');
    
    // Config - INCREASED RESOLUTION FOR ULTRA HIGH QUALITY 4K (9:16)
    // 2160 x 3840 is standard Vertical 4K
    const CANVAS_WIDTH = 2160; 
    const CANVAS_HEIGHT = 3840; 

    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    // --- HELPER: Wait ---
    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    // --- HELPER: File to Base64 ---
    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => {
                const base64 = reader.result as string;
                resolve(base64.split(',')[1]);
            };
            reader.onerror = error => reject(error);
        });
    };

    // --- HELPER: Clean Filename to get Product Code ---
    // Update: Split by underscore to shorten name (e.g. AK0535_020_02 -> AK0535)
    const extractProductCode = (filename: string): string => {
        let clean = filename.substring(0, filename.lastIndexOf('.')) || filename;
        // Remove common copy patterns
        clean = clean.replace(/\s*\(\d+\)$/, '').replace(/\s-\s*Copy$/, '');
        
        // Split by "_" and take the first part to shorten
        if (clean.includes('_')) {
            clean = clean.split('_')[0];
        }
        
        return clean.trim();
    };

    // --- 1. HANDLE UPLOAD (SINGLE) ---
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const newFiles = Array.from(e.target.files).map((file: any) => ({
                id: Math.random().toString(36),
                file: file as File,
                previewUrl: URL.createObjectURL(file as File),
                isSelected: false, 
                customText: ''
            }));
            setImages(prev => [...prev, ...newFiles]);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // --- 2. HANDLE UPLOAD (BATCH FOLDER) ---
    const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const files = Array.from(e.target.files) as File[];
            const folderMap = new Map<string, File[]>();

            // Group by Parent Folder Name
            files.forEach(file => {
                // webkitRelativePath example: "ParentFolder/SubFolder/Image.jpg"
                const relativePath = (file as any).webkitRelativePath || '';
                const pathParts = relativePath.split('/');
                
                // We assume user uploads a Master Folder containing Product Subfolders
                let folderName = "Root";
                if (pathParts.length >= 2) {
                    folderName = pathParts[pathParts.length - 2];
                }
                
                // Filter images only
                if (!file.type.startsWith('image/')) return;

                if (!folderMap.has(folderName)) {
                    folderMap.set(folderName, []);
                }
                folderMap.get(folderName)?.push(file);
            });

            const newQueue: BatchFolderItem[] = Array.from(folderMap.entries()).map(([name, files]) => ({
                id: Math.random().toString(36),
                folderName: name,
                customName: name, // Init custom name same as folder name
                originalImages: files,
                processedImages: [],
                status: 'pending',
                resultImage: null
            }));

            setBatchQueue(newQueue);
        }
        if (folderInputRef.current) folderInputRef.current.value = '';
    };

    // --- AI ANALYSIS LOGIC (Robust Retry) ---
    const analyzeSingleImage = async (file: File, retryCount = 0): Promise<{ hasPerson: boolean, personCount: number, isCollage: boolean, logoInfo: LogoBox, error: boolean }> => {
        const apiKey = getApiKey();
        if (!apiKey) return { hasPerson: true, personCount: 1, isCollage: false, logoInfo: { hasLogo: false, xmin: 0, ymin: 0, xmax: 0, ymax: 0 }, error: false }; // Fallback

        try {
            const base64Data = await fileToBase64(file);
            const prompt = `
                Analyze image for fashion e-commerce.
                1. isModel: Is there at least one human model? (boolean)
                2. personCount: EXACT number of distinct human bodies/faces visible. 
                   - CRITICAL: If there are TWO separate people (e.g. a couple, or two models standing next to each other), return 2.
                   - If it is a couple, return 2.
                   - If it's a mirror selfie of 1 person, return 1.
                   - If it's one person in multiple poses (collage), return the count of figures (e.g. 2 figures).
                3. isCollage: Is this image a collage/grid? (boolean)
                4. logo: visible text watermark/logo location.
            `;
            // USE GEMINI 2.0 FLASH (Stable, High Quota)
            const response = await ai.models.generateContent({
                model: 'gemini-2.0-flash', 
                contents: {
                    parts: [
                        { inlineData: { mimeType: file.type, data: base64Data } },
                        { text: prompt }
                    ]
                },
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            isModel: { type: Type.BOOLEAN },
                            personCount: { type: Type.INTEGER },
                            isCollage: { type: Type.BOOLEAN },
                            logo: {
                                type: Type.OBJECT,
                                properties: {
                                    hasLogo: { type: Type.BOOLEAN },
                                    ymin: { type: Type.INTEGER },
                                    xmin: { type: Type.INTEGER },
                                    ymax: { type: Type.INTEGER },
                                    xmax: { type: Type.INTEGER }
                                }
                            }
                        }
                    }
                }
            });
            const result = JSON.parse(response.text || '{}');
            return {
                hasPerson: result.isModel === true,
                personCount: result.personCount !== undefined ? result.personCount : (result.isModel ? 1 : 0),
                isCollage: result.isCollage === true,
                logoInfo: (result.logo as LogoBox) || { hasLogo: false, xmin:0, ymin:0, xmax:0, ymax:0 },
                error: false
            };

        } catch (e: any) {
            console.warn(`AI Error (Attempt ${retryCount + 1}):`, e.message);
            
            // ROBUST RETRY LOGIC
            // If retryCount < 5, wait and retry.
            // Backoff: 15s -> 30s -> 45s -> 60s -> 75s
            if (retryCount < 5) {
                const waitTime = 15000 * (retryCount + 1);
                console.log(`Waiting ${waitTime/1000}s for quota recovery...`);
                await wait(waitTime);
                return analyzeSingleImage(file, retryCount + 1);
            }

            // FAIL-SAFE MODE (STRICT):
            // If AI fails after all retries, return "No Person" to prevent invalid images from polluting strict sets.
            // Better to skip a folder than to generate a bad collage.
            return { hasPerson: false, personCount: 0, isCollage: false, logoInfo: { hasLogo: false, xmin: 0, ymin: 0, xmax: 0, ymax: 0 }, error: true };
        }
    };

    // --- BATCH PROCESSING LOGIC ---
    const runBatchProcessing = async () => {
        if (batchQueue.length === 0) return;
        setIsBatchProcessing(true);

        const queueCopy = [...batchQueue];
        
        // Counter logic: Start from user input
        let currentSetCounter = startSetNum;
        // Calculate max range to ensure logic validity
        const validEndNum = Math.max(startSetNum, endSetNum);

        for (let i = 0; i < queueCopy.length; i++) {
            const item = queueCopy[i];
            
            // Skip if already done
            if (item.status === 'done' || item.status === 'failed') continue;

            // Update Status: Analyzing
            const statusMsg = useBatchAI ? 'Đang lọc AI (Mode Ổn định)...' : 'Đang xử lý (Không AI)...';
            setBatchQueue(prev => prev.map(p => p.id === item.id ? { ...p, status: 'analyzing', statusMessage: statusMsg } : p));
            
            try {
                // 1. ANALYZE ALL IMAGES IN FOLDER
                const singleModelCandidates: LocalImage[] = []; // For 1 person logic (Strict)
                const dualModelCandidates: LocalImage[] = [];   // For 2 people fallback
                
                // Limit scan to 20 images to save time, usually enough to find 4 valid ones
                const imagesToScan = item.originalImages.slice(0, 20); 

                for (const file of imagesToScan) {
                    let analysis = { hasPerson: false, personCount: 0, isCollage: false, logoInfo: { hasLogo: false, xmin: 0, ymin: 0, xmax: 0, ymax: 0 } as LogoBox, error: false };

                    // ONLY RUN AI IF TOGGLE IS ON
                    if (useBatchAI) {
                         setBatchQueue(prev => prev.map(p => p.id === item.id ? { ...p, statusMessage: `AI đang đọc: ${file.name}...` } : p));
                         
                         analysis = await analyzeSingleImage(file);
                         
                         // SAFETY DELAY: 2 Seconds (2.0 Flash)
                         await wait(2000);
                    } else {
                         // Non-AI mode: Assume everything is a valid single person image
                         analysis = { hasPerson: true, personCount: 1, isCollage: false, logoInfo: { hasLogo: false, xmin: 0, ymin: 0, xmax: 0, ymax: 0 }, error: false };
                         await wait(100);
                    }

                    if (!analysis.error) {
                        // Create LocalImage object
                        const imgObj: LocalImage = {
                            id: Math.random().toString(36),
                            file: file,
                            previewUrl: URL.createObjectURL(file),
                            hasPerson: analysis.hasPerson,
                            logoInfo: analysis.logoInfo,
                            isSelected: true,
                            customText: '' 
                        };

                        if (!analysis.isCollage) {
                            // SHOW DEBUG INFO IN STATUS (IMPORTANT)
                            if (useBatchAI) {
                                 setBatchQueue(prev => prev.map(p => p.id === item.id ? { 
                                     ...p, statusMessage: `AI: Người: ${analysis.personCount} (${file.name.slice(0,10)}...)` 
                                 } : p));
                                 // Allow user to read debug text
                                 await wait(500);
                            }

                            // GROUP 1: Single Model (Priority 1 & 2)
                            // STRICT: Must be EXACTLY 1 person.
                            if (analysis.hasPerson && analysis.personCount === 1) {
                                singleModelCandidates.push(imgObj);
                            }
                            // GROUP 2: Dual Model (Priority 3 Fallback)
                            else if (analysis.hasPerson && analysis.personCount === 2) {
                                dualModelCandidates.push(imgObj);
                            }
                        }
                    } else {
                         console.warn(`Skipped ${file.name}: AI Analysis Error`);
                    }
                }

                // 2. DETERMINE LAYOUT BASED ON PRIORITY RULES
                // Rule 1 (Highest): >= 4 Single Model Images -> 2x2
                // Rule 2 (Middle): >= 2 Single Model Images -> 2x1
                // Rule 3 (Lowest): >= 1 Dual Model Image -> 1x1 (Select that photo)
                //     -> CONDITION: Only if mode is 'smart' (allows fallback). If 'strict', skip this.
                
                let targetImages: LocalImage[] = [];
                let layout: LayoutType = '2x1';
                let shouldProcess = false;

                if (singleModelCandidates.length >= 4) {
                    // Priority 1
                    layout = '2x2';
                    targetImages = singleModelCandidates.slice(0, 4);
                    shouldProcess = true;
                } else if (singleModelCandidates.length >= 2) {
                    // Priority 2
                    layout = '2x1';
                    targetImages = singleModelCandidates.slice(0, 2);
                    shouldProcess = true;
                } else if (modelFilterMode === 'smart' && dualModelCandidates.length >= 1) {
                    // Priority 3: Fallback to the image with 2 people (ONLY IF SMART MODE)
                    layout = '1x1'; // We handle this as a full frame single image
                    targetImages = dualModelCandidates.slice(0, 1); // Take the first one
                    shouldProcess = true;
                } else {
                    // Fail (Not enough single images, and either no dual images or strictly forbidden)
                    shouldProcess = false;
                }

                if (!shouldProcess) {
                     setBatchQueue(prev => prev.map(p => p.id === item.id ? { 
                         ...p, status: 'skipped', 
                         statusMessage: `Không đủ ảnh (Đơn: ${singleModelCandidates.length}, Đôi: ${dualModelCandidates.length}).` 
                     } : p));
                     continue; // Skip to next folder
                }

                // 3. GENERATE SET NAME
                const firstImage = targetImages[0];
                const productCode = firstImage ? extractProductCode(firstImage.file.name) : item.folderName;
                
                // USE PREFIX CONFIG: e.g. "Set" + " " + "1" -> "Set 1"
                const setLabel = `${batchPrefix} ${currentSetCounter}`;
                
                // Filename: ProductCode_SetN.png
                const finalFilenamePrefix = `${productCode}_${setLabel.replace(/\s+/g, '')}`;

                // Update Status: Generating
                setBatchQueue(prev => prev.map(p => p.id === item.id ? { 
                    ...p, status: 'generating', 
                    statusMessage: `Đang ghép ${layout} (${setLabel})...`,
                    customName: setLabel // Set initial Custom Name for editing later
                } : p));

                // 4. GENERATE COLLAGE
                const resultDataUrl = await generateCollage(targetImages, layout, {
                    width: CANVAS_WIDTH,
                    height: CANVAS_HEIGHT,
                    gap: gapSize, // USE DYNAMIC GAP
                    backgroundColor: '#ffffff',
                    removeLogo: enableLogoRemoval,
                    autoCrop: enableAutoCrop,
                    textPosition: textPosition, // Use state
                    globalText: setLabel // Use custom prefix
                });

                // 5. DONE & INCREMENT COUNTER
                setBatchQueue(prev => prev.map(p => p.id === item.id ? { 
                    ...p, 
                    status: 'done', 
                    resultImage: resultDataUrl,
                    statusMessage: `Hoàn tất (${setLabel})`,
                    selectedLayout: layout,
                    processedImages: targetImages,
                    // Store naming info for download
                    customMeta: { filename: finalFilenamePrefix }
                } as any : p));

                // CYCLE LOGIC: Reset to start if we exceed end
                currentSetCounter++;
                if (currentSetCounter > validEndNum) {
                    currentSetCounter = startSetNum; // Reset cycle
                }

            } catch (error: any) {
                console.error(error);
                setBatchQueue(prev => prev.map(p => p.id === item.id ? { ...p, status: 'failed', statusMessage: error.message } : p));
            }
        }

        setIsBatchProcessing(false);
    };

    // --- NEW LOGIC: GENERATE AI HOOK (LIST) ---
    const generateAIHook = async () => {
        if (!batchProductType && !batchOccasion) {
            alert("Vui lòng nhập Loại sản phẩm hoặc Dịp lễ để AI tạo câu dẫn.");
            return;
        }

        setIsGeneratingHook(true);
        try {
            const prompt = `
                Viết 30 câu caption mở đầu (Hook) khác nhau cho sản phẩm thời trang.
                Dịp (Context): "${batchOccasion}"
                Loại sản phẩm (Product Type): "${batchProductType}"
                Yêu cầu: 
                - Ngôn ngữ: Tiếng Việt.
                - Độ dài: từ 8 đến 14 từ mỗi câu.
                - Phong cách: Dễ thương, ngọt ngào, tạo sự tò mò.
                - QUAN TRỌNG: TUYỆT ĐỐI KHÔNG dùng từ "bạn", "chị em" hay "mọi người". HÃY DÙNG TỪ "NÀNG".
                - BẮT BUỘC phải chứa từ khóa về Dịp hoặc Loại sản phẩm.
                - Đa dạng hóa câu trúc câu, tránh lặp lại nhàm chán.
                - Output Format: Trả về một JSON Array chứa các chuỗi string.
                Ví dụ: ["Tết này nàng diện set này đảm bảo xinh hết nấc", "Set đồ ngọt ngào cho nàng xuống phố ngày hè"]
            `;
            
            // IMPLEMENT RETRY LOGIC FOR HOOK GENERATION
            const callHookWithRetry = async (retryCount = 0): Promise<any> => {
                try {
                    return await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: prompt,
                        config: {
                            responseMimeType: 'application/json'
                        }
                    });
                } catch (error: any) {
                    // Check for Rate Limit or Quota issues (429)
                    const isQuotaIssue = error.message?.includes('429') || error.status === 429 || error.message?.includes('quota');
                    
                    if (isQuotaIssue && retryCount < 4) {
                        const delay = 10000 * (retryCount + 1); // 10s, 20s, 30s...
                        console.warn(`AI Quota Hit. Retrying hook gen in ${delay/1000}s...`);
                        await wait(delay);
                        return callHookWithRetry(retryCount + 1);
                    }
                    throw error;
                }
            };

            const response = await callHookWithRetry();
            
            const text = response.text?.trim() || '[]';
            const hooks = JSON.parse(text);
            
            if (Array.isArray(hooks) && hooks.length > 0) {
                setGeneratedHooks(hooks);
            } else {
                throw new Error("AI trả về dữ liệu không đúng định dạng.");
            }

        } catch (error: any) {
            console.error("AI Hook Error", error);
            // Friendly error message if quota exhausted after retries
            if (error.message?.includes('429') || error.message?.includes('quota')) {
                alert("Hệ thống AI đang quá tải (Quota Limit). Vui lòng thử lại sau 1-2 phút.");
            } else {
                alert("Lỗi tạo Hook: " + error.message);
            }
        } finally {
            setIsGeneratingHook(false);
        }
    };

    // --- NEW LOGIC: UPDATE BATCH LIST STATUS ---
    // Note: This now just prepares state, the real Consolidated Caption is generated at Download
    const generateBatchCaptions = () => {
        setBatchQueue(prev => prev.map(item => {
            if (item.status !== 'done') return item;
            return {
                ...item,
                statusMessage: item.statusMessage ? item.statusMessage.replace(" (+TXT)", "") + " (+TXT)" : "Done (+TXT)"
            };
        }));
    };
    
    // --- FEATURE: MANUAL RENAME & RE-GENERATE SINGLE ROW ---
    const handleUpdateName = (id: string, newName: string) => {
        setBatchQueue(prev => prev.map(item => item.id === id ? { ...item, customName: newName } : item));
    };

    const handleRegenerateRow = async (item: BatchFolderItem) => {
        if (!item.processedImages || item.processedImages.length < 2) {
             alert("Không đủ ảnh hợp lệ để ghép lại. (Cần >= 2)");
             return;
        }

        // Set status to generating
        setBatchQueue(prev => prev.map(p => p.id === item.id ? { 
            ...p, status: 'generating', statusMessage: `Đang ghép lại: ${item.customName}...` 
        } : p));

        try {
            // Use the updated Custom Name as Global Text
            const newLabel = item.customName || "Set";
            
            // Re-Generate Collage
            const resultDataUrl = await generateCollage(item.processedImages, item.selectedLayout || '2x1', {
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                gap: gapSize,
                backgroundColor: '#ffffff',
                removeLogo: enableLogoRemoval,
                autoCrop: enableAutoCrop,
                textPosition: textPosition, 
                globalText: newLabel // KEY: Use new label
            });

            // Re-Generate Caption with New Name (Update metadata only - real text generated at download)
            const firstImage = item.processedImages[0];
            const productCode = firstImage ? extractProductCode(firstImage.file.name) : item.folderName;
            
            // Update Filename
            const finalFilenamePrefix = `${productCode}_${newLabel.replace(/\s+/g, '')}`;

            // Update State
            setBatchQueue(prev => prev.map(p => p.id === item.id ? { 
                ...p, 
                status: 'done', 
                resultImage: resultDataUrl,
                statusMessage: `Đã cập nhật: ${newLabel}`,
                customMeta: { filename: finalFilenamePrefix }
            } as any : p));

        } catch (error: any) {
            console.error(error);
            setBatchQueue(prev => prev.map(p => p.id === item.id ? { 
                ...p, status: 'failed', statusMessage: `Lỗi ghép lại: ${error.message}` 
            } : p));
        }
    };
    
    // ... (rest of the file remains unchanged)
    const handleBatchDownload = async () => {
        const doneItems = batchQueue.filter(i => i.status === 'done' && i.resultImage);
        if (doneItems.length === 0) return;

        setIsDownloadingBatch(true);
        const zip = new JSZip();
        
        try {
            // Root folder for everything
            const rootFolderName = `Batch_Export_${new Date().toISOString().slice(0,10)}`;
            const rootFolder = zip.folder(rootFolderName);
            if (!rootFolder) throw new Error("Could not create root folder");

            // --- 0. GENERATE SUMMARY FILE (SUCCESS REPORT) ---
            // Format: FolderName | Status | Layout | Filename
            const summaryContent = doneItems.map(item => {
                const fName = (item.customMeta as any)?.filename || 'unknown';
                return `[SUCCESS] Folder: ${item.folderName} | Set: ${item.customName} | Layout: ${item.selectedLayout} | Output: ${fName}.png`;
            }).join('\n');
            rootFolder.file("danh_sach_ghep_thanh_cong.txt", summaryContent);

            // 1. CHUNKING LOGIC: Group strictly by the specified range (End - Start + 1)
            const groups: BatchFolderItem[][] = [];
            // Calculate how many items form a full set sequence
            // E.g. Start 1, End 2 -> Size = 2.
            // E.g. Start 1, End 4 -> Size = 4.
            const validEndNum = Math.max(startSetNum, endSetNum);
            const chunkSize = validEndNum - startSetNum + 1;

            for (let i = 0; i < doneItems.length; i += chunkSize) {
                groups.push(doneItems.slice(i, i + chunkSize));
            }

            // 2. Add to Zip
            for (let gIndex = 0; gIndex < groups.length; gIndex++) {
                const group = groups[gIndex];
                if (group.length === 0) continue;

                // Naming the Group Folder (e.g. Group_1_Sets_1_to_2)
                const folderNameStart = group[0].customName || `${batchPrefix} ${startSetNum}`;
                const folderNameEnd = group[group.length - 1].customName || `${batchPrefix} ${validEndNum}`;
                
                // Simplified clean naming
                const cleanStart = folderNameStart.replace(/[^a-zA-Z0-9]/g, '');
                const cleanEnd = folderNameEnd.replace(/[^a-zA-Z0-9]/g, '');

                const groupFolderName = `Group_${gIndex + 1}_Sets_${cleanStart}_to_${cleanEnd}`;
                const groupFolder = rootFolder.folder(groupFolderName);
                if (!groupFolder) continue;

                // --- NEW: Generate SINGLE Consolidated Caption for this Group ---
                
                // Collect Codes in requested format: CODE_Set1 (no dashes, no spaces)
                const codesList = group.map(item => {
                     const firstImage = item.processedImages[0];
                     const productCode = firstImage ? extractProductCode(firstImage.file.name) : item.folderName;
                     
                     // Format: Set 1 -> Set1
                     const setPart = (item.customName || "").replace(/\s+/g, '');
                     
                     return `${productCode}_${setPart}`;
                }).join('\n');
                
                // Construct Hook: Cycle through Generated Hooks based on Group Index
                let hookText = `${batchProductType ? batchProductType : 'Set đồ'} ${batchOccasion ? batchOccasion : 'mới về'} cực xinh nè!`;
                
                if (generatedHooks.length > 0) {
                    // Use modulo to cycle through hooks if there are more groups than hooks
                    hookText = generatedHooks[gIndex % generatedHooks.length];
                }

                // Construct Consolidated Content
                // Title -> Hook -> Separator -> List -> Hashtags
                const fullCaption = `${batchTitle ? batchTitle + "\n\n" : ""}${hookText}\n\n------------------\nDanh sách Mã SP:\n${codesList}\n\n${batchHashtags}`;
                
                groupFolder.file("caption.txt", fullCaption);

                // --- Save Files (Flattened) ---
                for (let i = 0; i < group.length; i++) {
                    const item = group[i];
                    
                    if (item.resultImage) {
                        const base64 = item.resultImage.split(',')[1];
                        // @ts-ignore
                        const name = item.customMeta?.filename || `${item.folderName}_processed`;
                        const safeName = name.replace(/[/\\?%*:|"<>]/g, '-').trim();
                        
                        // 1. Collage (Saved directly to Group Folder)
                        groupFolder.file(`${safeName}.png`, base64, { base64: true });
                        
                        // 2. Caption (SKIPPED - Used Consolidated Caption instead)

                        // 3. Best Cover (Saved directly to Group Folder)
                        if (item.processedImages && item.processedImages.length > 0) {
                            const bestCandidate = item.processedImages[0];
                            // UPDATED: Use NEW 9:16 Cover Processor
                            // This guarantees 1080x1920 with no borders.
                            const coverBase64 = await processCoverImage916(bestCandidate.file);
                            if (coverBase64) {
                                const cleanBase64 = coverBase64.split(',')[1];
                                groupFolder.file(`${safeName}_cover.png`, cleanBase64, { base64: true });
                            }
                        }
                    }
                    await wait(50);
                }
            }

            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const link = document.createElement('a');
            link.href = url;
            link.download = `Batch_Sets_${Date.now()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
        } catch (error) {
            console.error("Zip Error", error);
            alert("Lỗi khi nén file ZIP.");
        } finally {
            setIsDownloadingBatch(false);
        }
    };

    // --- NEW: Download Single Item from Batch List ---
    const handleDownloadSingleRow = (item: BatchFolderItem) => {
        if (!item.resultImage) return;
        const link = document.createElement('a');
        link.href = item.resultImage;
        // @ts-ignore
        const name = item.customMeta?.filename || `${item.folderName}_processed`;
        const safeName = name.replace(/[/\\?%*:|"<>]/g, '-').trim();
        link.download = `${safeName}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // --- ORIGINAL SINGLE MODE LOGIC (Kept for compatibility) ---
    const runAIFilterSingle = async () => {
        setIsAnalyzing(true);
        const uncheckedImages = images.filter(img => img.hasPerson === undefined);
        
        for (const img of uncheckedImages) {
             const result = await analyzeSingleImage(img.file);
             setImages(prev => prev.map(p => p.id === img.id ? { 
                 ...p, 
                 hasPerson: result.hasPerson, 
                 logoInfo: result.logoInfo,
                 isSelected: p.isSelected || result.hasPerson // Auto select person
             } : p));
             await wait(6000); // Also throttle single mode
        }
        setIsAnalyzing(false);
    };

    const generateCollageClickSingle = async () => {
        const selected = images.filter(i => i.isSelected);
        let requiredCount = 2;
        if (selectedLayout === '2x2' || selectedLayout === '4x1') requiredCount = 4;

        if (selected.length < requiredCount) {
             alert(`Layout ${selectedLayout} cần tối thiểu ${requiredCount} ảnh.`);
             return;
        }

        setIsGenerating(true);
        const targetImages = selected.slice(0, requiredCount);

        try {
            const dataUrl = await generateCollage(targetImages, selectedLayout, {
                width: CANVAS_WIDTH,
                height: CANVAS_HEIGHT,
                gap: gapSize, // USE DYNAMIC GAP
                backgroundColor: '#ffffff',
                removeLogo: enableLogoRemoval,
                autoCrop: enableAutoCrop,
                textPosition: textPosition,
                globalText: globalText
            });
            setCollageResult(dataUrl);
        } catch (e) {
            console.error(e);
            alert("Lỗi tạo ảnh ghép");
        } finally {
            setIsGenerating(false);
        }
    };
    
    // ... (Helpers for Single Mode)
    const toggleSelect = (id: string) => setImages(prev => prev.map(img => img.id === id ? { ...img, isSelected: !img.isSelected } : img));
    const updateCustomText = (id: string, text: string) => setImages(prev => prev.map(img => img.id === id ? { ...img, customText: text } : img));
    
    // Updated Single Mode Filename Logic
    const getGeneratedFilenameSingle = () => {
        if(images.length === 0) return 'collage.png';
        
        // 1. Get Product Code from the FIRST SELECTED image's original filename
        const selectedFirst = images.find(i => i.isSelected) || images[0];
        const productCode = extractProductCode(selectedFirst.file.name);
        
        // 2. Get Input Text (Global Text)
        const suffix = globalText || "Set";

        // 3. Combine: Code_Suffix.png
        const safeName = `${productCode}_${suffix}`.replace(/[/\\?%*:|"<>]/g, '-').trim();
        return `${safeName}.png`;
    };

    // UI Helpers
    const getBatchStatusIcon = (status: string) => {
        switch(status) {
            case 'pending': return <div className="w-2 h-2 rounded-full bg-gray-500"/>;
            case 'analyzing': return <Sparkles size={14} className="text-purple-400 animate-pulse"/>;
            case 'generating': return <Loader2 size={14} className="text-blue-400 animate-spin"/>;
            case 'done': return <CheckCircle size={14} className="text-green-400"/>;
            case 'failed': return <XCircle size={14} className="text-red-400"/>;
            case 'skipped': return <div className="w-2 h-2 rounded-full bg-yellow-500"/>;
            default: return null;
        }
    };


    return (
        <div className="animate-in fade-in duration-500 space-y-6">
            
            {/* MODE SWITCHER */}
            <div className="flex bg-gray-900 rounded-lg p-1 border border-gray-700 w-fit mx-auto mb-6">
                <button 
                    onClick={() => setMode('single')}
                    className={`px-6 py-2 text-sm font-bold rounded-md transition-all flex items-center gap-2 ${mode === 'single' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                    <ImageIcon size={16} /> Ghép Thủ Công (Single)
                </button>
                <button 
                    onClick={() => setMode('batch')}
                    className={`px-6 py-2 text-sm font-bold rounded-md transition-all flex items-center gap-2 ${mode === 'batch' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                    <FolderInput size={16} /> Ghép Hàng Loạt (Batch Folder)
                </button>
            </div>

            {/* === SINGLE MODE === */}
            {mode === 'single' && (
                <div className="bg-tiktok-surface p-6 rounded-xl border border-gray-700 shadow-xl">
                     <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-purple-400">
                        <LayoutIcon /> AI Smart Collage (Thủ Công)
                    </h2>

                    {/* UPLOAD SINGLE */}
                    <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center bg-tiktok-dark/50 hover:bg-tiktok-dark hover:border-purple-500 transition-all cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}>
                        <input type="file" multiple accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
                        <Upload className="mx-auto text-gray-500 mb-2" size={32} />
                        <p className="text-gray-300 font-bold">Upload Ảnh Lẻ / Nhiều Ảnh</p>
                    </div>

                    {/* TOOLBAR */}
                    {images.length > 0 && (
                        <div className="flex flex-wrap items-center justify-between gap-4 mt-6 bg-gray-900 p-4 rounded-lg border border-gray-800">
                            <span className="text-sm text-gray-400">Đã chọn: <b className="text-purple-400">{images.filter(i => i.isSelected).length}</b></span>
                            <div className="flex gap-2">
                                <button onClick={runAIFilterSingle} disabled={isAnalyzing} className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-all ${isAnalyzing ? 'bg-gray-700 text-gray-400' : 'bg-purple-600 text-white'}`}>
                                    {isAnalyzing ? <Sparkles className="animate-spin"/> : <Sparkles />} Lọc Người Mẫu
                                </button>
                                <button onClick={() => setImages([])} className="px-3 py-2 bg-red-900/30 text-red-400 rounded-lg text-sm"><Trash2 size={16}/></button>
                            </div>
                        </div>
                    )}

                    {/* GALLERY */}
                    {images.length > 0 && (
                        <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                             {images.map((img) => (
                                <div key={img.id} className={`relative group rounded-lg overflow-hidden border-2 ${img.isSelected ? 'border-purple-500' : 'border-gray-800'}`}>
                                    <div className="relative aspect-[3/4] cursor-pointer" onClick={() => toggleSelect(img.id)}>
                                        <img src={img.previewUrl} className="w-full h-full object-cover" alt="" />
                                        {img.hasPerson && <div className="absolute top-1 left-1 bg-green-500 text-white text-[9px] px-1 rounded">MODEL</div>}
                                        {img.isSelected && <div className="absolute top-1 right-1 bg-purple-500 rounded-full p-1"><CheckCircle size={12} className="text-white"/></div>}
                                    </div>
                                    {textPosition !== 'center' && (
                                        <input type="text" className="w-full bg-gray-900 text-xs text-white p-1 outline-none border-t border-gray-800" 
                                            placeholder="Tên..." value={img.customText || ''} onChange={e => updateCustomText(img.id, e.target.value)}/>
                                    )}
                                </div>
                             ))}
                        </div>
                    )}

                    {/* CONFIG & GENERATE */}
                    {images.filter(i => i.isSelected).length >= 2 && (
                         <div className="mt-8 border-t border-gray-700 pt-6">
                            <div className="flex flex-col md:flex-row gap-4 mb-4 items-center">
                                {/* TEXT INPUT */}
                                <div className="flex items-center gap-2 bg-gray-800 p-2 rounded w-full md:w-auto">
                                    <TypeIcon size={16} className="text-gray-400"/>
                                    <input 
                                        type="text" 
                                        value={globalText} 
                                        onChange={e => setGlobalText(e.target.value)} 
                                        className="bg-transparent text-white text-sm outline-none w-32 border-b border-gray-600 focus:border-purple-500" 
                                        placeholder="Nhập tên Set..."
                                    />
                                </div>
                                
                                {/* CONTROLS */}
                                <div className="flex items-center gap-2 flex-wrap">
                                    <div className="flex bg-gray-800 p-1 rounded">
                                        <button onClick={() => setTextPosition('bottom-left')} className={`px-3 py-1 text-xs rounded ${textPosition === 'bottom-left' ? 'bg-white text-black' : 'text-gray-400'}`}>Text Góc</button>
                                        <button onClick={() => setTextPosition('center')} className={`px-3 py-1 text-xs rounded ${textPosition === 'center' ? 'bg-white text-black' : 'text-gray-400'}`}>Text Giữa</button>
                                    </div>

                                    {/* GAP CONTROL */}
                                    <div className="flex items-center gap-2 bg-gray-800 px-3 py-1 rounded">
                                        <MoveHorizontal size={14} className="text-gray-400"/>
                                        <span className="text-xs text-gray-400 whitespace-nowrap">Viền: {gapSize}px</span>
                                        <input 
                                            type="range" min="0" max="100" step="10" 
                                            value={gapSize} onChange={e => setGapSize(Number(e.target.value))}
                                            className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>

                                    {/* AUTO CROP TOGGLE */}
                                    <button 
                                        onClick={() => setEnableAutoCrop(!enableAutoCrop)}
                                        className={`px-3 py-1.5 text-xs rounded border flex items-center gap-2 font-bold transition-all ${
                                            enableAutoCrop 
                                            ? 'bg-blue-900/50 border-blue-500 text-blue-300' 
                                            : 'bg-gray-800 border-gray-600 text-gray-400'
                                        }`}
                                    >
                                        <Scissors size={14}/> {enableAutoCrop ? 'Crop: BẬT' : 'Crop: TẮT'}
                                    </button>
                                </div>
                            </div>
                            
                            <div className="flex gap-4">
                                <button onClick={() => setSelectedLayout('2x1')} className={`p-3 border rounded ${selectedLayout === '2x1' ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700'}`}><Columns/> <span className="text-xs block">2 Cột</span></button>
                                <button onClick={() => setSelectedLayout('1x2')} className={`p-3 border rounded ${selectedLayout === '1x2' ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700'}`}><Rows/> <span className="text-xs block">2 Ngang</span></button>
                                <button onClick={() => setSelectedLayout('2x2')} className={`p-3 border rounded ${selectedLayout === '2x2' ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700'}`}><Grid/> <span className="text-xs block">2x2</span></button>
                                
                                <button onClick={generateCollageClickSingle} disabled={isGenerating} className="ml-auto px-6 py-3 bg-white text-black font-bold rounded hover:bg-gray-200 disabled:opacity-50 shadow-[0_0_20px_rgba(255,255,255,0.3)]">
                                    {isGenerating ? 'Đang render HQ...' : 'Tạo Ảnh (Chất Lượng Gốc)'}
                                </button>
                            </div>
                         </div>
                    )}

                    {/* RESULT SINGLE */}
                    {collageResult && (
                         <div className="mt-6 p-4 bg-black/50 rounded flex gap-4 animate-in zoom-in">
                             <img 
                                src={collageResult} 
                                className="h-64 rounded shadow-lg cursor-zoom-in hover:opacity-90 transition-opacity" 
                                alt="" 
                                onClick={() => setPreviewImage(collageResult)}
                            />
                             <div className="flex flex-col justify-center gap-2">
                                 <div className="text-xs text-green-400 font-mono mb-2">Res: {CANVAS_WIDTH}x{CANVAS_HEIGHT} (HQ)</div>
                                 <div className="text-xs text-gray-400">File: {getGeneratedFilenameSingle()}</div>
                                 <a href={collageResult} download={getGeneratedFilenameSingle()} className="px-4 py-2 bg-green-600 text-white rounded font-bold flex items-center gap-2"><Download size={16}/> Tải Về (PNG)</a>
                                 <button onClick={() => setCollageResult(null)} className="text-gray-400 underline text-sm">Đóng</button>
                             </div>
                         </div>
                    )}
                </div>
            )}

            {/* === BATCH MODE === */}
            {mode === 'batch' && (
                <div className="bg-tiktok-surface p-6 rounded-xl border border-gray-700 shadow-xl">
                    <h2 className="text-xl font-bold mb-6 flex items-center gap-2 text-blue-400">
                        <FolderInput /> Batch Processor (Tự động theo Folder)
                    </h2>

                    {/* UPLOAD FOLDER */}
                    <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center bg-tiktok-dark/50 hover:bg-tiktok-dark hover:border-blue-500 transition-all cursor-pointer relative"
                         onClick={() => folderInputRef.current?.click()}>
                        {/* @ts-ignore - webkitdirectory is non-standard but required */}
                        <input type="file" multiple webkitdirectory="" directory="" className="hidden" ref={folderInputRef} onChange={handleFolderChange} />
                        <Archive className="mx-auto text-blue-500 mb-2" size={40} />
                        <p className="text-gray-300 font-bold">Chọn Thư Mục Gốc (Chứa các thư mục sản phẩm con)</p>
                        <p className="text-xs text-gray-500 mt-1">Hệ thống sẽ tự gom nhóm theo folder con và xử lý hàng loạt.</p>
                    </div>

                    {/* BATCH CONFIG & QUEUE */}
                    {batchQueue.length > 0 && (
                        <div className="mt-8">
                             {/* BATCH SETTINGS */}
                             <div className="bg-gray-800/50 p-4 rounded-lg mb-4 flex flex-col gap-6 border border-gray-700">
                                
                                {/* ROW 1: PROCESSING CONFIG */}
                                <div className="flex flex-col md:flex-row gap-4 items-center flex-wrap">
                                    <div className="flex items-center gap-2 text-blue-300 font-bold text-sm">
                                        <Settings size={16}/> Xử lý:
                                    </div>

                                    {/* SET START */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-gray-400">Set bắt đầu:</label>
                                        <input 
                                            type="number" min="1" 
                                            value={startSetNum} 
                                            onChange={e => setStartSetNum(Math.max(1, parseInt(e.target.value)))}
                                            className="w-14 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm text-center"
                                        />
                                    </div>

                                    {/* SET END (CHANGED from Cycle) */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-gray-400">Set kết thúc:</label>
                                        <input 
                                            type="number" min={startSetNum} 
                                            value={endSetNum} 
                                            onChange={e => setEndSetNum(Math.max(startSetNum, parseInt(e.target.value)))}
                                            className="w-14 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm text-center"
                                        />
                                    </div>

                                    {/* SET PREFIX */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs text-gray-400">Tên Set:</label>
                                        <input 
                                            type="text" 
                                            value={batchPrefix} 
                                            onChange={e => setBatchPrefix(e.target.value)}
                                            className="w-16 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white text-sm text-center"
                                            placeholder="Set"
                                        />
                                    </div>

                                    {/* AI FILTER TOGGLE */}
                                    <button 
                                        onClick={() => setUseBatchAI(!useBatchAI)}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                            useBatchAI 
                                            ? 'bg-purple-900/50 border-purple-500 text-purple-200' 
                                            : 'bg-gray-800 border-gray-600 text-gray-400'
                                        }`}
                                    >
                                        {useBatchAI ? <Zap size={14} className="fill-current"/> : <ZapOff size={14}/>}
                                        {useBatchAI ? 'Lọc AI: ON' : 'Lọc AI: OFF'}
                                    </button>

                                    {/* FILTER MODE (CHANGED) */}
                                    {useBatchAI && (
                                        <div className="flex items-center bg-gray-900 rounded p-1 border border-gray-700">
                                            <button 
                                                onClick={() => setModelFilterMode('strict')}
                                                className={`px-3 py-1 rounded text-xs flex items-center gap-1 transition-all ${modelFilterMode === 'strict' ? 'bg-purple-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                            >
                                                <User size={12} /> Chỉ 1 Mẫu (Strict)
                                            </button>
                                            <button 
                                                onClick={() => setModelFilterMode('smart')}
                                                className={`px-3 py-1 rounded text-xs flex items-center gap-1 transition-all ${modelFilterMode === 'smart' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                                            >
                                                <Users size={12} /> Thông Minh (Có dự phòng)
                                            </button>
                                        </div>
                                    )}

                                     <button 
                                        onClick={() => setEnableAutoCrop(!enableAutoCrop)}
                                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                            enableAutoCrop 
                                            ? 'bg-blue-900/50 border-blue-500 text-blue-200' 
                                            : 'bg-gray-800 border-gray-600 text-gray-400'
                                        }`}
                                    >
                                        <Scissors size={14}/> {enableAutoCrop ? 'Cắt Viền' : 'Cắt Viền: OFF'}
                                    </button>
                                    
                                    {/* TEXT POSITION CONTROL */}
                                    <div className="flex items-center gap-2 bg-gray-900 px-3 py-1.5 rounded border border-gray-700">
                                        <span className="text-xs text-gray-400">Text:</span>
                                        <button 
                                            onClick={() => setTextPosition('bottom-left')} 
                                            className={`p-1 rounded ${textPosition === 'bottom-left' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                            title="Góc Trái"
                                        >
                                            <AlignLeft size={14}/>
                                        </button>
                                        <button 
                                            onClick={() => setTextPosition('center')} 
                                            className={`p-1 rounded ${textPosition === 'center' ? 'bg-gray-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                                            title="Chính Giữa"
                                        >
                                            <AlignCenter size={14}/>
                                        </button>
                                    </div>
                                    
                                    {/* GAP CONTROL */}
                                    <div className="flex items-center gap-2 bg-gray-900 px-3 py-1.5 rounded border border-gray-700">
                                        <span className="text-xs text-gray-400">Viền: {gapSize}px</span>
                                        <input 
                                            type="range" min="0" max="100" step="10" 
                                            value={gapSize} onChange={e => setGapSize(Number(e.target.value))}
                                            className="w-16 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                                        />
                                    </div>
                                </div>
                                
                                {/* ROW 2: CAPTION CONFIG (UPDATED) */}
                                <div className="bg-gray-900 p-3 rounded-lg border border-gray-700 flex flex-col gap-3">
                                    <div className="flex flex-col md:flex-row gap-4 items-center">
                                        <div className="flex items-center gap-2 text-green-300 font-bold text-sm shrink-0">
                                            <FileText size={16}/> Caption:
                                        </div>
                                        
                                        {/* TITLE INPUT */}
                                        <div className="flex items-center gap-2 flex-1 w-full border-r border-gray-700 pr-4">
                                            <MessageSquare size={14} className="text-gray-500"/>
                                            <input 
                                                type="text" 
                                                value={batchTitle} 
                                                onChange={e => setBatchTitle(e.target.value)}
                                                className="bg-transparent text-white text-sm outline-none w-full border-b border-gray-700 focus:border-green-500 placeholder-gray-600" 
                                                placeholder="Tiêu đề (VD: Hàng mới về...)"
                                            />
                                        </div>
                                        
                                        {/* PRODUCT TYPE INPUT (NEW) */}
                                        <div className="flex items-center gap-2 flex-1 w-full border-r border-gray-700 pr-4">
                                            <Tag size={14} className="text-gray-500"/>
                                            <input 
                                                type="text" 
                                                value={batchProductType} 
                                                onChange={e => setBatchProductType(e.target.value)}
                                                className="bg-transparent text-white text-sm outline-none w-full border-b border-gray-700 focus:border-green-500 placeholder-gray-600" 
                                                placeholder="Loại SP (VD: Set dạ, Váy...)"
                                            />
                                        </div>

                                        {/* OCCASION INPUT */}
                                        <div className="flex items-center gap-2 flex-1 w-full">
                                            <Calendar size={14} className="text-gray-500"/>
                                            <input 
                                                type="text" 
                                                value={batchOccasion} 
                                                onChange={e => setBatchOccasion(e.target.value)}
                                                className="bg-transparent text-white text-sm outline-none w-full border-b border-gray-700 focus:border-green-500 placeholder-gray-600" 
                                                placeholder="Dịp (Tết, Hè...)"
                                            />
                                        </div>
                                    </div>

                                    {/* ROW 3: HASHTAGS & ACTIONS */}
                                    <div className="flex flex-col md:flex-row gap-4 items-center">
                                        <div className="flex items-center gap-2 flex-[2] w-full">
                                            <Hash size={14} className="text-gray-500"/>
                                            <input 
                                                type="text" 
                                                value={batchHashtags} 
                                                onChange={e => setBatchHashtags(e.target.value)}
                                                className="bg-transparent text-white text-sm outline-none w-full border-b border-gray-700 focus:border-green-500 placeholder-gray-600" 
                                                placeholder="#hashtag..."
                                            />
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {/* AI HOOK BUTTON */}
                                            <button 
                                                onClick={generateAIHook}
                                                disabled={isGeneratingHook || (!batchOccasion && !batchProductType)}
                                                className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-2 transition-all border ${
                                                    isGeneratingHook
                                                    ? 'bg-purple-900/50 border-purple-600 text-purple-300 cursor-wait'
                                                    : 'bg-purple-600 hover:bg-purple-500 border-purple-400 text-white disabled:opacity-50'
                                                }`}
                                                title="Tạo câu dẫn cuốn hút bằng AI"
                                            >
                                                {isGeneratingHook ? <Loader2 size={14} className="animate-spin"/> : <Wand2 size={14}/>}
                                                {generatedHooks.length > 0 ? `Đã tạo ${generatedHooks.length} Hook` : 'AI Tạo Hook'}
                                            </button>

                                            <button 
                                                onClick={generateBatchCaptions}
                                                disabled={!batchQueue.some(i => i.status === 'done')}
                                                className="bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                Cập nhật List
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {/* PREVIEW GENERATED HOOK */}
                                    {generatedHooks.length > 0 && (
                                        <div className="text-xs text-purple-300 bg-purple-900/20 p-2 rounded border border-purple-800 italic mt-1 flex flex-col gap-1">
                                            <div className="flex gap-2 font-bold"><Sparkles size={12} className="shrink-0 mt-0.5"/> Preview Hook 1/{generatedHooks.length}:</div>
                                            <div className="opacity-80">"{generatedHooks[0]}"</div>
                                        </div>
                                    )}
                                </div>

                             </div>

                             <div className="flex items-center justify-between mb-4">
                                 <h3 className="font-bold text-white">Hàng chờ xử lý ({batchQueue.length} thư mục)</h3>
                                 <div className="flex gap-2">
                                    <button 
                                        onClick={() => setBatchQueue([])}
                                        className="px-3 py-1.5 text-red-400 bg-red-900/20 rounded hover:bg-red-900/40 text-sm"
                                    >
                                        Xóa List
                                    </button>
                                     <button 
                                        onClick={runBatchProcessing}
                                        disabled={isBatchProcessing}
                                        className={`px-4 py-2 rounded font-bold text-sm flex items-center gap-2 transition-all
                                            ${isBatchProcessing ? 'bg-gray-700 text-gray-400 cursor-wait' : 'bg-blue-600 text-white hover:bg-blue-500'}
                                        `}
                                     >
                                         {isBatchProcessing ? <Loader2 className="animate-spin"/> : <Play size={16}/>}
                                         {isBatchProcessing ? 'Đang xử lý...' : 'Bắt Đầu Ghép Tự Động'}
                                     </button>
                                     <button 
                                        onClick={handleBatchDownload}
                                        disabled={isBatchProcessing || isDownloadingBatch || !batchQueue.some(i => i.status === 'done')}
                                        className={`px-4 py-2 rounded font-bold text-sm flex items-center gap-2 disabled:opacity-50
                                            ${isDownloadingBatch ? 'bg-gray-600 text-gray-300' : 'bg-green-600 hover:bg-green-500 text-white'}`}
                                     >
                                         {isDownloadingBatch ? <Loader2 size={16} className="animate-spin"/> : <Download size={16} />}
                                         {isDownloadingBatch ? 'Đang Nén ZIP...' : 'Tải Tất Cả (ZIP)'}
                                     </button>
                                 </div>
                             </div>

                             <div className="bg-gray-900 rounded-lg overflow-hidden border border-gray-800 max-h-[500px] overflow-y-auto">
                                 <table className="w-full text-left text-sm">
                                     <thead className="bg-gray-800 text-gray-400 uppercase text-xs sticky top-0 z-10">
                                         <tr>
                                             <th className="px-4 py-3">Folder / Set Code (Editable)</th>
                                             <th className="px-4 py-3 text-center">Ảnh Gốc</th>
                                             <th className="px-4 py-3 text-center">Trạng thái</th>
                                             <th className="px-4 py-3">Kết quả (Layout)</th>
                                             <th className="px-4 py-3 text-right">Preview</th>
                                             <th className="px-4 py-3 text-center w-24">Action</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-gray-800">
                                         {batchQueue.map((item) => (
                                             <tr key={item.id} className="hover:bg-gray-800/50">
                                                 <td className="px-4 py-3 font-mono text-white">
                                                     <input 
                                                        type="text" 
                                                        className="bg-gray-800 border border-gray-600 rounded px-2 py-1 w-full text-sm font-bold text-white focus:border-blue-500 outline-none"
                                                        value={item.customName || item.folderName}
                                                        onChange={(e) => handleUpdateName(item.id, e.target.value)}
                                                     />
                                                 </td>
                                                 <td className="px-4 py-3 text-center text-gray-400">
                                                     {item.originalImages.length} file
                                                 </td>
                                                 <td className="px-4 py-3">
                                                     <div className="flex items-center gap-2 justify-center">
                                                         {getBatchStatusIcon(item.status)}
                                                         <span className={`text-xs ${
                                                             item.status === 'failed' ? 'text-red-400' :
                                                             item.status === 'done' ? 'text-green-400' :
                                                             item.status === 'skipped' ? 'text-yellow-400' :
                                                             'text-gray-400'
                                                         }`}>
                                                             {item.statusMessage || item.status}
                                                         </span>
                                                     </div>
                                                 </td>
                                                 <td className="px-4 py-3 text-gray-300">
                                                     {item.status === 'done' ? (
                                                         <span className="bg-blue-900/30 text-blue-300 px-2 py-1 rounded text-xs border border-blue-800">
                                                             Layout: {item.selectedLayout} ({item.processedImages.length} ảnh)
                                                         </span>
                                                     ) : '-'}
                                                 </td>
                                                 <td className="px-4 py-3 text-right">
                                                     {item.resultImage ? (
                                                         <img 
                                                            src={item.resultImage} 
                                                            className="h-10 w-auto inline-block rounded border border-gray-600 hover:scale-110 transition-transform cursor-zoom-in bg-white" 
                                                            alt="res"
                                                            onClick={() => setPreviewImage(item.resultImage)}
                                                        />
                                                     ) : (
                                                         <div className="h-10 w-10 bg-gray-800 rounded inline-block border border-dashed border-gray-700"></div>
                                                     )}
                                                 </td>
                                                 <td className="px-4 py-3 text-center">
                                                    <div className="flex gap-2 justify-end">
                                                        <button 
                                                            onClick={() => handleRegenerateRow(item)}
                                                            className="p-2 bg-purple-700 hover:bg-purple-600 text-white rounded transition-colors"
                                                            title="Ghép lại với tên mới"
                                                        >
                                                            <RefreshCcw size={14} />
                                                        </button>
                                                        {item.status === 'done' && item.resultImage && (
                                                            <button 
                                                                onClick={() => handleDownloadSingleRow(item)}
                                                                className="p-2 bg-gray-700 hover:bg-green-600 text-white rounded transition-colors"
                                                                title="Tải ảnh này"
                                                            >
                                                                <Download size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                 </td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             </div>
                        </div>
                    )}
                </div>
            )}
            
            {/* --- FULLSCREEN PREVIEW MODAL --- */}
            {previewImage && (
                <div 
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setPreviewImage(null)}
                >
                    <button className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors bg-black/50 rounded-full p-2">
                        <XCircle size={32} />
                    </button>
                    <img 
                        src={previewImage} 
                        className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-200" 
                        alt="Full Preview" 
                        onClick={(e) => e.stopPropagation()} 
                    />
                </div>
            )}
        </div>
    );
};

export default CollageManager;
