import Konva from 'konva';

import type { TStampFieldMeta } from '../../types/field-meta';
import { createFieldHoverInteraction, upsertFieldGroup, upsertFieldRect } from './field-generic-items';
import type { FieldToRender, RenderFieldElementOptions } from './field-renderer';
import { calculateFieldPosition } from './field-renderer';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SkiaImage: any;

void (async () => {
  if (typeof window === 'undefined') {
    const mod = await import('skia-canvas');
    SkiaImage = mod.Image;
  }
})();

/**
 * The pixel ratio used when caching the stamp image as an offscreen bitmap so it
 * stays sharp on redraws and zoom changes. Mirrors the signature renderer.
 */
const STAMP_IMAGE_CACHE_PIXEL_RATIO = 2;

/**
 * Fit an image of the given intrinsic size inside the field bounds while
 * preserving its aspect ratio, and centre it. Returns the placement in field
 * (group) local coordinates.
 */
const getStampImageDimensions = (
  intrinsicWidth: number,
  intrinsicHeight: number,
  fieldWidth: number,
  fieldHeight: number,
) => {
  // Never upscale past the intrinsic size, and always fit within the field.
  const scalingFactor = Math.min(fieldWidth / intrinsicWidth, fieldHeight / intrinsicHeight);

  const width = intrinsicWidth * scalingFactor;
  const height = intrinsicHeight * scalingFactor;

  return {
    width,
    height,
    x: (fieldWidth - width) / 2,
    y: (fieldHeight - height) / 2,
  };
};

/**
 * Build a Konva.Image for a base64 stamp, sized to fit within the field bounds
 * with the aspect ratio preserved and rotated about its centre. Works in both
 * the browser and Node.js (via skia-canvas) so it can be reused for exporting.
 */
const createStampImage = (
  imageBase64: string,
  fieldWidth: number,
  fieldHeight: number,
  rotation: number,
  intrinsic?: { width?: number; height?: number },
): Konva.Image => {
  const applyPlacement = (image: Konva.Image, intrinsicWidth: number, intrinsicHeight: number) => {
    const { width, height, x, y } = getStampImageDimensions(intrinsicWidth, intrinsicHeight, fieldWidth, fieldHeight);

    // Rotate about the centre of the fitted image by moving the offset to the
    // centre and positioning by the centre point.
    image.width(width);
    image.height(height);
    image.offsetX(width / 2);
    image.offsetY(height / 2);
    image.x(x + width / 2);
    image.y(y + height / 2);
    image.rotation(rotation);
    image.listening(false);
  };

  if (typeof window !== 'undefined') {
    const img = new Image();

    const image = new Konva.Image({
      image: img,
      x: 0,
      y: 0,
      width: fieldWidth,
      height: fieldHeight,
      listening: false,
    });

    img.onload = () => {
      image.image(img);
      applyPlacement(image, intrinsic?.width || img.width, intrinsic?.height || img.height);

      image.cache({
        pixelRatio: STAMP_IMAGE_CACHE_PIXEL_RATIO * (window.devicePixelRatio || 1),
      });

      image.getLayer()?.batchDraw();
    };

    img.src = imageBase64;

    return image;
  }

  // Node.js with skia-canvas (export / sealing preview).
  if (!SkiaImage) {
    throw new Error('Skia image not found');
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const img = new SkiaImage(imageBase64) as unknown as HTMLImageElement;

  const image = new Konva.Image({ image: img, listening: false });

  applyPlacement(image, intrinsic?.width || img.width, intrinsic?.height || img.height);

  return image;
};

export const renderStampFieldElement = (field: FieldToRender, options: RenderFieldElementOptions) => {
  const { mode = 'edit', pageLayer, pageWidth, pageHeight, color, translations } = options;

  const isFirstRender = !pageLayer.findOne(`#${field.renderId}`);

  const fieldGroup = upsertFieldGroup(field, options);

  fieldGroup.removeChildren();
  fieldGroup.off('transform');

  if (isFirstRender) {
    pageLayer.add(fieldGroup);
  }

  const fieldRect = upsertFieldRect(field, options);
  fieldGroup.add(fieldRect);

  const { fieldWidth, fieldHeight } = calculateFieldPosition(field, pageWidth, pageHeight);

  const fieldMeta = field.fieldMeta as TStampFieldMeta | undefined;
  const rotation = fieldMeta?.rotation ?? 0;

  if (fieldMeta?.imageBase64) {
    const stampImage = createStampImage(fieldMeta.imageBase64, fieldWidth, fieldHeight, rotation, {
      width: fieldMeta.imageWidth,
      height: fieldMeta.imageHeight,
    });

    fieldGroup.add(stampImage);

    // Keep the image fitted (aspect preserved) while the field is resized.
    fieldGroup.on('transform', () => {
      const groupScaleX = fieldGroup.scaleX();
      const groupScaleY = fieldGroup.scaleY();

      const rectWidth = fieldRect.width() * groupScaleX;
      const rectHeight = fieldRect.height() * groupScaleY;

      stampImage.scaleX(1 / groupScaleX);
      stampImage.scaleY(1 / groupScaleY);

      const { width, height, x, y } = getStampImageDimensions(
        fieldMeta.imageWidth || stampImage.width(),
        fieldMeta.imageHeight || stampImage.height(),
        rectWidth,
        rectHeight,
      );

      stampImage.width(width);
      stampImage.height(height);
      stampImage.offsetX(width / 2);
      stampImage.offsetY(height / 2);
      stampImage.x(x + width / 2);
      stampImage.y(y + height / 2);

      fieldGroup.getLayer()?.batchDraw();
    });

    fieldGroup.on('transformend', () => {
      stampImage.scaleX(1);
      stampImage.scaleY(1);
    });
  } else {
    // No image yet: show the field type label as a placeholder.
    const label = new Konva.Text({
      id: `${field.renderId}-text`,
      name: 'field-text',
      listening: false,
      x: 0,
      y: 0,
      width: fieldWidth,
      height: fieldHeight,
      align: 'center',
      verticalAlign: 'middle',
      text: translations?.[field.type] || 'Stamp',
      fontSize: 12,
      fill: 'black',
    });

    fieldGroup.add(label);
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
