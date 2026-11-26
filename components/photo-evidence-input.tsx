"use client";

import { useEffect, useMemo, useState } from "react";

type Props = {
  name: string;
  label: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  capture?: boolean;
  onFilesChange?: () => void;
};

export default function PhotoEvidenceInput({ name, label, accept = "image/jpeg,image/png,image/webp", multiple = true, required = false, capture = true, onFilesChange }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.filter(file => file.type.startsWith("image/")).map(file => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);
  return <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
    <label style={{ display: "grid", gap: 6 }}>
      <strong>{label}</strong>
      <small>Ambil foto dengan kamera belakang atau pilih dari galeri/file. Maks. 10 MB per foto.</small>
      <input name={name} type="file" accept={accept} multiple={multiple} required={required} capture={capture ? "environment" : undefined}
        onChange={event => { setFiles(Array.from(event.currentTarget.files ?? [])); onFilesChange?.(); }} />
    </label>
    {!!previews.length && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {previews.map(({ file, url }) => <figure key={file.name + file.lastModified} style={{ margin: 0, width: 104 }}>
        <img src={url} alt={file.name} style={{ width: 104, height: 88, objectFit: "cover", borderRadius: 8, border: "1px solid #aaa" }} />
        <figcaption style={{ fontSize: 11, overflowWrap: "anywhere" }}>{file.name}</figcaption>
      </figure>)}
    </div>}
  </div>;
}
