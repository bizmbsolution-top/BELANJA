"use client";

import { type FormEvent, useMemo, useState } from "react";
import styles from "./user-access.module.css";
import { resetUserPassword } from "./actions";

type ScopeMode = "all" | "selected";
type ScopeKey = "project" | "department" | "warehouse";

type UserRecord = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: "Aktif" | "Nonaktif";
};

const emptySettings = {
  scopeModes: { project: "selected" as ScopeMode, department: "selected" as ScopeMode, warehouse: "selected" as ScopeMode },
  scopeSelections: { project: [] as string[], department: [] as string[], warehouse: [] as string[] },
  grants: [] as string[],
};

const scopeOptions: Record<ScopeKey, string[]> = {
  project: ["Project A", "Project B", "Project C"],
  department: ["Finance", "Operations", "Procurement"],
  warehouse: ["Gudang Utama", "Gudang Site", "Gudang Transit"],
};

const scopeLabels: Record<ScopeKey, string> = {
  project: "Project",
  department: "Department",
  warehouse: "Warehouse",
};

const sensitivePermissions = [
  { id: "transaction.post_recognition", label: "Posting Transaction" },
  { id: "fund_utilization.post_recognition", label: "Posting Fund Utilization" },
  { id: "payment.post", label: "Posting Payment" },
  { id: "payment.allocate", label: "Alokasi Payment" },
];

export default function UserAccess({ initialUsers }: { initialUsers: UserRecord[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [settings, setSettings] = useState<Record<string, typeof emptySettings>>({});
  const [selectedId, setSelectedId] = useState(initialUsers[0]?.id ?? "");
  const [saved, setSaved] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedId) ?? users[0] ?? { id: "", name: "Belum ada pengguna", email: "", roles: [], status: "Nonaktif" as const },
    [users, selectedId],
  );
  const selectedSettings = settings[selectedId] ?? emptySettings;

  function updateSelectedSettings(patch: Partial<typeof selectedSettings>) {
    setSettings((current) => ({
      ...current,
      [selectedId]: { ...emptySettings, ...current[selectedId], ...patch },
    }));
    setSaved(false);
  }

  function chooseUser(id: string) {
    setSelectedId(id);
    setSaved(false);
  }

  function toggleRole(role: string) {
    const roles = selectedUser.roles.includes(role)
      ? selectedUser.roles.filter((item) => item !== role)
      : [...selectedUser.roles, role];
    setUsers((current) => current.map((user) => user.id === selectedId ? { ...user, roles } : user));
    setSaved(false);
  }

  function setMode(key: ScopeKey, mode: ScopeMode) {
    updateSelectedSettings({ scopeModes: { ...selectedSettings.scopeModes, [key]: mode } });
  }

  function toggleScope(key: ScopeKey, value: string) {
    const current = selectedSettings.scopeSelections[key];
    updateSelectedSettings({
      scopeSelections: {
        ...selectedSettings.scopeSelections,
        [key]: current.includes(value)
          ? current.filter((item) => item !== value)
          : [...current, value],
      },
    });
  }

  function toggleGrant(id: string) {
    const grants = selectedSettings.grants.includes(id)
      ? selectedSettings.grants.filter((item) => item !== id)
      : [...selectedSettings.grants, id];
    updateSelectedSettings({ grants });
  }

  function addUserPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = newEmail.trim().toLowerCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError("Masukkan alamat email yang valid.");
      return;
    }
    if (users.some((user) => user.email.toLowerCase() === email)) {
      setFormError("Email ini sudah ada dalam daftar pengguna.");
      return;
    }
    if (newPassword.length < 8) {
      setFormError("Password awal minimal 8 karakter.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("Konfirmasi password belum cocok.");
      return;
    }
    const displayName = email.split("@")[0]
      .replace(/[._-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const id = `preview-${Date.now()}`;

    setUsers((current) => [...current, {
      id,
      name: displayName,
      email,
      roles: [],
      status: "Aktif",
    }]);
    setSettings((current) => ({
      ...current,
      [id]: {
        scopeModes: { project: "selected", department: "selected", warehouse: "selected" },
        scopeSelections: { project: [], department: [], warehouse: [] },
        grants: [],
      },
    }));
    setSelectedId(id);
    setAddOpen(false);
    setNewEmail("");
    setNewPassword("");
    setConfirmPassword("");
    setFormError("");
    setSaved(false);
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (resetPassword.length < 8) {
      setFormError("Password baru minimal 8 karakter.");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setFormError("Konfirmasi password belum cocok.");
      return;
    }
    if (!selectedUser.id) {
      setFormError("Pilih pengguna yang valid.");
      return;
    }

    setResetBusy(true);
    setFormError("");
    const result = await resetUserPassword({ userId: selectedUser.id, password: resetPassword });
    setResetBusy(false);

    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    setResetOpen(false);
    setResetPassword("");
    setResetConfirm("");
    setResetMessage("Password akun berhasil diperbarui.");
  }

  function savePreview() {
    setSaved(true);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SENTRALOGIS · OPERATIONS</p>
          <h1>Pengaturan Pengguna</h1>
          <p className={styles.subtitle}>Atur Role, area kerja, dan akses khusus dari satu halaman.</p>
        </div>
        <a className={styles.backLink} href="/dashboard">Kembali ke Dashboard</a>
      </header>

      <div className={styles.previewNote}>
        <strong>Mode preview</strong>
        <span>Daftar akun dan reset password terhubung ke Supabase Auth. Pengaturan Role, Scope, dan Permission masih Preview.</span>
      </div>

      <div className={styles.layout}>
        <aside className={styles.userPanel}>
          <div className={styles.panelHeading}>
            <div>
              <h2>Pengguna</h2>
              <span>{users.length} akun</span>
            </div>
            <button type="button" className={styles.addButton} onClick={() => { setAddOpen(true); setFormError(""); }}>
              + Tambah Pengguna
            </button>
          </div>
          <div className={styles.userList}>
            {users.map((user) => (
              <button
                type="button"
                key={user.id}
                onClick={() => chooseUser(user.id)}
                className={`${styles.userItem} ${selectedId === user.id ? styles.userItemActive : ""}`}
              >
                <span className={styles.avatar}>{user.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span>
                <span className={styles.userInfo}>
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                  <small>{user.roles.join(", ") || "Belum ada Role"}</small>
                </span>
                <span className={user.status === "Aktif" ? styles.activeDot : styles.inactiveDot} />
              </button>
            ))}
          </div>
          <p className={styles.listHint}>Daftar akun yang terdaftar di Supabase Auth.</p>
        </aside>

        <section className={styles.formPanel}>
          <div className={styles.userHeading}>
            <div>
              <p className={styles.fieldLabel}>PENGATURAN AKUN</p>
              <h2>{selectedUser.name}</h2>
              <p>{selectedUser.email}</p>
            </div>
            <div className={styles.accountActions}>
              <span className={selectedUser.status === "Aktif" ? styles.statusActive : styles.statusInactive}>{selectedUser.status}</span>
              <button type="button" className={styles.resetButton} onClick={() => { setResetOpen(true); setFormError(""); setResetMessage(""); }}>Reset Password</button>
            </div>
          </div>
          {resetMessage && <p className={styles.resetMessage}>{resetMessage}</p>}

          <section className={styles.section}>
            <h3>Role</h3>
            <p className={styles.helper}>Pilih satu atau beberapa Role.</p>
            <div className={styles.choiceRow}>
              {["Cashier", "Finance", "Warehouse", "Management"].map((role) => (
                <label className={styles.checkChoice} key={role}>
                  <input type="checkbox" checked={selectedUser.roles.includes(role)} onChange={() => toggleRole(role)} />
                  <span>{role}</span>
                </label>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h3>Organization</h3>
            <div className={styles.organization}>PT Contoh Tambang Sejahtera</div>
            <p className={styles.helper}>Scope Project, Department, dan Warehouse dibatasi oleh Organization ini.</p>
          </section>

          <section className={styles.section}>
            <h3>Area Kerja</h3>
            <p className={styles.helper}>Pilih Semua atau tentukan beberapa item.</p>
            <div className={styles.scopeGrid}>
              {(Object.keys(scopeLabels) as ScopeKey[]).map((key) => (
                <div className={styles.scopeCard} key={key}>
                  <h4>{scopeLabels[key]}</h4>
                  <label className={styles.radioChoice}>
                    <input type="radio" name={key} checked={selectedSettings.scopeModes[key] === "all"} onChange={() => setMode(key, "all")} />
                    <span>Semua dalam Organization</span>
                  </label>
                  <label className={styles.radioChoice}>
                    <input type="radio" name={key} checked={selectedSettings.scopeModes[key] === "selected"} onChange={() => setMode(key, "selected")} />
                    <span>Pilih beberapa</span>
                  </label>
                  {selectedSettings.scopeModes[key] === "selected" && (
                    <div className={styles.optionList}>
                      {scopeOptions[key].map((option) => (
                        <label className={styles.option} key={option}>
                          <input type="checkbox" checked={selectedSettings.scopeSelections[key].includes(option)} onChange={() => toggleScope(key, option)} />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {selectedSettings.scopeModes[key] === "all" && <p className={styles.allHint}>Termasuk data baru dalam Organization ini.</p>}
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h3>Permission khusus</h3>
            <p className={styles.helper}>Akses posting sensitif diberikan langsung oleh Owner, bukan dari Role.</p>
            <div className={styles.permissionList}>
              {sensitivePermissions.map((permission) => (
                <label className={styles.permissionItem} key={permission.id}>
                  <span>{permission.label}</span>
                  <span className={styles.permissionControl}>
                    <input type="checkbox" checked={selectedSettings.grants.includes(permission.id)} onChange={() => toggleGrant(permission.id)} />
                    {selectedSettings.grants.includes(permission.id) ? "Diberikan" : "Tidak diberikan"}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h3>Status akun</h3>
            <div className={styles.choiceRow}>
              {(["Aktif", "Nonaktif"] as const).map((value) => (
                <label className={styles.checkChoice} key={value}>
                  <input type="radio" name="account-status" checked={selectedUser.status === value} onChange={() => { setUsers((current) => current.map((user) => user.id === selectedId ? { ...user, status: value } : user)); setSaved(false); }} />
                  <span>{value}</span>
                </label>
              ))}
            </div>
          </section>

          <div className={styles.footerActions}>
            {saved && <p className={styles.savedMessage}>Perubahan tersimpan di preview saja.</p>}
            <button type="button" className={styles.saveButton} onClick={savePreview}>Simpan Perubahan (Preview)</button>
          </div>
        </section>
      </div>

      {resetOpen && (
        <div className={styles.modalBackdrop} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setResetOpen(false);
        }}>
          <section className={styles.addModal} role="dialog" aria-modal="true" aria-labelledby="reset-password-title">
            <div className={styles.modalHeading}>
              <div>
                <p className={styles.modalEyebrow}>ADMINISTRASI OWNER</p>
                <h2 id="reset-password-title">Reset Password</h2>
                <p>{selectedUser.email}</p>
              </div>
              <button type="button" className={styles.closeModal} aria-label="Tutup" onClick={() => setResetOpen(false)}>×</button>
            </div>
            <form onSubmit={submitPasswordReset} className={styles.addForm}>
              <label className={styles.modalField}>
                <span>Password baru</span>
                <input type="password" autoComplete="new-password" placeholder="Minimal 8 karakter" value={resetPassword} onChange={(event) => { setResetPassword(event.target.value); setFormError(""); }} required />
              </label>
              <label className={styles.modalField}>
                <span>Konfirmasi password baru</span>
                <input type="password" autoComplete="new-password" placeholder="Ulangi password baru" value={resetConfirm} onChange={(event) => { setResetConfirm(event.target.value); setFormError(""); }} required />
              </label>
              {formError && <p className={styles.formError} role="alert">{formError}</p>}
              <p className={styles.modalNotice}>Password lama tidak diperlukan. Password baru akan langsung diperbarui pada akun Supabase Auth.</p>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelButton} onClick={() => setResetOpen(false)}>Batal</button>
                <button type="submit" className={styles.createButton} disabled={resetBusy}>{resetBusy ? "Menyimpan..." : "Simpan Password Baru"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {addOpen && (
        <div className={styles.modalBackdrop} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAddOpen(false);
        }}>
          <section className={styles.addModal} role="dialog" aria-modal="true" aria-labelledby="add-user-title">
            <div className={styles.modalHeading}>
              <div>
                <p className={styles.modalEyebrow}>ADMINISTRASI OWNER</p>
                <h2 id="add-user-title">Tambah Pengguna</h2>
                <p>Buat akun terlebih dahulu. Role dan area kerja dapat diatur setelah akun terdaftar.</p>
              </div>
              <button type="button" className={styles.closeModal} aria-label="Tutup" onClick={() => setAddOpen(false)}>×</button>
            </div>

            <form onSubmit={addUserPreview} className={styles.addForm}>
              <label className={styles.modalField}>
                <span>Email pengguna</span>
                <input type="email" autoComplete="off" placeholder="nama@perusahaan.com" value={newEmail} onChange={(event) => { setNewEmail(event.target.value); setFormError(""); }} required />
              </label>
              <label className={styles.modalField}>
                <span>Password awal</span>
                <input type="password" autoComplete="new-password" placeholder="Minimal 8 karakter" value={newPassword} onChange={(event) => { setNewPassword(event.target.value); setFormError(""); }} required />
              </label>
              <label className={styles.modalField}>
                <span>Konfirmasi password</span>
                <input type="password" autoComplete="new-password" placeholder="Ulangi password awal" value={confirmPassword} onChange={(event) => { setConfirmPassword(event.target.value); setFormError(""); }} required />
              </label>
              {formError && <p className={styles.formError} role="alert">{formError}</p>}
              <p className={styles.modalNotice}>Akun baru akan muncul di daftar Pengguna tanpa Role. Atur Role, area kerja, dan permission setelah akun dibuat. Ini masih Preview; akun belum dibuat di Supabase dan password tidak disimpan.</p>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelButton} onClick={() => setAddOpen(false)}>Batal</button>
                <button type="submit" className={styles.createButton}>Tambah Pengguna</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
