
import { LogType, ShopeeProduct } from '../types';

// Shopee Image Base URL
const SHOPEE_IMG_BASE = 'https://down-vn.img.susercontent.com/file/';

// Proxy helper (Reused logic but simplified for Shopee JSON)
const fetchWithProxy = async (targetUrl: string): Promise<any> => {
    // Ưu tiên CodeTabs cho API JSON
    const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`;
    
    try {
        const response = await fetch(proxyUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
    } catch (error) {
        // Fallback AllOrigins if CodeTabs fails
        const backupUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
        const res = await fetch(backupUrl);
        const data = await res.json();
        if (data.contents) return JSON.parse(data.contents);
        throw new Error("Proxy failed");
    }
};

/**
 * Extract Shop ID from a Shopee URL.
 * Supports: 
 * 1. Product Link: shopee.vn/product-name-i.SHOPID.ITEMID
 * 2. Shop Link (Link Share): shopee.vn/shop/SHOPID
 */
export const extractShopId = (input: string): string | null => {
    // Case 1: Product Link (format: ...-i.12345.67890)
    const productMatch = input.match(/-i\.(\d+)\.(\d+)/);
    if (productMatch) return productMatch[1];

    // Case 2: Direct Shop ID input (just numbers)
    if (/^\d+$/.test(input.trim())) return input.trim();

    // Case 3: Shop URL with ID explicitly (rare on web, common on mobile share)
    const shopMatch = input.match(/shop\/(\d+)/);
    if (shopMatch) return shopMatch[1];

    return null;
};

/**
 * Fetch items using the Recommended Items API.
 * Updated to support both 'data.items' (Old) and 'data.centralize_item_card.item_cards' (New).
 */
export const crawlShopeeShop = async (
    shopId: string,
    limit: number,
    addLog: (msg: string, type: LogType) => void
): Promise<ShopeeProduct[]> => {
    
    addLog(`🛒 Bắt đầu quét Shop ID: ${shopId}`, LogType.INFO);
    
    let allProducts: ShopeeProduct[] = [];
    let offset = 0;
    const batchSize = 30; // API usually handles 30-50 well
    let hasMore = true;

    // Safety Loop limit
    const MAX_LOOP = Math.ceil(limit / batchSize) + 2; 
    let loopCount = 0;

    while (hasMore && allProducts.length < limit && loopCount < MAX_LOOP) {
        loopCount++;
        const url = `https://shopee.vn/api/v4/shop/rcmd_items?bundle=shop_page_category_tab_main&limit=${batchSize}&offset=${offset}&shop_id=${shopId}&sort_type=1`;
        
        addLog(`📡 Fetching page ${loopCount} (Offset: ${offset})...`, LogType.SYSTEM);

        try {
            const data = await fetchWithProxy(url);

            if (data.error) {
                throw new Error(`Shopee API Error: ${data.error_msg || 'Unknown'}`);
            }

            // --- DETECT DATA STRUCTURE ---
            let items = data.data?.items;
            let isNewFormat = false;

            // Check for New Format (centralize_item_card)
            if (!items && data.data?.centralize_item_card?.item_cards) {
                items = data.data.centralize_item_card.item_cards;
                isNewFormat = true;
            }

            if (!items || items.length === 0) {
                hasMore = false;
                addLog(`ℹ️ Không còn sản phẩm nào.`, LogType.WARNING);
                break;
            }

            // Map Data
            const products: ShopeeProduct[] = items.map((i: any) => {
                // Priority Check for Shop Name
                // 1. i.shop_data.shop_name
                // 2. i.shop_name
                // 3. i.shop_location
                const shopName = i.shop_data?.shop_name || i.shop_name || i.shop_location || "Unknown Shop";

                if (isNewFormat) {
                    // Mapping for New Structure
                    const asset = i.item_card_displayed_asset || {};
                    const priceObj = i.item_card_display_price || {};
                    
                    return {
                        itemid: i.itemid,
                        shopid: i.shopid,
                        shop_name: shopName,
                        name: asset.name || "No Name",
                        image: asset.image || "",
                        images: asset.images || [asset.image],
                        price: (priceObj.price || 0) / 100000, // New API returns price * 100,000
                        stock: i.stock || 999,
                        historical_sold: i.item_card_display_sold_count?.historical_sold_count || 0,
                        rating_star: i.item_rating?.rating_star || 0,
                        currency: 'VND',
                        status: 'active'
                    };
                } else {
                    // Mapping for Old Structure
                    return {
                        itemid: i.itemid,
                        shopid: i.shopid,
                        shop_name: shopName,
                        name: i.name,
                        image: i.image,
                        images: i.images || [i.image],
                        price: i.price / 100000,
                        stock: i.stock,
                        historical_sold: i.historical_sold,
                        rating_star: i.item_rating?.rating_star || 0,
                        currency: i.currency,
                        status: i.status === 1 ? 'active' : 'inactive'
                    };
                }
            });

            allProducts = [...allProducts, ...products];
            addLog(`✅ Tìm thấy ${products.length} sản phẩm mới.`, LogType.SUCCESS);

            offset += batchSize;
            
            // Basic delay to be polite
            await new Promise(r => setTimeout(r, 1000));

        } catch (error: any) {
            addLog(`❌ Lỗi tại offset ${offset}: ${error.message}`, LogType.ERROR);
            break; // Stop on error
        }
    }

    // Limit result
    return allProducts.slice(0, limit);
};
