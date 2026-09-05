import { useState } from 'react';

interface Props {
  onSubmit: (pin: string) => void;
  busy?: boolean;
  error?: string | null;
  label?: string;
}

/** Numeric PIN entry that works with a mouse, a keyboard, and (later) a TV remote. */
export function PinPad({ onSubmit, busy = false, error = null, label = 'Enter your PIN' }: Props) {
  const [pin, setPin] = useState('');
  const push = (d: string) => {
    if (pin.length >= 6) return;
    const next = pin + d;
    setPin(next);
  };
  const submit = () => {
    if (pin.length >= 4) onSubmit(pin);
  };
  return (
    <div className="pinpad" onKeyDown={(e) => e.key === 'Enter' && submit()}>
      <label className="pinpad-label" htmlFor="pin">
        {label}
      </label>
      <input
        id="pin"
        className="pinpad-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
        autoFocus
      />
      <div className="pinpad-grid">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'].map((k) => (
          <button
            key={k}
            type="button"
            className="pinpad-key"
            disabled={busy}
            onClick={() => (k === '⌫' ? setPin(pin.slice(0, -1)) : k === 'OK' ? submit() : push(k))}
          >
            {k}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
