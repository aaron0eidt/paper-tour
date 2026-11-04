import { useRef, type ReactNode } from 'react';
import { Select } from '@animate-ui/react/primitives/base-ui/select';
import { Combobox } from '@animate-ui/react/primitives/base-ui/combobox';
import { UI_EXIT, UI_SPRING } from '../ui/motion';
import { playInterfaceSound } from '../ui/sound';
import './choicePicker.css';

export interface ChoiceOption<T extends string = string> {
  value: T;
  label: string;
  badge?: string;
  detail?: string;
  group?: string;
  groupCode?: string;
  searchText?: string;
  disabled?: boolean;
}
interface Props<T extends string> {
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange(value: T): void;
  label: string;
  disabled?: boolean;
  searchable?: boolean;
  className?: string;
  triggerContent?: ReactNode;
}
const Check = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    aria-hidden="true"
  >
    <path d="m3 8 3 3 7-7" />
  </svg>
);
const Chevron = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <path d="m4 6 4 4 4-4" />
  </svg>
);
function Selected({ option, value }: { option?: ChoiceOption; value: string }) {
  return (
    <>
      <span className="choice-selected">
        <span className="choice-selected-label">{option?.label ?? value}</span>
        {option?.badge && <span className="choice-badge">{option.badge}</span>}
      </span>
      <Chevron />
    </>
  );
}
function OptionText({ option }: { option: ChoiceOption }) {
  return (
    <span className="choice-text">
      <span className="choice-option-title">
        <span>{option.label}</span>
        {option.badge && <span className="choice-badge">{option.badge}</span>}
      </span>
      {option.detail && <small>{option.detail}</small>}
    </span>
  );
}
function GroupLabel({ option }: { option: ChoiceOption }) {
  return (
    <>
      {option.groupCode && <span className="choice-language-code">{option.groupCode}</span>}
      {option.group}
    </>
  );
}

/** Base UI owns focus, typeahead and collision handling; Animate UI owns presence. */
export function ChoicePicker<T extends string>(props: Props<T>) {
  return props.searchable ? <SearchableChoice {...props} /> : <SimpleChoice {...props} />;
}
function SimpleChoice<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  className = '',
  triggerContent,
}: Props<T>) {
  const selected = options.find((option) => option.value === value);
  return (
    <Select.Root
      value={value}
      items={options}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null && next !== value) {
          onChange(next);
          playInterfaceSound('select');
        }
      }}
      onOpenChange={(open) => {
        if (open) playInterfaceSound('open');
      }}
    >
      <Select.Trigger className={`choice-trigger ${className}`} aria-label={label}>
        {triggerContent ?? <Selected option={selected} value={value} />}
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="ui-choice-positioner"
          sideOffset={8}
          collisionPadding={12}
          alignItemWithTrigger={false}
        >
          <Select.Popup className="choice-popup" transition={UI_SPRING} exitTransition={UI_EXIT}>
            <Select.List className="choice-list" aria-label={label}>
              {options.map((option, index) => (
                <div key={option.value}>
                  {option.group && option.group !== options[index - 1]?.group && (
                    <div className="choice-group">
                      <GroupLabel option={option} />
                    </div>
                  )}
                  <Select.Item
                    disabled={option.disabled}
                    value={option.value}
                    className="choice-option"
                    label={option.label}
                  >
                    <Select.ItemText>
                      <OptionText option={option} />
                    </Select.ItemText>
                    <Select.ItemIndicator className="choice-check">
                      <Check />
                    </Select.ItemIndicator>
                  </Select.Item>
                </div>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
function SearchableChoice<T extends string>({ value, options, onChange, label, disabled }: Props<T>) {
  const search = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <Combobox.Root<ChoiceOption<T>>
      items={options}
      value={selected}
      disabled={disabled}
      autoHighlight
      isItemEqualToValue={(item, current) => item.value === current.value}
      filter={(option, query) =>
        [option.label, option.badge, option.detail, option.group, option.searchText]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())
      }
      onValueChange={(next) => {
        if (next && next.value !== value) {
          onChange(next.value);
          playInterfaceSound('select');
        }
      }}
      onOpenChange={(open) => {
        if (open) playInterfaceSound('open');
      }}
    >
      <Combobox.Trigger className="choice-trigger" aria-label={label}>
        <Selected option={selected ?? undefined} value={value} />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner className="ui-choice-positioner" sideOffset={8} collisionPadding={12}>
          <Combobox.Popup
            className="choice-popup searchable"
            initialFocus={search}
            transition={UI_SPRING}
            exitTransition={UI_EXIT}
          >
            <Combobox.Input
              ref={search}
              className="choice-search"
              type="search"
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Search name, language or country…"
            />
            <Combobox.Empty className="choice-empty">No matches. Try a different search.</Combobox.Empty>
            <Combobox.List className="choice-list" aria-label={label}>
              {(option: ChoiceOption<T>) => (
                <Combobox.Item
                  key={option.value}
                  value={option}
                  disabled={option.disabled}
                  className="choice-option"
                  aria-label={[option.group, option.label, option.badge, option.detail]
                    .filter(Boolean)
                    .join(', ')}
                >
                  <OptionText option={option} />
                  <Combobox.ItemIndicator className="choice-check">
                    <Check />
                  </Combobox.ItemIndicator>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
