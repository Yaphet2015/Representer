/** Node-only canvas factory for page-render tests. Never imported by the extension bundle. */
import { createCanvas } from '@napi-rs/canvas';
import type { PdfCanvasFactory, PdfCanvasPair } from '../lib/pdf-render';

export function nodeCanvasFactory(): PdfCanvasFactory {
  const make = (width: number, height: number): PdfCanvasPair => {
    const canvas = createCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
    return { canvas, context: canvas.getContext('2d') };
  };
  return {
    create: make,
    reset(pair, width, height) { pair.canvas.width = Math.max(1, Math.ceil(width)); pair.canvas.height = Math.max(1, Math.ceil(height)); },
    destroy(pair) { pair.canvas.width = 0; pair.canvas.height = 0; },
  };
}
