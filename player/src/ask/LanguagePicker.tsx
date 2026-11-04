import { RESPONSE_LANGUAGES } from '../../../shared/languages';
import { ChoicePicker } from '../components/ChoicePicker';

const choices = [
  { value: '', label: 'Document language', detail: 'Match this document automatically' },
  ...Object.entries(RESPONSE_LANGUAGES).map(([value, label]) => ({ value, label })),
];

export function LanguagePicker({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange(value: string): void;
}) {
  const label = choices.find((choice) => choice.value === value)?.label ?? 'Auto';
  return (
    <div className="ask-language-control">
      <ChoicePicker
        value={value}
        disabled={disabled}
        onChange={onChange}
        options={choices}
        className="ask-language"
        label={`Answer language: ${value ? label : 'Auto, match document'}`}
        triggerContent={
          <>
            <svg
              viewBox="0 0 20 20"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              aria-hidden="true"
            >
              <circle cx="10" cy="10" r="7" />
              <path d="M3 10h14M10 3c4 4 4 10 0 14C6 13 6 7 10 3Z" />
            </svg>
            <span>{value ? label : 'Auto'}</span>
            <svg
              viewBox="0 0 16 16"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </>
        }
      />
    </div>
  );
}
