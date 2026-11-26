"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { quarantineInventoryLot } from "../pembelian/actions";
import styles from "./quarantine-evidence-form.module.css";

export default function QuarantineEvidenceForm({ lotId, maxWeight }: { lotId: string; maxWeight: number }) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [weight, setWeight] = useState("");
  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  );

  useEffect(() => () => previews.forEach((item) => URL.revokeObjectURL(item.url)), [previews]);

  function syncFiles(nextFiles: File[]) {
    setFiles(nextFiles);
    if (uploadRef.current) {
      const transfer = new DataTransfer();
      nextFiles.forEach((file) => transfer.items.add(file));
      uploadRef.current.files = transfer.files;
    }
  }

  function addFiles(event: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(event.currentTarget.files ?? []);
    if (incoming.length) {
      const combined = [...files, ...incoming].filter(
        (file, index, all) => all.findIndex((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified) === index,
      );
      syncFiles(combined);
    }
    event.currentTarget.value = "";
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!files.length) {
      setError("Tambahkan minimal satu foto bukti karantina.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    form.set("lotId", lotId);
    const result = await quarantineInventoryLot(form);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    window.location.reload();
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <div className={styles.heading}>
        <span className={styles.headingIcon} aria-hidden="true">📷</span>
        <div>
          <strong>Masukkan Barang ke Karantina</strong>
          <p>Catat jumlah barang bermasalah dan lampirkan foto sebagai bukti pemeriksaan.</p>
        </div>
      </div>

      <div className={styles.fields}>
        <label className={styles.field}>
          <span>Berat yang dikarantina <b>(kg)</b></span>
          <input
            name="weightKg"
            type="number"
            min="0.001"
            max={maxWeight}
            step="0.001"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            placeholder={`Maks. ${maxWeight.toLocaleString("id-ID")} kg`}
            required
          />
          <small>Stok normal tersedia: {maxWeight.toLocaleString("id-ID")} kg</small>
        </label>
        <label className={styles.field}>
          <span>Alasan karantina</span>
          <textarea name="reason" minLength={3} maxLength={1000} rows={3} placeholder="Contoh: kualitas tidak sesuai, tercampur material lain..." required />
        </label>
      </div>

      <div className={styles.uploadPanel}>
        <div className={styles.uploadHeader}>
          <div>
            <strong>Foto bukti barang</strong>
            <span className={styles.required}>Wajib</span>
          </div>
          <small>JPG, PNG, WEBP · maks. 10 MB/foto</small>
        </div>
        <p className={styles.uploadHint}>Ambil foto kondisi barang atau pilih foto yang sudah tersimpan di perangkat.</p>
        <div className={styles.actions}>
          <label className={styles.cameraButton}>
            <span aria-hidden="true">📷</span> Ambil Foto
            <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple onChange={addFiles} aria-label="Ambil foto bukti karantina" />
          </label>
          <label className={styles.galleryButton}>
            <span aria-hidden="true">▧</span> Pilih File
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addFiles} aria-label="Pilih foto dari galeri atau komputer" />
          </label>
        </div>
        <input ref={uploadRef} name="files" type="file" accept="image/jpeg,image/png,image/webp" multiple required={files.length === 0} className={styles.hiddenInput} tabIndex={-1} aria-hidden="true" />

        {previews.length > 0 ? (
          <div className={styles.previewArea}>
            <div className={styles.previewTitle}>{previews.length} foto dipilih <span>· Periksa sebelum disimpan</span></div>
            <div className={styles.previewGrid}>
              {previews.map(({ file, url }, index) => (
                <figure className={styles.previewCard} key={file.name + file.lastModified + index}>
                  <img src={url} alt={file.name} />
                  <figcaption>
                    <span title={file.name}>{file.name}</span>
                    <small>{(file.size / (1024 * 1024)).toFixed(2)} MB</small>
                  </figcaption>
                  <button type="button" onClick={() => syncFiles(files.filter((_, fileIndex) => fileIndex !== index))} aria-label={`Hapus ${file.name}`}>×</button>
                </figure>
              ))}
            </div>
          </div>
        ) : (
          <div className={styles.emptyUpload}>
            <span aria-hidden="true">▧</span>
            <strong>Belum ada foto dipilih</strong>
            <small>Foto yang dipilih akan tampil di sini.</small>
          </div>
        )}
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.footer}>
        <span>{files.length ? `${files.length} foto siap diunggah` : "Minimal 1 foto wajib dilampirkan"}</span>
        <button type="submit" disabled={busy || !files.length}>
          {busy ? "Menyimpan..." : "Simpan Karantina"}
        </button>
      </div>
    </form>
  );
}
