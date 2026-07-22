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
 * Cache pixel ratio used for offscreen rasterisation so the stamp stays sharp
 * when the field is redrawn at different zoom levels. Mirrors the signature
 * renderer's cache to keep visual quality consistent.
 */
const STAMP_IMAGE_CACHE_PIXEL_RATIO = 2;

/**
 * Compute a "contain" fit for the stamp image inside the field bounds while
 * preserving the intrinsic aspect ratio of the uploaded picture.
 */
const getStampImageDimensions = (img: HTMLImageElement, fieldWidth: number, fieldHeight: number) => {
  let imageWidth = img.width;
  let imageHeight = img.height;

  const scalingFactor = Math.min(fieldWidth / imageWidth, fieldHeight / imageHeight, 1);

  imageWidth = imageWidth * scalingFactor;
  imageHeight = imageHeight * scalingFactor;

  const imageX = (fieldWidth - imageWidth) / 2;
  const imageY = (fieldHeight - imageHeight) / 2;

  return {
    width: imageWidth,
    height: imageHeight,
    x: imageX,
    y: imageY,
  };
};

/**
 * Build a Konva.Image node for the stamp image, sized to fit inside the field
 * bounds. Works both in the browser and in the Node exporter (skia-canvas).
 */
const createStampImage = (
  stampImageAsBase64: string,
  fieldWidth: number,
  fieldHeight: number,
  rotationDegrees: number,
): Konva.Image => {
  const applyRotationAroundCentre = (image: Konva.Image, width: number, height: number) => {
    if (!rotationDegrees) {
      return;
    }

    // Konva rotates about the origin (top-left) by default; shifting the offset
    // to the image centre keeps the visual centre of the stamp fixed when we
    // rotate.
    image.offset({ x: width / 2, y: height / 2 });
    image.x(image.x() + width / 2);
    image.y(image.y() + height / 2);
    image.rotation(rotationDegrees);
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
      const dims = getStampImageDimensions(img, fieldWidth, fieldHeight);
      image.setAttrs({ image: img, ...dims });
      applyRotationAroundCentre(image, dims.width, dims.height);

      image.cache({
        pixelRatio: STAMP_IMAGE_CACHE_PIXEL_RATIO * (window.devicePixelRatio || 1),
      });
    };

    img.src = stampImageAsBase64;

    return image;
  }

  if (!SkiaImage) {
    throw new Error('Skia image not found');
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const img = new SkiaImage(stampImageAsBase64) as unknown as HTMLImageElement;
  const dims = getStampImageDimensions(img, fieldWidth, fieldHeight);

  const image = new Konva.Image({
    image: img,
    ...dims,
    listening: false,
  });

  applyRotationAroundCentre(image, dims.width, dims.height);

  return image;
};

const createStampPlaceholder = (fieldWidth: number, fieldHeight: number, translations: Record<string, string> | null) => {
  return new Konva.Text({
    x: 0,
    y: 0,
    width: fieldWidth,
    height: fieldHeight,
    align: 'center',
    verticalAlign: 'middle',
    text: translations?.STAMP ?? 'Stamp',
    fontSize: 12,
    fontFamily: 'sans-serif',
    listening: false,
  });
};

/**
 * Render a STAMP field into the Konva stage.
 *
 * When the field is unsigned the placeholder text ("Stamp") is shown. Once the
 * recipient has uploaded an image it is rendered into the field bounds with
 * the intrinsic aspect ratio preserved and the persisted rotation applied.
 */
export const renderStampFieldElement = (field: FieldToRender, options: RenderFieldElementOptions) => {
  const { mode = 'edit', pageLayer, pageWidth, pageHeight, color, translations } = options;

  const { fieldWidth, fieldHeight } = calculateFieldPosition(field, pageWidth, pageHeight);

  const isFirstRender = !pageLayer.findOne(`#${field.renderId}`);
  const fieldGroup = upsertFieldGroup(field, options);
  fieldGroup.removeChildren();
  fieldGroup.off('transform');

  if (isFirstRender) {
    pageLayer.add(fieldGroup);
  }

  const fieldRect = upsertFieldRect(field, options);
  fieldGroup.add(fieldRect);

  const stampMeta = (field.fieldMeta && field.fieldMeta.type === 'stamp' ? field.fieldMeta : undefined) as
    | TStampFieldMeta
    | undefined;
  const rotationDegrees = stampMeta?.rotation ?? 0;

  // If we have a base64 image, render it; otherwise render the placeholder label.
  if (field.inserted && field.signature?.signatureImageAsBase64) {
    const imageNode = createStampImage(
      field.signature.signatureImageAsBase64,
      fieldWidth,
      fieldHeight,
      rotationDegrees,
    );
    fieldGroup.add(imageNode);
  } else {
    fieldGroup.add(createStampPlaceholder(fieldWidth, fieldHeight, translations));
  }

  if (mode === 'export') {
    // Hide the background/border chrome for the sealed PDF output.
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
