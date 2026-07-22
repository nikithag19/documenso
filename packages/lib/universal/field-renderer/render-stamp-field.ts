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

const getImageDimensions = (img: HTMLImageElement, fieldWidth: number, fieldHeight: number) => {
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
 * The pixel ratio used when caching the stamp image as an offscreen bitmap.
 */
const STAMP_IMAGE_CACHE_PIXEL_RATIO = 2;

const createStampImage = (
  stampImageAsBase64: string,
  fieldWidth: number,
  fieldHeight: number,
  rotation: number,
): Konva.Group => {
  const group = new Konva.Group({
    width: fieldWidth,
    height: fieldHeight,
    listening: false,
  });

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
      const dims = getImageDimensions(img, fieldWidth, fieldHeight);

      image.setAttrs({
        image: img,
        ...dims,
      });

      if (rotation !== 0) {
        image.rotation(rotation);
        image.offsetX(dims.width / 2);
        image.offsetY(dims.height / 2);
        image.x(dims.x + dims.width / 2);
        image.y(dims.y + dims.height / 2);
      }

      image.cache({
        pixelRatio: STAMP_IMAGE_CACHE_PIXEL_RATIO * (window.devicePixelRatio || 1),
      });
    };

    img.src = stampImageAsBase64;

    group.add(image);
    return group;
  }

  // Node.js with skia-canvas
  if (!SkiaImage) {
    throw new Error('Skia image not found');
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const img = new SkiaImage(stampImageAsBase64) as unknown as HTMLImageElement;
  const dims = getImageDimensions(img, fieldWidth, fieldHeight);

  const image = new Konva.Image({
    image: img,
    ...dims,
    listening: false,
  });

  if (rotation !== 0) {
    image.rotation(rotation);
    image.offsetX(dims.width / 2);
    image.offsetY(dims.height / 2);
    image.x(dims.x + dims.width / 2);
    image.y(dims.y + dims.height / 2);
  }

  group.add(image);
  return group;
};

type StampFieldContent =
  | {
      node: Konva.Text;
      isStampImage: false;
    }
  | {
      node: Konva.Group;
      isStampImage: true;
    };

const createFieldStamp = (field: FieldToRender, options: RenderFieldElementOptions): StampFieldContent => {
  const { pageWidth, pageHeight, mode = 'edit', translations } = options;

  const { fieldWidth, fieldHeight } = calculateFieldPosition(field, pageWidth, pageHeight);
  const fieldMeta = field.fieldMeta as TStampFieldMeta | undefined;
  const rotation = fieldMeta?.rotation ?? 0;

  const fieldTypeName = translations?.[field.type] || field.type;

  const signature = field.signature;

  // If signed with an image, render the stamp image
  if (field.inserted && signature?.signatureImageAsBase64) {
    return {
      node: createStampImage(signature.signatureImageAsBase64, fieldWidth, fieldHeight, rotation),
      isStampImage: true,
    };
  }

  // Edit mode with stamp image in metadata (preview)
  if (mode === 'edit' && fieldMeta?.stampImageAsBase64) {
    return {
      node: createStampImage(fieldMeta.stampImageAsBase64, fieldWidth, fieldHeight, rotation),
      isStampImage: true,
    };
  }

  // Otherwise, show placeholder text
  const fieldText = new Konva.Text({
    id: `${field.renderId}-text`,
    name: 'field-text',
    text: fieldTypeName,
    fontSize: 14,
    align: 'center',
    verticalAlign: 'middle',
    width: fieldWidth,
    height: fieldHeight,
    listening: false,
  });

  return { node: fieldText, isStampImage: false };
};

export const renderStampFieldElement = (field: FieldToRender, options: RenderFieldElementOptions) => {
  const { mode = 'edit', pageLayer, pageWidth, pageHeight, color } = options;

  const isFirstRender = !pageLayer.findOne(`#${field.renderId}`);

  const fieldGroup = upsertFieldGroup(field, options);

  // Clear previous children and listeners to re-render fresh.
  fieldGroup.removeChildren();
  fieldGroup.off('transform');

  if (isFirstRender) {
    pageLayer.add(fieldGroup);
  }

  const fieldRect = upsertFieldRect(field, options);
  const { node: fieldContent, isStampImage } = createFieldStamp(field, options);

  fieldGroup.add(fieldRect);
  fieldGroup.add(fieldContent);

  fieldGroup.on('transform', () => {
    const groupScaleX = fieldGroup.scaleX();
    const groupScaleY = fieldGroup.scaleY();

    fieldContent.scaleX(1 / groupScaleX);
    fieldContent.scaleY(1 / groupScaleY);

    const rectWidth = fieldRect.width() * groupScaleX;
    const rectHeight = fieldRect.height() * groupScaleY;

    if (!isStampImage) {
      (fieldContent as Konva.Text).x(0);
      (fieldContent as Konva.Text).y(0);
      (fieldContent as Konva.Text).wrap('word');
    }

    fieldContent.width(rectWidth);
    fieldContent.height(rectHeight);

    fieldGroup.getLayer()?.batchDraw();
  });

  fieldGroup.on('transformend', () => {
    fieldContent.scaleX(1);
    fieldContent.scaleY(1);

    const rectWidth = fieldRect.width();
    const rectHeight = fieldRect.height();

    fieldContent.width(rectWidth);
    fieldContent.height(rectHeight);

    fieldGroup.getLayer()?.batchDraw();
  });

  // Handle export mode.
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
