import Konva from 'konva';

import { AppError } from '../../errors/app-error';
import type { TStampFieldMeta } from '../../types/field-meta';
import { createFieldHoverInteraction, upsertFieldGroup, upsertFieldRect } from './field-generic-items';
import type { FieldToRender, RenderFieldElementOptions } from './field-renderer';
import { calculateFieldPosition } from './field-renderer';

// Lazily resolved Skia Image binding for server-side rendering. Mirrors the
// pattern used by render-signature-field.ts so the stamp field embeds cleanly
// during PDF sealing without a hard dependency on the DOM.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SkiaImage: any;

void (async () => {
  if (typeof window === 'undefined') {
    const mod = await import('skia-canvas');
    SkiaImage = mod.Image;
  }
})();

/**
 * The pixel ratio used when caching the stamp image bitmap. Konva's default
 * redraw scales the source image with low quality — caching the rasterised
 * bitmap at a high pixel ratio keeps the stamp crisp across zoom levels.
 */
const STAMP_IMAGE_CACHE_PIXEL_RATIO = 2;

/**
 * Calculate the drawn image dimensions inside the field box while
 * preserving the source aspect ratio. The image is centred in the field.
 */
const getStampImageDimensions = (
  sourceWidth: number,
  sourceHeight: number,
  fieldWidth: number,
  fieldHeight: number,
) => {
  const scalingFactor = Math.min(fieldWidth / sourceWidth, fieldHeight / sourceHeight, 1);

  const width = sourceWidth * scalingFactor;
  const height = sourceHeight * scalingFactor;

  return {
    width,
    height,
    x: (fieldWidth - width) / 2,
    y: (fieldHeight - height) / 2,
  };
};

const createStampImageNode = (
  imageAsBase64: string,
  fieldWidth: number,
  fieldHeight: number,
  rotation: number,
): Konva.Image => {
  if (typeof window !== 'undefined') {
    const img = new Image();

    const node = new Konva.Image({
      image: img,
      x: 0,
      y: 0,
      width: fieldWidth,
      height: fieldHeight,
      listening: false,
    });

    img.onload = () => {
      const dims = getStampImageDimensions(img.width, img.height, fieldWidth, fieldHeight);

      node.setAttrs({
        image: img,
        ...dims,
        // Konva rotates about the top-left; offset to the centre so the
        // rotation is applied about the middle of the stamp — matches the
        // pdf-lib embedding path where the rotation anchor is the centre.
        offsetX: dims.width / 2,
        offsetY: dims.height / 2,
        x: dims.x + dims.width / 2,
        y: dims.y + dims.height / 2,
        rotation,
      });

      node.cache({
        pixelRatio: STAMP_IMAGE_CACHE_PIXEL_RATIO * (window.devicePixelRatio || 1),
      });
    };

    img.src = imageAsBase64;

    return node;
  }

  if (!SkiaImage) {
    throw new Error('Skia image not found');
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const img = new SkiaImage(imageAsBase64) as unknown as HTMLImageElement;
  const dims = getStampImageDimensions(img.width, img.height, fieldWidth, fieldHeight);

  return new Konva.Image({
    image: img,
    ...dims,
    offsetX: dims.width / 2,
    offsetY: dims.height / 2,
    x: dims.x + dims.width / 2,
    y: dims.y + dims.height / 2,
    rotation,
    listening: false,
  });
};

export const renderStampFieldElement = (field: FieldToRender, options: RenderFieldElementOptions) => {
  const { mode = 'edit', pageLayer, pageWidth, pageHeight, color } = options;

  const isFirstRender = !pageLayer.findOne(`#${field.renderId}`);

  const fieldGroup = upsertFieldGroup(field, options);

  fieldGroup.removeChildren();

  if (isFirstRender) {
    pageLayer.add(fieldGroup);
  }

  const fieldRect = upsertFieldRect(field, options);
  fieldGroup.add(fieldRect);

  const { fieldWidth, fieldHeight } = calculateFieldPosition(field, pageWidth, pageHeight);
  const stampMeta = field.fieldMeta as TStampFieldMeta | undefined;
  const rotation = stampMeta?.rotation ?? 0;

  const signature = field.signature;
  const imageAsBase64 = signature?.signatureImageAsBase64;

  if (mode === 'export' && field.inserted && !imageAsBase64) {
    throw new AppError('MISSING_STAMP_IMAGE');
  }

  if (field.inserted && imageAsBase64) {
    const stampNode = createStampImageNode(imageAsBase64, fieldWidth, fieldHeight, rotation);
    fieldGroup.add(stampNode);
  } else if (mode !== 'export') {
    // Placeholder label — "Stamp"
    const placeholder = new Konva.Text({
      id: `${field.renderId}-text`,
      name: 'field-text',
      listening: false,
      text: 'Stamp',
      fontSize: 12,
      align: 'center',
      verticalAlign: 'middle',
      width: fieldWidth,
      height: fieldHeight,
    });

    fieldGroup.add(placeholder);
  }

  if (mode === 'export') {
    fieldRect.opacity(0);
  }

  if (color !== 'readOnly' && mode !== 'export') {
    createFieldHoverInteraction({ fieldGroup, fieldRect, options });
  }

  return {
    fieldGroup,
    isFirstRender,
  };
};
