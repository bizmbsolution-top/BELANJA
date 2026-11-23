"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/login/actions";
import styles from "./dashboard-shell.module.css";

type Props = {
  children: React.ReactNode;
  email: string;
  roles: string[];
  isOwner: boolean;
};

type MenuItem = {
  label: string;
  href?: string;
  roles?: string[];
};

type MenuGroup = {
  title: string;
  items: MenuItem[];
  ownerOnly?: boolean;
};

const groups: MenuGroup[] = [
  { title: "UTAMA", items: [{ label: "Dashboard", href: "/dashboard" }] },
  { title: "AKTIVITAS", items: [{ label: "Aktivitas Saya", href: "/dashboard/aktivitas-saya" }] },
  {
    title: "OPERASIONAL",
    items: [
      { label: "Pembelian", href: "/dashboard/pembelian", roles: ["Procurement", "Finance", "Management"] },
      { label: "Pengeluaran", href: "/dashboard/pengeluaran", roles: ["Cashier", "Finance", "Management"] },
      { label: "Permintaan & Penggunaan Dana", href: "/dashboard/permintaan-penggunaan-dana", roles: ["Cashier", "Finance", "Management"] },
      { label: "Persediaan", href: "/dashboard/persediaan", roles: ["Warehouse", "Management"] },
      { label: "Penjualan", href: "/dashboard/penjualan", roles: ["Sales", "Management"] },
    ],
  },
  {
    title: "KEUANGAN",
    items: [{ label: "Kas & Pembayaran", roles: ["Cashier", "Finance", "Management"] }],
  },
  {
    title: "DATA MASTER",
    items: [
      { label: "Supplier", href: "/dashboard/supplier", roles: ["Procurement", "Finance", "Management"] },
      { label: "Kategori Pembelian", href: "/dashboard/kategori", roles: ["Procurement", "Finance", "Management"] },
      { label: "Proyek & Departemen", roles: ["Management"] },
      { label: "Gudang", roles: ["Warehouse", "Management"] },
    ],
  },
  {
    title: "ADMINISTRASI OWNER",
    ownerOnly: true,
    items: [
      { label: "Pengguna & Akses", href: "/dashboard/pengguna" },
      { label: "Role & Permission" },
      { label: "Riwayat Aktivitas", href: "/dashboard/riwayat-aktivitas" },
      { label: "Pengaturan Organisasi" },
    ],
  },
];

function Brand() {
  return (
    <div className={styles.brand}>
      <span className={styles.brandMark}>
        <Image
          src="/logo_belanja.png"
          alt=""
          width={1026}
          height={1027}
          className={styles.brandLogo}
        />
      </span>
      <span className={styles.brandName}>BELANJA</span>
    </div>
  );
}

export default function DashboardShell({ children, email, roles, isOwner }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("belanja-theme");
    if (savedTheme === "dark" || savedTheme === "light") setTheme(savedTheme);
  }, []);

  function toggleTheme() {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    window.localStorage.setItem("belanja-theme", nextTheme);
  }

  const visibleGroups = groups
    .filter((group) => !group.ownerOnly || isOwner)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        isOwner || !item.roles || item.roles.some((role) => roles.includes(role))
      ),
    }))
    .filter((group) => group.items.length > 0);

  function toggleGroup(title: string) {
    setCollapsedGroups((current) =>
      current.includes(title) ? current.filter((item) => item !== title) : [...current, title]
    );
  }

  const nav = (
    <>
      <div className={styles.brandWrap}>
        <Brand />
        <span className={styles.brandCaption}>SENTRALOGIS · OPERATIONS</span>
      </div>
      <div className={styles.navScroll}>
        {visibleGroups.map((group) => (
          <section className={styles.navGroup} key={group.title}>
            <button
              type="button"
              className={styles.groupHeading}
              onClick={() => toggleGroup(group.title)}
              aria-expanded={!collapsedGroups.includes(group.title)}
            >
              <span>{group.title}</span>
              <span className={styles.chevron}>{collapsedGroups.includes(group.title) ? "+" : "−"}</span>
            </button>
            {!collapsedGroups.includes(group.title) && (
              <div className={styles.navItems}>
                {group.items.map((item) => {
                  const active = Boolean(item.href && pathname === item.href);
                  return item.href ? (
                    <Link
                      key={item.label}
                      href={item.href}
                      onClick={() => setMobileOpen(false)}
                      className={active ? styles.navActive : styles.navLink}
                    >
                      <span className={styles.navDot} />
                      {item.label}
                    </Link>
                  ) : (
                    <div key={item.label} className={styles.navDisabled} title="Modul akan tersedia pada tahap berikutnya">
                      <span className={styles.navDot} />
                      <span>{item.label}</span>
                      <small>Segera</small>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        ))}
      </div>
      <div className={styles.sidebarFooter}>
        <div className={styles.userBadge}>
          <span className={styles.userAvatar}>{isOwner ? "O" : (roles[0]?.[0] ?? "U")}</span>
          <span className={styles.userDetails}>
            <strong>{isOwner ? "Superadmin" : roles.join(" · ")}</strong>
            <small>{email}</small>
          </span>
        </div>
        <button className={styles.themeToggle} type="button" onClick={toggleTheme} aria-pressed={theme === "dark"}>
          <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span>
          {theme === "light" ? "Mode gelap" : "Mode terang"}
        </button>
        <form action={signOut}>
          <button className={styles.logout} type="submit">Keluar</button>
        </form>
        <p>managed by Sentralogis.com</p>
      </div>
    </>
  );

  return (
    <div className={styles.app} data-theme={theme}>
      <aside className={styles.sidebar}>{nav}</aside>
      {mobileOpen && (
        <div className={styles.mobileOverlay} onClick={() => setMobileOpen(false)}>
          <aside className={styles.mobileSidebar} onClick={(event) => event.stopPropagation()}>
            <button className={styles.mobileClose} type="button" onClick={() => setMobileOpen(false)} aria-label="Tutup menu">×</button>
            {nav}
          </aside>
        </div>
      )}
      <div className={styles.mainColumn}>
        <header className={styles.mobileTopbar}>
          <button type="button" className={styles.menuButton} onClick={() => setMobileOpen(true)} aria-label="Buka menu">☰</button>
          <Brand />
          <button type="button" className={styles.mobileThemeToggle} onClick={toggleTheme} aria-label={theme === "light" ? "Aktifkan mode gelap" : "Aktifkan mode terang"}>{theme === "light" ? "☾" : "☀"}</button>
          <span className={styles.mobileRole}>{isOwner ? "Superadmin" : roles.join(", ")}</span>
        </header>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
