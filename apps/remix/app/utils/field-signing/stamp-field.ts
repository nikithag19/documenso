import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TFieldStamp } from '@documenso/lib/types/field';
import type { TSignEnvelopeFieldValue } from '@documenso/trpc/server/envelope-router/sign-envelope-field.types';
import { FieldType } from '@prisma/client';

const ACCEPTED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg'];
const MAX_STAMP_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Prompt the user for a stamp image and return the value payload for the sign
 * envelope field mutation.
 *
 * This mirrors the SignFieldSignatureDialog.call pattern used by the signature
 * field, but is intentionally minimal here — the envelope v2 canvas signer just
 * needs a value to submit; the rich preview / rotation UI lives in
 * `document-signing-stamp-field.tsx` for the v1 signing page.
 */
const promptForStampImage = async (): Promise<string | null> =>
  new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg';
    input.style.display = 'none';

    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();

      if (!file) {
        resolve(null);
        return;
      }

      if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
        alert('Unsupported image type. Please upload a PNG or JPG image.');
        resolve(null);
        return;
      }

      if (file.size > MAX_STAMP_UPLOAD_BYTES) {
        alert('Image is too large. Please upload an image smaller than 5MB.');
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : null;
        resolve(result);
      };
      reader.readAsDataURL(file);
    };

    input.oncancel = () => {
      input.remove();
      resolve(null);
    };

    document.body.appendChild(input);
    input.click();
  });

type HandleStampFieldClickOptions = {
  field: TFieldStamp;
};

export const handleStampFieldClick = async (
  options: HandleStampFieldClickOptions,
): Promise<Extract<TSignEnvelopeFieldValue, { type: typeof FieldType.STAMP }> | null> => {
  const { field } = options;

  if (field.type !== FieldType.STAMP) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Invalid field type',
    });
  }

  // Clicking an already-inserted stamp field clears it (matches SIGNATURE behaviour).
  if (field.inserted) {
    return {
      type: FieldType.STAMP,
      value: null,
    };
  }

  const stampValue = await promptForStampImage();

  if (!stampValue) {
    return null;
  }

  return {
    type: FieldType.STAMP,
    value: stampValue,
  };
};
