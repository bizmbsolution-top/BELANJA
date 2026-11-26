"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";

type Props = {
  name: string;
  label: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  capture?: boolean;
};

export default function PhotoEvidenceInput({ name, label, accept = "image/jpeg,image/png,image/webp", multiple = true, required = false, capture = true }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const previews = useMemo(() => files.filter(file => file.type.startsWith("image/")).map(file => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(item => URL.revokeObjectURL(item.url)), [previews]);
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    if (selected.length) setFiles(current => [...current, ...selected]);
  };
  return <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
    <strong>{label}</strong>
    <small>Ambil foto langsung dengan kamera belakang, atau pilih foto/file dari galeri. Maks. 10 MB per foto.</small>
    {capture && <label style={{ display: "grid", gap: 4 }}>
      <span>📷 Ambil dengan Kamera</span>
      <input name={name} type="file" accept={accept} multiple={multiple} required={required && files.length===0} capture="environment" onChange={addFiles} />
    </label>}
    <label style={{ display: "grid", gap: 4 }}>
      <span>🖼️ Pilih dari Galeri / File</span>
      <input name={name} type="file" accept={accept} multiple={multiple} required={required && files.length===0} onChange={addFiles} />
    </label>
    {!!previews.length && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {previews.map(({ file, url }, index) => <figure key={file.name + file.lastModified + index} style={{ margin: 0, width: 104 }}>
        <img src={url} alt={file.name} style={{ width: 104, height: 88, objectFit: "cover", borderRadius: 8, border: "1px solid #aaa" }} />
        <figcaption style={{ fontSize: 11, overflowWrap: "anywhere" }}>{file.name}</figcaption>
      </figure>)}
    </div>}
  </div>;
}
