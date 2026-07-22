import {
  FIELD_STAMP_META_DEFAULT_VALUES,
  type TStampFieldMeta,
  ZStampFieldMeta,
} from '@documenso/lib/types/field-meta';
import { Form, FormControl, FormField, FormItem, FormLabel } from '@documenso/ui/primitives/form/form';
import { Input } from '@documenso/ui/primitives/input';
import { zodResolver } from '@hookform/resolvers/zod';
import { Trans } from '@lingui/react/macro';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

const ZStampFieldFormSchema = ZStampFieldMeta.pick({
  rotation: true,
});

type TStampFieldFormSchema = z.infer<typeof ZStampFieldFormSchema>;

type EditorFieldStampFormProps = {
  value: z.input<typeof ZStampFieldMeta> | undefined;
  onValueChange: (value: TStampFieldMeta) => void;
};

export const EditorFieldStampForm = ({
  value = {
    type: 'stamp',
  },
  onValueChange,
}: EditorFieldStampFormProps) => {
  const form = useForm<TStampFieldFormSchema>({
    resolver: zodResolver(ZStampFieldFormSchema),
    mode: 'onChange',
    defaultValues: {
      rotation: value.rotation ?? FIELD_STAMP_META_DEFAULT_VALUES.rotation,
    },
  });

  const { control } = form;

  const formValues = useWatch({
    control,
  });

  useEffect(() => {
    const validatedFormValues = ZStampFieldFormSchema.safeParse(formValues);

    if (validatedFormValues.success) {
      onValueChange({
        type: 'stamp',
        ...validatedFormValues.data,
      });
    }
  }, [formValues]);

  return (
    <Form {...form}>
      <form>
        <fieldset className="flex flex-col gap-2">
          <p className="mt-2 text-muted-foreground text-xs">
            <Trans>Upload a stamp image when signing this field. Supported formats: PNG, JPG.</Trans>
          </p>

          <FormField
            control={control}
            name="rotation"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <Trans>Default Rotation (degrees)</Trans>
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={360}
                    placeholder="0"
                    {...field}
                    onChange={(e) => field.onChange(Number(e.target.value))}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </fieldset>
      </form>
    </Form>
  );
};
