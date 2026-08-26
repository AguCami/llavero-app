import { useRef, useState } from 'react';

interface Props {
  onFile(file: File): void;
  onSample(): void;
  fileName: string | null;
}

export function DropZone({ onFile, onSample, fileName }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`dropzone${dragging ? ' is-dragging' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".svg,image/svg+xml"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = '';
        }}
      />
      <p className="dropzone__title">{fileName ?? 'Arrastrá tu SVG acá'}</p>
      <p className="dropzone__hint">Vectorial (.svg) con formas rellenas</p>
      <div className="dropzone__actions">
        <button type="button" className="btn btn--primary" onClick={() => inputRef.current?.click()}>
          Elegir archivo
        </button>
        <button type="button" className="btn" onClick={onSample}>
          Probar ejemplo
        </button>
      </div>
    </div>
  );
}
