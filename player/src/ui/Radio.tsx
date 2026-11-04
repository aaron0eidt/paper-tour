import { Radio } from '@animate-ui/react/primitives/base-ui/radio';
import type { ComponentProps } from 'react';
export { RadioGroup as AnimatedRadioGroup } from '@animate-ui/react/primitives/base-ui/radio-group';

/** Shared radio appearance; the primitives own keyboard navigation and reduced motion. */
export function AnimatedRadio(props: ComponentProps<typeof Radio.Root>) {
  return (
    <Radio.Root {...props} className={['ui-radio', props.className].filter(Boolean).join(' ')}>
      <Radio.Indicator className="ui-radio-indicator">
        <span className="ui-radio-dot" />
      </Radio.Indicator>
    </Radio.Root>
  );
}
