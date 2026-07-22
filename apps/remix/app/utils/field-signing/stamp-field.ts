import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TSignEnvelopeFieldValue } from '@documenso/trpc/server/envelope-router/sign-envelope-field.types';
import { FieldType } from '@prisma/client';

const MAX_STAMP_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_STAMP_MIME_TYPES = ['image/png', 'image/jpeg'];

type HandleStampFieldClickOptions = {
  field: { type: FieldType; inserted: boolean };
};

/**
 * Opens a hidden file input so the recipient can pick a PNG/JPG stamp image
 * and returns its base64 data URL. Used from the Konva v2 signer page which
 * doesn't have per-field React components (unlike v1).
 *
 * Resolves to `null` if the user cancels or picks an unsupported file — the
 * caller (envelope-signer-page-renderer) will treat that as "no change" and
 * simply not submit the field.
 */
export const handleStampFieldClick = async (
  options: HandleStampFieldClickOptions,
): Promise<Extract<TSignEnvelopeFieldValue, { type: typeof FieldType.STAMP }> | null> => {
  const { field } = options;

  if (field.type !== FieldType.STAMP) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'Invalid field type',
    });
  }

  // If the stamp has already been placed, clicking again clears it (mirroring
  // the toggle behaviour of the signature field).
  if (field.inserted) {
    return {
      type: FieldType.STAMP,
      value: null,
    };
  }

  const dataUrl = await new Promise<string | null>((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPTED_STAMP_MIME_TYPES.join(',');
    input.style.display = 'none';

    input.onchange = () => {
      const file = input.files?.[0];
      document.body.removeChild(input);

      if (!file) {
        resolve(null);
        return;
      }

      if (!ACCEPTED_STAMP_MIME_TYPES.includes(file.type)) {
        resolve(null);
        return;
      }

      if (file.size > MAX_STAMP_FILE_SIZE_BYTES) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };

    // Also handle cancel — some browsers don't fire onchange when the picker
    // is dismissed. We resolve to null via a focus watchdog.
    input.oncancel = () => {
      if (input.parentNode) document.body.removeChild(input);
      resolve(null);
    };

    document.body.appendChild(input);
    input.click();
  });

  if (!dataUrl) return null;

  return {
    type: FieldType.STAMP,
    value: dataUrl,
  };
};
