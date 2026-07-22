import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import type { TFieldStamp } from '@documenso/lib/types/field';
import type { TStampFieldMeta } from '@documenso/lib/types/field-meta';
import type { TSignEnvelopeFieldValue } from '@documenso/trpc/server/envelope-router/sign-envelope-field.types';
import { FieldType } from '@prisma/client';

import { SignFieldStampDialog } from '~/components/dialogs/sign-field-stamp-dialog';

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

  if (field.inserted) {
    return {
      type: FieldType.STAMP,
      value: null,
    };
  }

  const fieldMeta = field.fieldMeta as TStampFieldMeta | undefined;

  const result = await SignFieldStampDialog.call({
    initialStampImage: fieldMeta?.stampImageAsBase64,
    initialRotation: fieldMeta?.rotation ?? 0,
  });

  if (!result) {
    return null;
  }

  return {
    type: FieldType.STAMP,
    value: result.stampImageAsBase64,
  };
};
