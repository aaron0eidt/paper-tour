import { Slider } from '@animate-ui/react/primitives/base-ui/slider';

/** Single-value control shared by settings, audio and live mathematical visuals. */
export function AnimatedSlider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  valueText,
  disabled,
  id,
  describedBy,
}: {
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  valueText?: string;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
}) {
  return (
    <Slider.Root
      className="ui-slider"
      id={id}
      value={value}
      onValueChange={onChange}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <Slider.Control className="ui-slider-control">
        <Slider.Track className="ui-slider-track">
          <Slider.Indicator className="ui-slider-indicator" />
          <Slider.Thumb
            className="ui-slider-thumb"
            aria-label={label}
            aria-valuetext={valueText}
            aria-describedby={describedBy}
          />
        </Slider.Track>
      </Slider.Control>
    </Slider.Root>
  );
}
