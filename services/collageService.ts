

import { LayoutType, CollageConfig, LocalImage, LogoBox } from '../types';

/**
 * Loads an image from a URL into an HTMLImageElement
 */
const loadImage = (url: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
};

/**
 * Helper to read file as Base64 DataURL (Original Quality)
 */
const fileToDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

/**
 * ALGORITHM: Trim White Borders (Auto Crop)
 * Scans the image pixel data to find the bounding box of content.
 * Handles both white background (RGB > 230) and transparent pixels (A < 50).
 */
export const trimWhitespace = (img: HTMLImageElement): Promise<HTMLCanvasElement | HTMLImageElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    
    // 'willReadFrequently: true' optimizes for frequent calls to getImageData
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return Promise.resolve(img);

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = imageData;

    let top = 0, bottom = height, left = 0, right = width;

    // Helper to determine if a pixel is "Content"
    const isContent = (index: number) => {
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const a = data[index + 3];

        // 1. Check Transparency (If transparent, it's NOT content, it's empty)
        if (a < 50) return false;

        // 2. Check Whiteness (If very bright/white, it's NOT content, it's background)
        // Threshold 230 handles slight compression noise or off-white.
        if (r > 230 && g > 230 && b > 230) return false;

        // Otherwise, it's content
        return true;
    };

    // Scan Top
    for (let y = 0; y < height; y++) {
        let rowHasContent = false;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (isContent(i)) {
                rowHasContent = true;
                break;
            }
        }
        if (rowHasContent) {
            top = y;
            break;
        }
    }

    // Scan Bottom
    for (let y = height - 1; y >= 0; y--) {
        let rowHasContent = false;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (isContent(i)) {
                rowHasContent = true;
                break;
            }
        }
        if (rowHasContent) {
            bottom = y + 1;
            break;
        }
    }

    // Scan Left
    for (let x = 0; x < width; x++) {
        let colHasContent = false;
        for (let y = top; y < bottom; y++) {
            const i = (y * width + x) * 4;
            if (isContent(i)) {
                colHasContent = true;
                break;
            }
        }
        if (colHasContent) {
            left = x;
            break;
        }
    }

    // Scan Right
    for (let x = width - 1; x >= 0; x--) {
        let colHasContent = false;
        for (let y = top; y < bottom; y++) {
            const i = (y * width + x) * 4;
            if (isContent(i)) {
                colHasContent = true;
                break;
            }
        }
        if (colHasContent) {
            right = x + 1;
            break;
        }
    }

    // If image is blank or fully white/transparent, return original to avoid errors
    if (right <= left || bottom <= top) return Promise.resolve(img);

    // Create cropped canvas
    const trimWidth = right - left;
    const trimHeight = bottom - top;
    
    // Safety check for tiny crops
    if (trimWidth < 10 || trimHeight < 10) return Promise.resolve(img);

    // Check if crop is actually needed (if full size is kept, return original to save quality)
    if (trimWidth === width && trimHeight === height) return Promise.resolve(img);

    const trimmedCanvas = document.createElement('canvas');
    trimmedCanvas.width = trimWidth;
    trimmedCanvas.height = trimHeight;
    const trimmedCtx = trimmedCanvas.getContext('2d');
    if (!trimmedCtx) return Promise.resolve(img);

    // Disable smoothing for copy to ensure sharp edges 
    trimmedCtx.imageSmoothingEnabled = false; 

    trimmedCtx.drawImage(canvas, left, top, trimWidth, trimHeight, 0, 0, trimWidth, trimHeight);
    
    return Promise.resolve(trimmedCanvas);
};

/**
 * ALGORITHM V4: "Smart Fill"
 */
const healRegion = (
    ctx: CanvasRenderingContext2D,
    box: LogoBox,
    renderX: number,
    renderY: number,
    renderW: number,
    renderH: number
) => {
    if (!box.hasLogo) return;

    const pad = 15;
    const x = renderX + (box.xmin / 1000) * renderW;
    const y = renderY + (box.ymin / 1000) * renderH;
    const w = ((box.xmax - box.xmin) / 1000) * renderW;
    const h = ((box.ymax - box.ymin) / 1000) * renderH;

    const tx = Math.floor(Math.max(renderX, x - pad));
    const ty = Math.floor(Math.max(renderY, y - pad));
    const tw = Math.floor(Math.min(renderX + renderW - tx, w + pad * 2));
    const th = Math.floor(Math.min(renderY + renderH - ty, h + pad * 2));

    if (tw <= 0 || th <= 0) return;

    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = tw;
    patchCanvas.height = th;
    const pCtx = patchCanvas.getContext('2d');
    if (!pCtx) return;

    // Edge Stretching
    pCtx.drawImage(ctx.canvas, tx, ty - 1, tw, 1, 0, 0, tw, th);
    pCtx.globalAlpha = 0.5;
    pCtx.drawImage(ctx.canvas, tx, ty + th, tw, 1, 0, 0, tw, th);
    pCtx.globalAlpha = 0.5; 
    pCtx.drawImage(ctx.canvas, tx - 1, ty, 1, th, 0, 0, tw, th);
    pCtx.drawImage(ctx.canvas, tx + tw, ty, 1, th, 0, 0, tw, th);
    pCtx.globalAlpha = 1.0;

    // Blur
    pCtx.filter = 'blur(4px)';
    pCtx.drawImage(patchCanvas, 0, 0);
    pCtx.filter = 'none';

    // Noise
    const imgData = pCtx.getImageData(0, 0, tw, th);
    const data = imgData.data;
    const noiseAmount = 15;

    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * noiseAmount;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i+1] = Math.min(255, Math.max(0, data[i+1] + noise));
        data[i+2] = Math.min(255, Math.max(0, data[i+2] + noise));
    }
    pCtx.putImageData(imgData, 0, 0);

    ctx.save();
    ctx.drawImage(patchCanvas, tx, ty);
    ctx.restore();
};

/**
 * Draws text overlay
 * Added isTitle param to make global text even larger.
 */
const drawTextLabel = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    w: number,
    h: number,
    position: 'bottom-left' | 'center',
    isTitle: boolean = false
) => {
    if (!text) return;

    ctx.save();
    const scaleFactor = ctx.canvas.width / 1200;
    // Base size 70, Title size 100 (Much larger for global center)
    const baseSize = isTitle ? 100 : 70;
    const fontSize = baseSize * scaleFactor; 
    
    ctx.font = `bold ${fontSize}px sans-serif`;
    
    const metrics = ctx.measureText(text);
    const textWidth = metrics.width;
    const padding = 20 * scaleFactor;
    
    let labelX, labelY;

    if (position === 'center') {
        // Absolute Center of the provided area (usually the whole canvas)
        labelX = x + (w - (textWidth + padding * 2)) / 2;
        labelY = y + (h / 2) + (fontSize / 3); 
    } else {
        // Bottom Left
        labelX = x + (20 * scaleFactor); 
        labelY = y + h - (20 * scaleFactor) - padding;
    }

    // Draw Pill Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    
    const radius = 10 * scaleFactor;
    const rectY = labelY - fontSize; // Adjust Y up to cover ascenders

    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(labelX, rectY, textWidth + padding * 2, fontSize + padding, radius);
        ctx.fill();
    } else {
        ctx.fillRect(labelX, rectY, textWidth + padding * 2, fontSize + padding);
    }

    // Draw Text
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, labelX + padding, labelY);

    ctx.restore();
};

/**
 * Draws an image into a context, scaling to 'cover' the target area.
 * Updated to support 'none' for textPosition to skip drawing text per image.
 * Accepts HTMLImageElement OR HTMLCanvasElement (from crop).
 */
const drawImageCover = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement, 
  imgData: LocalImage,
  x: number,
  y: number,
  w: number,
  h: number,
  shouldRemoveLogo: boolean,
  textPosition: 'bottom-left' | 'center' | 'none'
) => {
  const imgRatio = img.width / img.height;
  const targetRatio = w / h;

  let renderW, renderH, offsetX, offsetY;

  // SCALE TO COVER
  if (targetRatio > imgRatio) {
    renderW = w;
    renderH = w / imgRatio;
    offsetX = 0;
    offsetY = (h - renderH) / 2; 
  } else {
    renderH = h;
    renderW = h * imgRatio;
    offsetX = (w - renderW) / 2; 
    offsetY = 0;
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  
  // 1. Draw Original Image (or Cropped Canvas)
  ctx.drawImage(img, x + offsetX, y + offsetY, renderW, renderH);

  // 2. Smart Remove Logo (Note: Logo Coordinates might be off if cropped, 
  // but usually users trim borders because logo is in whitespace, or logo is inside content. 
  // If cropped, logo removal is best effort based on relative pos)
  if (shouldRemoveLogo && imgData.logoInfo && imgData.logoInfo.hasLogo) {
      healRegion(ctx, imgData.logoInfo, x + offsetX, y + offsetY, renderW, renderH);
  }

  // 3. Draw Custom Text (Set 1, etc.) - ONLY if mode is NOT 'none'
  if (textPosition !== 'none' && imgData.customText) {
      drawTextLabel(ctx, imgData.customText, x, y, w, h, textPosition as 'bottom-left' | 'center');
  }

  ctx.restore();
};

/**
 * NEW: Process a single image: Load, Auto-Crop White Borders, Return Base64.
 * Used for creating "Best Cover" images.
 * Updated: Accepts `shouldCrop` to bypass processing for max speed/quality.
 */
export const processAndCropSingleImage = async (file: File, shouldCrop: boolean = true): Promise<string> => {
    // OPTIMIZATION: If auto-crop is disabled, return original file directly.
    // This is the SHARPEST possible option (no re-encoding).
    if (!shouldCrop) {
        return await fileToDataURL(file);
    }
    
    try {
        // 1. Load File to URL
        const url = URL.createObjectURL(file);
        
        // 2. Load Image Object
        const img = await loadImage(url);
        URL.revokeObjectURL(url); // Clean up memory
        
        // 3. Trim Whitespace
        const cropped = await trimWhitespace(img);
        
        // 4. Return as Data URL (High Quality PNG)
        if (cropped instanceof HTMLCanvasElement) {
            return cropped.toDataURL('image/png', 1.0);
        } else {
            // If trimWhitespace returned original img (no crop needed), return original file bytes
            // This preserves 100% fidelity.
            return await fileToDataURL(file);
        }
    } catch (e) {
        console.error("Error cropping single image", e);
        return await fileToDataURL(file); // Fail-safe to original
    }
};

/**
 * NEW: Generate High-Quality 9:16 Cover (2160x3840)
 * Logic: Scale to COVER (Fill area, crop excess) + Center alignment.
 * Updated to 4K resolution.
 */
export const processCoverImage916 = async (file: File): Promise<string> => {
    const TARGET_W = 2160;
    const TARGET_H = 3840; // 9:16 4K

    try {
        const url = URL.createObjectURL(file);
        const img = await loadImage(url);
        URL.revokeObjectURL(url);

        const canvas = document.createElement('canvas');
        canvas.width = TARGET_W;
        canvas.height = TARGET_H;

        const ctx = canvas.getContext('2d', {
            colorSpace: 'display-p3',
            alpha: false
        });

        if (!ctx) return await fileToDataURL(file); // Fallback

        // Enable High Quality Scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Calculate Scale to COVER
        const imgRatio = img.width / img.height;
        const targetRatio = TARGET_W / TARGET_H;

        let renderW, renderH, offsetX, offsetY;

        if (imgRatio > targetRatio) {
            // Image is wider than target: Scale by Height, Crop Width
            renderH = TARGET_H;
            renderW = TARGET_H * imgRatio;
            offsetX = (TARGET_W - renderW) / 2; // Center Horizontally
            offsetY = 0;
        } else {
            // Image is taller/thinner than target: Scale by Width, Crop Height
            renderW = TARGET_W;
            renderH = TARGET_W / imgRatio;
            offsetX = 0;
            offsetY = (TARGET_H - renderH) / 2; // Center Vertically
        }

        // Draw with white background fallback (though cover should fill it)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, TARGET_W, TARGET_H);

        // Draw Image
        ctx.drawImage(img, offsetX, offsetY, renderW, renderH);

        // Return High Quality PNG
        return canvas.toDataURL('image/png', 1.0);

    } catch (e) {
        console.error("Error generating 9:16 cover", e);
        return await fileToDataURL(file);
    }
};

export const generateCollage = async (
  inputImages: LocalImage[],
  layout: LayoutType,
  config: CollageConfig
): Promise<string> => {
  const { width, height, gap, backgroundColor, removeLogo, autoCrop, textPosition, globalText } = config;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  
  // High Quality Context Settings
  const ctx = canvas.getContext('2d', { 
      colorSpace: 'display-p3', // Use P3 color space for better colors on modern screens
      alpha: false 
  });

  if (!ctx) throw new Error('Could not get canvas context');

  // ENABLE HIGH QUALITY SMOOTHING
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Background
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  // Load raw images
  const rawImages = await Promise.all(inputImages.map(local => loadImage(local.previewUrl)));
  if (rawImages.length === 0) return '';

  // Apply Auto-Crop if enabled
  let processedImages: (HTMLImageElement | HTMLCanvasElement)[] = rawImages;
  if (autoCrop) {
      // Process each image to trim whitespace
      processedImages = await Promise.all(rawImages.map(img => trimWhitespace(img)));
  }

  // Determine if we draw text per image or globally later
  // If 'center', we skip drawing text per image (pass 'none')
  const cellTextMode = textPosition === 'center' ? 'none' : 'bottom-left';

  const safeDraw = (index: number, x: number, y: number, w: number, h: number) => {
      if (processedImages[index]) {
          drawImageCover(ctx, processedImages[index], inputImages[index], x, y, w, h, removeLogo, cellTextMode);
      }
  };

  try {
    if (layout === '2x1') {
      const w = (width - gap * 3) / 2;
      const h = height - gap * 2;
      safeDraw(0, gap, gap, w, h);
      safeDraw(1, gap * 2 + w, gap, w, h);

    } else if (layout === '1x2') {
       const w = width - gap * 2;
       const h = (height - gap * 3) / 2;
       safeDraw(0, gap, gap, w, h);
       safeDraw(1, gap, gap * 2 + h, w, h);

    } else if (layout === '2x2') {
      const w = (width - gap * 3) / 2;
      const h = (height - gap * 3) / 2;
      safeDraw(0, gap, gap, w, h);
      safeDraw(1, gap * 2 + w, gap, w, h);
      safeDraw(2, gap, gap * 2 + h, w, h);
      safeDraw(3, gap * 2 + w, gap * 2 + h, w, h);

    } else if (layout === '4x1') {
        const w = (width - gap * 5) / 4;
        const h = height - gap * 2;
        safeDraw(0, gap, gap, w, h);
        safeDraw(1, gap * 2 + w, gap, w, h);
        safeDraw(2, gap * 3 + w * 2, gap, w, h);
        safeDraw(3, gap * 4 + w * 3, gap, w, h);
    } else if (layout === '1x1') {
        const w = width - gap * 2;
        const h = height - gap * 2;
        safeDraw(0, gap, gap, w, h);
    }

    // --- DRAW GLOBAL CENTER TEXT ---
    // This draws one single large label in the absolute center of the collage
    if (textPosition === 'center' && globalText) {
        drawTextLabel(ctx, globalText, 0, 0, width, height, 'center', true); // isTitle = true
    }

  } catch (err) {
      console.error("Error drawing layout", err);
  }

  // EXPORT AS PNG (Lossless) instead of JPEG for max quality
  return canvas.toDataURL('image/png');
};
