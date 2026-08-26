import type { ReactNode } from 'react';

export function Panel({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel">
      <header className="panel__head">
        <h2>{title}</h2>
        {aside}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  hint?: string;
  onChange(value: number): void;
}

export function NumberField({ label, value, min, max, step, unit, disabled, hint, onChange }: NumberFieldProps) {
  const clamp = (raw: number) => Math.min(max, Math.max(min, raw));
  return (
    <label className={`field${disabled ? ' field--off' : ''}`}>
      <span className="field__label">
        {label}
        <input
          className="field__number"
          type="number"
          value={Number(value.toFixed(2))}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (!Number.isNaN(next)) onChange(clamp(next));
          }}
        />
        {unit ? <span className="field__unit">{unit}</span> : null}
      </span>
      <input
        className="field__range"
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
      />
      {hint ? <small className="field__hint">{hint}</small> : null}
    </label>
  );
}

interface SegmentedProps<T extends string> {
  label?: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange(value: T): void;
}

export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="field">
      {label ? <span className="field__label">{label}</span> : null}
      <div className="segmented" role="group">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.title}
            className={`segmented__item${option.value === value ? ' is-active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle__track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <label className="field field--inline">
      <span className="field__label">{label}</span>
      <input className="field__color" type="color" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
