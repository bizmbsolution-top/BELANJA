"use client";

import { useMemo, useState } from "react";
import styles from "./user-access.module.css";

type ScopeMode = "all" | "selected";
type ScopeKey = "project" | "department" | "warehouse";

const initialUsers = [
  { id: "u1", name: "Budi Santoso", email: "budi@sentralogis.com", roles: ["Cashier"], status: "Aktif" },
  { id: "u2", name: "Sari Wijaya", email: "sari@sentralogis.com", roles: ["Finance"], status: "Aktif" },
  { id: "u3", name: "Dedi Pratama", email: "dedi@sentralogis.com", roles: ["Warehouse"], status: "Nonaktif" },
];

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

export default function UserAccess() {
  const [users, setUsers] = useState(initialUsers);
  const [selectedId, setSelectedId] = useState("u1");
  const [roles, setRoles] = useState<string[]>(["Cashier"]);
  const [scopeModes, setScopeModes] = useState<Record<ScopeKey, ScopeMode>>({
    project: "selected",
    department: "all",
    warehouse: "selected",
  });
  const [scopeSelections, setScopeSelections] = useState<Record<ScopeKey, string[]>>({
    project: ["Project A", "Project B"],
    department: [],
    warehouse: ["Gudang Utama"],
  });
  const [grants, setGrants] = useState<string[]>(["fund_utilization.post_recognition"]);
  const [status, setStatus] = useState("Aktif");
  const [saved, setSaved] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedId) ?? users[0],
    [users, selectedId],
  );

  function chooseUser(id: string) {
    const user = users.find((item) => item.id === id);
    if (!user) return;
    setSelectedId(id);
    setRoles(user.roles);
    setStatus(user.status);
    setSaved(false);
  }

  function toggleRole(role: string) {
    setRoles((current) => current.includes(role)
      ? current.filter((item) => item !== role)
      : [...current, role]);
    setSaved(false);
  }

  function setMode(key: ScopeKey, mode: ScopeMode) {
    setScopeModes((current) => ({ ...current, [key]: mode }));
    setSaved(false);
  }

  function toggleScope(key: ScopeKey, value: string) {
    setScopeSelections((current) => ({
      ...current,
      [key]: current[key].includes(value)
        ? current[key].filter((item) => item !== value)
        : [...current[key], value],
    }));
    setSaved(false);
  }

  function toggleGrant(id: string) {
    setGrants((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
    setSaved(false);
  }

  function savePreview() {
    setUsers((current) => current.map((user) => user.id === selectedId
      ? { ...user, roles, status }
      : user));
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
        <span>Perubahan di halaman ini hanya simulasi tampilan dan belum disimpan ke database.</span>
      </div>

      <div className={styles.layout}>
        <aside className={styles.userPanel}>
          <div className={styles.panelHeading}>
            <h2>Pengguna</h2>
            <span>{users.length} akun</span>
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
          <p className={styles.listHint}>Daftar contoh untuk melihat tampilan pengaturan.</p>
        </aside>

        <section className={styles.formPanel}>
          <div className={styles.userHeading}>
            <div>
              <p className={styles.fieldLabel}>PENGATURAN AKUN</p>
              <h2>{selectedUser.name}</h2>
              <p>{selectedUser.email}</p>
            </div>
            <span className={status === "Aktif" ? styles.statusActive : styles.statusInactive}>{status}</span>
          </div>

          <section className={styles.section}>
            <h3>Role</h3>
            <p className={styles.helper}>Pilih satu atau beberapa Role.</p>
            <div className={styles.choiceRow}>
              {["Cashier", "Finance", "Warehouse", "Management"].map((role) => (
                <label className={styles.checkChoice} key={role}>
                  <input type="checkbox" checked={roles.includes(role)} onChange={() => toggleRole(role)} />
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
                    <input type="radio" name={key} checked={scopeModes[key] === "all"} onChange={() => setMode(key, "all")} />
                    <span>Semua dalam Organization</span>
                  </label>
                  <label className={styles.radioChoice}>
                    <input type="radio" name={key} checked={scopeModes[key] === "selected"} onChange={() => setMode(key, "selected")} />
                    <span>Pilih beberapa</span>
                  </label>
                  {scopeModes[key] === "selected" && (
                    <div className={styles.optionList}>
                      {scopeOptions[key].map((option) => (
                        <label className={styles.option} key={option}>
                          <input type="checkbox" checked={scopeSelections[key].includes(option)} onChange={() => toggleScope(key, option)} />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {scopeModes[key] === "all" && <p className={styles.allHint}>Termasuk data baru dalam Organization ini.</p>}
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
                    <input type="checkbox" checked={grants.includes(permission.id)} onChange={() => toggleGrant(permission.id)} />
                    {grants.includes(permission.id) ? "Diberikan" : "Tidak diberikan"}
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
                  <input type="radio" name="account-status" checked={status === value} onChange={() => { setStatus(value); setSaved(false); }} />
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
    </main>
  );
}
