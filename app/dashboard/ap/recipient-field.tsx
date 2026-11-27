"use client";

import { useState } from "react";
import { createSupplier } from "@/app/dashboard/supplier/actions";
import styles from "./recipient-field.module.css";

export type ApSupplierOption = {
  id: string;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
};

type Props = {
  initialSuppliers: ApSupplierOption[];
  value: string;
  onChange: (supplierId: string) => void;
};

export default function ApRecipientField({ initialSuppliers, value, onChange }: Props) {
  const [suppliers, setSuppliers] = useState(initialSuppliers.filter((item) => item.is_active));
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");

  async function saveSupplier(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const result = await createSupplier({ name, contactPerson, phone, email, address, notes });
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const selectedSupplier: ApSupplierOption = result.supplier ?? {
      id: result.id!,
      code: "BARU",
      name: name.trim(),
      contact_person: contactPerson.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      is_active: true,
    };
    setSuppliers((current) => [selectedSupplier, ...current.filter((item) => item.id !== selectedSupplier.id)]);
    onChange(selectedSupplier.id);
    setQuickAddOpen(false);
    setName("");
    setContactPerson("");
    setPhone("");
    setEmail("");
    setAddress("");
    setNotes("");
  }

  return (
    <div className={styles.field}>
      <label htmlFor="ap-recipient">Dibayarkan Kepada <b>*</b></label>
      <div className={styles.selectRow}>
        <select id="ap-recipient" required value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Pilih Supplier / penerima</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.code}</option>
          ))}
        </select>
        <button type="button" className={styles.addButton} onClick={() => { setError(""); setQuickAddOpen((open) => !open); }}>
          + Tambah Supplier
        </button>
      </div>
      <small>Gunakan Master Supplier sebagai penerima pembayaran. Project tetap diisi terpisah.</small>
      {quickAddOpen && (
        <section className={styles.quickAdd} aria-label="Tambah Supplier cepat">
          <h3>Tambah Supplier</h3>
          <form onSubmit={saveSupplier}>
            <label>Nama Supplier *<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Nama Kontak<input maxLength={120} value={contactPerson} onChange={(event) => setContactPerson(event.target.value)} /></label>
            <div className={styles.twoColumns}>
              <label>Telepon<input maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
              <label>Email<input type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            </div>
            <label>Alamat<textarea rows={2} maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
            <label>Catatan<textarea rows={2} maxLength={1000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.cancelButton} disabled={saving} onClick={() => setQuickAddOpen(false)}>Batal</button>
              <button type="submit" className={styles.saveButton} disabled={saving || !name.trim()}>{saving ? "Menyimpan..." : "Simpan & Pilih Supplier"}</button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
