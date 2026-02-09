// Pure-JS PNG generation using pngjs for writing, fast-png for reading
import { PNG } from 'pngjs';
import { decode as decodePng } from 'fast-png';

const FLAT_COLORS = {
  blue: [157, 213, 238],
  yellow: [226, 208, 96],
  pink: [228, 184, 192],
};

function getColor(color) {
  return FLAT_COLORS[color] || FLAT_COLORS.blue;
}

/**
 * Generate strip image.
 * If a drawing data URL is provided, decode it and composite onto the color background.
 * Otherwise, generate a solid-color strip.
 * Strip @3x: 1125 x 1032 (tall strip for more visual space)
 */
export function generateStripPng(color, drawingDataUrl) {
  const width = 1125;
  const height = 1032;
  const [r, g, b] = getColor(color);

  // Create background
  const bg = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) << 2;
      bg.data[idx] = r;
      bg.data[idx + 1] = g;
      bg.data[idx + 2] = b;
      bg.data[idx + 3] = 255;
    }
  }

  // If drawing provided, try to composite it on top
  if (drawingDataUrl) {
    try {
      const base64Match = drawingDataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (base64Match) {
        const b64 = base64Match[1];
        const binStr = atob(b64);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        // Use fast-png for decoding (pngjs inflate fails on CF Workers)
        const decoded = decodePng(bytes);
        const drawing = { width: decoded.width, height: decoded.height, data: decoded.data };

        // Scale drawing to fit strip width, center vertically
        const scale = Math.min(width / drawing.width, height / drawing.height);
        const scaledW = Math.floor(drawing.width * scale);
        const scaledH = Math.floor(drawing.height * scale);
        const offsetX = Math.floor((width - scaledW) / 2);
        const offsetY = Math.floor((height - scaledH) / 2);

        for (let dy = 0; dy < scaledH; dy++) {
          for (let dx = 0; dx < scaledW; dx++) {
            const sx = Math.floor(dx / scale);
            const sy = Math.floor(dy / scale);
            const destX = dx + offsetX;
            const destY = dy + offsetY;
            if (destX < 0 || destX >= width || destY < 0 || destY >= height) continue;
            if (sx >= drawing.width || sy >= drawing.height) continue;

            const srcIdx = (sy * drawing.width + sx) << 2;
            const dstIdx = (destY * width + destX) << 2;
            const srcA = drawing.data[srcIdx + 3] / 255;
            if (srcA === 0) continue;

            const dstA = bg.data[dstIdx + 3] / 255;
            const outA = srcA + dstA * (1 - srcA);
            if (outA > 0) {
              bg.data[dstIdx] = Math.round((drawing.data[srcIdx] * srcA + bg.data[dstIdx] * dstA * (1 - srcA)) / outA);
              bg.data[dstIdx + 1] = Math.round((drawing.data[srcIdx + 1] * srcA + bg.data[dstIdx + 1] * dstA * (1 - srcA)) / outA);
              bg.data[dstIdx + 2] = Math.round((drawing.data[srcIdx + 2] * srcA + bg.data[dstIdx + 2] * dstA * (1 - srcA)) / outA);
              bg.data[dstIdx + 3] = Math.round(outA * 255);
            }
          }
        }
      }
    } catch (e) {
      console.error('Drawing composite failed:', e.message, e.stack);
      // Fall through to solid color strip
    }
  }

  return PNG.sync.write(bg);
}

/**
 * Generate icon image: colored rounded square with memo lines.
 * Since we can't do anti-aliased round rects with raw pixels easily,
 * we draw a solid square with simple horizontal lines.
 * Size: 87x87
 */
export function generateIconPng(color) {
  const size = 87;
  const [r, g, b] = getColor(color);

  const png = new PNG({ width: size, height: size });

  // Fill with transparent
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 0;
    png.data[i + 1] = 0;
    png.data[i + 2] = 0;
    png.data[i + 3] = 0;
  }

  // Draw filled square with margin (4px padding, skip rounded corners for simplicity)
  const pad = 4;
  const cornerR = 12;
  for (let y = pad; y < size - pad; y++) {
    for (let x = pad; x < size - pad; x++) {
      // Simple rounded corner check
      const inCorner = (
        (x < pad + cornerR && y < pad + cornerR && dist(x, y, pad + cornerR, pad + cornerR) > cornerR) ||
        (x > size - pad - cornerR - 1 && y < pad + cornerR && dist(x, y, size - pad - cornerR - 1, pad + cornerR) > cornerR) ||
        (x < pad + cornerR && y > size - pad - cornerR - 1 && dist(x, y, pad + cornerR, size - pad - cornerR - 1) > cornerR) ||
        (x > size - pad - cornerR - 1 && y > size - pad - cornerR - 1 && dist(x, y, size - pad - cornerR - 1, size - pad - cornerR - 1) > cornerR)
      );
      if (inCorner) continue;

      const idx = (y * size + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }

  // Draw 3 horizontal "memo lines" (dark, semi-transparent)
  const lineColor = [0, 0, 0, 77]; // rgba(0,0,0,0.3)
  drawHLine(png, size, 22, 65, 30, lineColor, 3);
  drawHLine(png, size, 22, 55, 44, lineColor, 3);
  drawHLine(png, size, 22, 45, 58, lineColor, 3);

  return PNG.sync.write(png);
}

function dist(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

function drawHLine(png, width, x1, x2, y, color, thickness) {
  const [r, g, b, a] = color;
  for (let t = 0; t < thickness; t++) {
    const cy = y + t;
    if (cy < 0 || cy >= width) continue;
    for (let x = x1; x <= x2; x++) {
      if (x < 0 || x >= width) continue;
      const idx = (cy * width + x) << 2;
      // Alpha blend
      const srcA = a / 255;
      const dstA = png.data[idx + 3] / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA > 0) {
        png.data[idx] = Math.round((r * srcA + png.data[idx] * dstA * (1 - srcA)) / outA);
        png.data[idx + 1] = Math.round((g * srcA + png.data[idx + 1] * dstA * (1 - srcA)) / outA);
        png.data[idx + 2] = Math.round((b * srcA + png.data[idx + 2] * dstA * (1 - srcA)) / outA);
        png.data[idx + 3] = Math.round(outA * 255);
      }
    }
  }
}
