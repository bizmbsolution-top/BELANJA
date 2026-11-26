"use client";

import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from "react";

type Props = {
  name: string;
  label: string;
  accept?: string;
  cameraAccept?: string;
  multiple?: boolean;
  required?: boolean;
  capture?: boolean;
};

const pickerLabelStyle: CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  minHeight: 42,
  padding: "9px 14px",
  border: "1px solid var(--border, #cbd5e1)",
  borderRadius: 9,
  background: "var(--card, #fff)",
  color: "var(--foreground, #0f172a)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  overflow: "hidden",
};

const overlayInputStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  opacity: 0,
  cursor: "pointer",
};

export default function PhotoEvidenceInput({
  name,
  label,
  accept = "image/jpeg,image/png,image/webp",
  cameraAccept = accept,
  multiple = true,
  required = false,
  capture = true,
}: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(
    () =>
      files
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );

  useEffect(
    () => () => previews.forEach((item) => URL.revokeObjectURL(item.url)),
    [previews],
  );

  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    if (selected.length) setFiles((current) => [...current, ...selected]);
    // Keep the native input value intact: the server reads these files from FormData.
  };

  return (
    <div style={{ display: "grid", gap: 9, minWidth: 0 }}>
      <strong>{label}</strong>
      <small style={{ color: "var(--muted-foreground, #64748b)" }}>
        Pilih foto atau upload file. Maks. 10 MB per foto.
      </small>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {capture && (
          <label style={pickerLabelStyle}>
            <span aria-hidden="true">🖼️</span>
            <span>Foto</span>
            <input
              name={name}
              type="file"
              accept={cameraAccept}
              multiple={multiple}
              required={required && files.length === 0}
              capture="environment"
              onChange={addFiles}
              style={overlayInputStyle}
              aria-label={`Pilih foto untuk ${label}`}
            />
          </label>
        )}

        <label style={pickerLabelStyle}>
          <span aria-hidden="true">↥</span>
          <span>Upload File</span>
          <input
            name={name}
            type="file"
            accept={accept}
            multiple={multiple}
            required={required && files.length === 0}
            onChange={addFiles}
            style={overlayInputStyle}
            aria-label={`Upload file untuk ${label}`}
          />
        </label>
      </div>

      {!!previews.length && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {previews.map(({ file, url }, index) => (
            <figure
              key={file.name + file.lastModified + index}
              style={{ margin: 0, width: 104 }}
            >
              <img
                src={url}
                alt={file.name}
                style={{
                  width: 104,
                  height: 88,
                  objectFit: "cover",
                  borderRadius: 8,
                  border: "1px solid var(--border, #aaa)",
                }}
              />
              <figcaption
                style={{
                  fontSize: 11,
                  overflowWrap: "anywhere",
                  color: "var(--muted-foreground, #64748b)",
                }}
              >
                {file.name}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
