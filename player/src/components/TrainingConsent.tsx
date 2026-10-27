export function TrainingConsent({ checked, onChange, disabled = false }: { checked: boolean; onChange(value: boolean): void; disabled?: boolean }) {
  return <label className="training-consent"><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span>Allow Meta to use this paper’s text, images, prompts and responses for model training for this request.</span>
  </label>;
}
