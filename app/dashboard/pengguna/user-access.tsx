"use client";

import { type FormEvent, useMemo, useState } from "react";
import styles from "./user-access.module.css";
import { createManagedUser, resetUserPassword, saveUserAccessProfile, updateManagedUserEmail } from "./actions";
import { signOut } from "@/app/login/actions";

/*
 * Scope and Permission controls are intentionally NOT rendered as editable.
 *
 * The backend stores only user_id, roles and is_active. There is no table or
 * column for Project / Department / Warehouse scope, and no storage for the
 * sensitive per-user permissions. The former controls held placeholder data
 * ("Project A", "Gudang Utama", ...) in React state and were never sent to the
 * server, so they implied a capability that does not exist.
 *
 * The design decisions themselves are NOT withdrawn. They remain specified in
 * docs/phase-0c/ui-foundation/UI_03A_STAGE_2_AD_018_PROJECT_DEPT_SCOPE_ARCHITECTURE.md
 * and docs/phase-0c/rbac/AUTHORIZATION_SCOPE_MODEL.md, and must be implemented
 * once an Owner-approved storage design exists.
 */

type UserRecord = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  status: "Aktif" | "Nonaktif";
  scopes: { project: "none" | "all"; department: "none" | "all"; warehouse: "none" | "all" };
  permissions: {
    "transaction.post_recognition": "unset" | "allow" | "deny";
    "fund_utilization.post_recognition": "unset" | "allow" | "deny";
    "payment.post": "unset" | "allow" | "deny";
    "payment.allocate": "unset" | "allow" | "deny";
  };
};


/**
 * Sensitive per-user permissions. These remain individual grants and are NOT
 * derived from Role. Displayed read-only until backend storage exists.
 */
const sensitivePermissions = [
  { id: "transaction.post_recognition", label: "Posting Transaction" },
  { id: "fund_utilization.post_recognition", label: "Posting Fund Utilization" },
  { id: "payment.post", label: "Posting Payment" },
  { id: "payment.allocate", label: "Alokasi Payment" },
] as const;

const scopeDimensions = [
  { id: "project", label: "Project" },
  { id: "department", label: "Department" },
  { id: "warehouse", label: "Warehouse" },
] as const;

export default function UserAccess({ initialUsers }: { initialUsers: UserRecord[] }) {
  const [users, setUsers] = useState(initialUsers);
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
  const [editEmailOpen, setEditEmailOpen] = useState(false);
  const [editEmail, setEditEmail] = useState("");
  const [editEmailError, setEditEmailError] = useState("");
  const [editEmailBusy, setEditEmailBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedId) ?? users[0] ?? { id: "", name: "Belum ada pengguna", email: "", roles: [], status: "Nonaktif" as const },
    [users, selectedId],
  );

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

  function updateScope(dimension: keyof UserRecord["scopes"], value: "none" | "all") {
    setUsers((current) => current.map((user) =>
      user.id === selectedId ? { ...user, scopes: { ...user.scopes, [dimension]: value } } : user
    ));
    setSaved(false);
  }

  function updatePermission(permission: keyof UserRecord["permissions"], value: "unset" | "allow" | "deny") {
    setUsers((current) => current.map((user) =>
      user.id === selectedId ? { ...user, permissions: { ...user.permissions, [permission]: value } } : user
    ));
    setSaved(false);
  }
  async function addUserPreview(event: FormEvent<HTMLFormElement>) {
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

    setFormError("");
    const result = await createManagedUser({ email, password: newPassword });
    if (!result.ok) {
      setFormError(result.error);
      return;
    }

    setUsers((current) => [...current, result.user]);
    setSelectedId(result.user.id);
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


  async function submitEmailEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = editEmail.trim().toLowerCase();
    if (!selectedUser.id) {
      setEditEmailError("Pilih pengguna yang valid.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEditEmailError("Masukkan alamat email yang valid.");
      return;
    }
    if (users.some((user) => user.id !== selectedUser.id && user.email.toLowerCase() === email)) {
      setEditEmailError("Email ini sudah ada dalam daftar pengguna.");
      return;
    }

    setEditEmailBusy(true);
    setEditEmailError("");
    const result = await updateManagedUserEmail({ userId: selectedUser.id, email });
    setEditEmailBusy(false);
    if (!result.ok) {
      setEditEmailError(result.error);
      return;
    }

    setUsers((current) => current.map((user) =>
      user.id === selectedUser.id ? { ...user, email: result.email, name: result.name } : user
    ));
    setEditEmailOpen(false);
    setEditEmail("");
    setEditEmailError("");
    setResetMessage("Email pengguna berhasil diperbarui.");
  }

  async function savePreview() {
    if (!selectedUser.id) return;
    setSaveBusy(true);
    setSaveError("");
    const result = await saveUserAccessProfile({
      userId: selectedUser.id,
      roles: selectedUser.roles,
      status: selectedUser.status,
      scopes: selectedUser.scopes,
      permissions: selectedUser.permissions,
    });
    setSaveBusy(false);
    if (!result.ok) {
      setSaved(false);
      setSaveError(result.error);
      return;
    }
    setSaved(true);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>SENTRALOGIS · OPERATIONS</p>
          <h1>Pengaturan Pengguna</h1>
          <p className={styles.subtitle}>Atur Role, area kerja, dan permission khusus setiap pengguna.</p>
        </div>
        <div className={styles.headerActions}><a className={styles.backLink} href="/dashboard">Kembali ke Dashboard</a><form action={signOut}><button className={styles.logoutButton} type="submit">Keluar</button></form></div>
      </header>

      <div className={styles.previewNote}>
        <strong>Mode preview</strong>
        <span>Role, status, Scope All, dan Permission khusus tersimpan ke Supabase. Pilihan Selected menunggu master data.</span>
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
              <button type="button" className={styles.editAccessButton} onClick={() => document.getElementById("role-status-editor")?.scrollIntoView({ behavior: "smooth", block: "center" })}>Edit Role &amp; Status</button>
              <button type="button" className={styles.resetButton} onClick={() => { setEditEmail(selectedUser.email); setEditEmailError(""); setEditEmailOpen(true); }}>Edit Email</button>
              <button type="button" className={styles.resetButton} onClick={() => { setResetOpen(true); setFormError(""); setResetMessage(""); }}>Reset Password</button>
            </div>
          </div>
          {resetMessage && <p className={styles.resetMessage}>{resetMessage}</p>}

          <section className={styles.section} id="role-status-editor">
            <h3>Role &amp; Akses Pengguna</h3>
            <p className={styles.editInstruction}>Pilih Role yang sesuai. Anda dapat memilih lebih dari satu Role. Setelah selesai, tekan <strong>Simpan Perubahan</strong> yang selalu tersedia di bagian bawah layar.</p>
            <p className={styles.helper}>Role menentukan modul operasional yang dapat dibuka pengguna.</p>
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
            <p className={styles.helper}>
              Atur batas data yang dapat dibuka pengguna. Scope yang tidak dipilih berarti tidak ada akses.
              Pilihan Selected akan diaktifkan setelah master data tersedia.
            </p>
            <div className={styles.scopeGrid}>
              {scopeDimensions.map((dimension) => (
                <div className={styles.scopeCard} key={dimension.id}>
                  <h4>{dimension.label}</h4>
                  <label className={styles.radioChoice}>
                    <input
                      type="radio"
                      name={`scope-${selectedId}-${dimension.id}`}
                      checked={selectedUser.scopes[dimension.id] === "all"}
                      onChange={() => updateScope(dimension.id, "all")}
                    />
                    <span>All — seluruh {dimension.label}</span>
                  </label>
                  <label className={styles.radioChoice}>
                    <input
                      type="radio"
                      name={`scope-${selectedId}-${dimension.id}`}
                      checked={selectedUser.scopes[dimension.id] === "none"}
                      onChange={() => updateScope(dimension.id, "none")}
                    />
                    <span>Tidak ada akses</span>
                  </label>
                  <p className={styles.allHint}>Selected belum tersedia — master {dimension.label} belum dibuat.</p>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <h3>Permission khusus</h3>
            <p className={styles.helper}>
              Pengaturan berlaku per pengguna, bukan dari Role. Pilih Izinkan atau Tolak.
              Belum diatur berarti permission tidak diberikan.
            </p>
            <div className={styles.permissionList}>
              {sensitivePermissions.map((permission) => (
                <div className={styles.permissionItem} key={permission.id}>
                  <strong>{permission.label}</strong>
                  <div className={styles.permissionControl}>
                    {(["unset", "allow", "deny"] as const).map((effect) => (
                      <label key={effect}>
                        <input
                          type="radio"
                          name={`permission-${selectedId}-${permission.id}`}
                          checked={selectedUser.permissions[permission.id] === effect}
                          onChange={() => updatePermission(permission.id, effect)}
                        />
                        {effect === "unset" ? "Belum diatur" : effect === "allow" ? "Izinkan" : "Tolak"}
                      </label>
                    ))}
                  </div>
                </div>
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
            {saved && <p className={styles.savedMessage}>Role dan status berhasil disimpan ke Supabase.</p>}
            {saveError && <p className={styles.formError} role="alert">{saveError}</p>}
            <button type="button" className={styles.saveButton} onClick={savePreview} disabled={saveBusy || !selectedUser.id}>{saveBusy ? "Menyimpan..." : "Simpan Perubahan"}</button>
          </div>
        </section>
      </div>


      {editEmailOpen && (
        <div className={styles.modalBackdrop} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setEditEmailOpen(false);
        }}>
          <section className={styles.addModal} role="dialog" aria-modal="true" aria-labelledby="edit-user-email-title">
            <div className={styles.modalHeading}>
              <div>
                <p className={styles.modalEyebrow}>ADMINISTRASI OWNER</p>
                <h2 id="edit-user-email-title">Edit Email Pengguna</h2>
                <p>Email login akun ini akan diperbarui langsung.</p>
              </div>
              <button type="button" className={styles.closeModal} aria-label="Tutup" onClick={() => setEditEmailOpen(false)}>×</button>
            </div>
            <form onSubmit={submitEmailEdit} className={styles.addForm}>
              <label className={styles.modalField}>
                <span>Email pengguna</span>
                <input type="email" autoComplete="off" value={editEmail} onChange={(event) => { setEditEmail(event.target.value); setEditEmailError(""); }} required />
              </label>
              {editEmailError && <p className={styles.formError} role="alert">{editEmailError}</p>}
              <p className={styles.modalNotice}>Perubahan langsung berlaku pada Supabase Auth. Pengguna selanjutnya login menggunakan email baru dan password yang sama. Email baru akan dikonfirmasi oleh Owner.</p>
              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelButton} onClick={() => setEditEmailOpen(false)}>Batal</button>
                <button type="submit" className={styles.createButton} disabled={editEmailBusy}>{editEmailBusy ? "Menyimpan..." : "Simpan Email"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

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
              <p className={styles.modalNotice}>Akun baru akan muncul di daftar Pengguna tanpa Role. Atur Role, area kerja, dan permission setelah akun dibuat. Akun akan langsung dibuat di Supabase Auth dan dapat digunakan untuk login. Role dan area kerja diatur setelah akun terdaftar.</p>
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
