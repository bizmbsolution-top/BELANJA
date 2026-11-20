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

const initialSettings: Record<string, {
  scopeModes: Record<ScopeKey, ScopeMode>;
  scopeSelections: Record<ScopeKey, string[]>;
  grants: string[];
}> = {
  u1: {
    scopeModes: { project: "selected", department: "all", warehouse: "selected" },
    scopeSelections: { project: ["Project A", "Project B"], department: [], warehouse: ["Gudang Utama"] },
    grants: ["fund_utilization.post_recognition"],
  },
  u2: {
    scopeModes: { project: "all", department: "selected", warehouse: "all" },
    scopeSelections: { project: [], department: ["Finance"], warehouse: [] },
    grants: ["payment.post", "payment.allocate"],
  },
  u3: {
    scopeModes: { project: "selected", department: "all", warehouse: "selected" },
    scopeSelections: { project: ["Project C"], department: [], warehouse: ["Gudang Site", "Gudang Transit"] },
    grants: [],
  },
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

export default function UserAccess() {
  const [users, setUsers] = useState(initialUsers);
  const [settings, setSettings] = useState(initialSettings);
  const [selectedId, setSelectedId] = useState("u1");
  const [saved, setSaved] = useState(false);

  const selectedUser = useMemo(
    () => users.find((user) => user.id === selectedId) ?? users[0],
    [users, selectedId],
  );
  const selectedSettings = settings[selectedId] ?? initialSettings.u1;

  function updateSelectedSettings(patch: Partial<typeof selectedSettings>) {
    setSettings((current) => ({
      ...current,
      [selectedId]: { ...current[selectedId], ...patch },
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
    const current = selectedSettings.selectedSettings.scopeSelections[key];
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
            <span className={selectedUser.status === "Aktif" ? styles.statusActive : styles.statusInactive}>{selectedUser.status}</span>
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
                  <input type="radio" name="account-status" checked={status === value} onChange={() => { setUsers((current) => current.map((user) => user.id === selectedId ? { ...user, status: value } : user)); setSaved(false); }} />
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
