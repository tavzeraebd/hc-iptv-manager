import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminLogin } from "@/components/admin-login";
import { Header } from "@/components/header";
import { Toolbar } from "@/components/toolbar";
import type { StatusFilter, SortOrder } from "@/components/toolbar";
import { UserTable } from "@/components/user-table";
import { UserFormDialog } from "@/components/user-form-dialog";
import { ImportDialog } from "@/components/import-dialog";
import { DeleteUserDialog } from "@/components/delete-user-dialog";
import { ServerSettingsDialog } from "@/components/server-settings-dialog";
import { DevicesDialog } from "@/components/devices-dialog";
import { RenewalSettingsDialog } from "@/components/renewal-settings-dialog";
import { EmptyState } from "@/components/empty-state";
import { useAdminAuth } from "@/hooks/use-admin-auth";
import { useIptvUsers } from "@/hooks/use-iptv-users";
import { useTheme } from "@/hooks/use-theme";
import type { IptvUserWithCheck } from "@/lib/types";

function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b bg-muted/50 px-3 py-2.5">
        <Skeleton className="h-4 w-40" />
      </div>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b px-3 py-3 last:border-b-0">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="ml-auto h-4 w-32" />
        </div>
      ))}
    </div>
  );
}

function Dashboard({ onLock }: { onLock: () => void }) {
  const {
    users,
    loading,
    refreshingAll,
    refreshAll,
    checkOne,
    addUser,
    updateUser,
    deleteUser,
    importUsers,
  } = useIptvUsers();
  const { theme, toggleTheme } = useTheme();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("TODOS");
  const [sortOrder, setSortOrder] = useState<SortOrder>("EXP_ASC");

  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [renewalOpen, setRenewalOpen] = useState(false);
  const [devicesPreselect, setDevicesPreselect] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<IptvUserWithCheck | null>(null);
  const [deletingUser, setDeletingUser] = useState<IptvUserWithCheck | null>(null);

  const stats = useMemo(() => {
    const active = users.filter((u) => u.check?.status === "ATIVO").length;
    const expiringSoon = users.filter((u) => u.check?.status === "VENCE_EM_BREVE").length;
    const expiredOrOffline = users.filter(
      (u) => u.check?.status === "EXPIRADO" || u.check?.status === "OFFLINE"
    ).length;
    return { total: users.length, active, expiringSoon, expiredOrOffline };
  }, [users]);

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    let list = users.filter((u) => {
      const matchesSearch =
        !term || u.host.toLowerCase().includes(term) || u.username.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "TODOS" || u.check?.status === statusFilter;
      return matchesSearch && matchesStatus;
    });

    list = [...list].sort((a, b) => {
      const expA = a.check?.expDate ?? Number.MAX_SAFE_INTEGER;
      const expB = b.check?.expDate ?? Number.MAX_SAFE_INTEGER;
      return sortOrder === "EXP_ASC" ? expA - expB : expB - expA;
    });

    return list;
  }, [users, search, statusFilter, sortOrder]);

  const openAddForm = () => {
    setEditingUser(null);
    setFormOpen(true);
  };

  const openEditForm = (user: IptvUserWithCheck) => {
    setEditingUser(user);
    setFormOpen(true);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background">
        <Header
          total={stats.total}
          active={stats.active}
          expiringSoon={stats.expiringSoon}
          expiredOrOffline={stats.expiredOrOffline}
          onAdd={openAddForm}
          onImport={() => setImportOpen(true)}
          onRefreshAll={refreshAll}
          refreshingAll={refreshingAll}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenServerSettings={() => setServerSettingsOpen(true)}
          onOpenDevices={() => {
            setDevicesPreselect(null);
            setDevicesOpen(true);
          }}
          onOpenRenewal={() => setRenewalOpen(true)}
          onLock={onLock}
        />

        <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <Toolbar
            search={search}
            onSearchChange={setSearch}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            sortOrder={sortOrder}
            onSortOrderChange={setSortOrder}
          />

          {loading ? (
            <TableSkeleton />
          ) : users.length === 0 ? (
            <EmptyState onAdd={openAddForm} />
          ) : visibleUsers.length === 0 ? (
            <div className="rounded-xl border border-dashed py-16 text-center text-muted-foreground">
              Nenhum usuário encontrado para os filtros atuais.
            </div>
          ) : (
            <UserTable
              users={visibleUsers}
              onEdit={openEditForm}
              onDelete={setDeletingUser}
              onRefresh={checkOne}
              onManageDevices={(id) => {
                setDevicesPreselect(id);
                setDevicesOpen(true);
              }}
            />
          )}
        </main>

        <UserFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          user={editingUser}
          onSubmit={async (input) => {
            if (editingUser) {
              await updateUser(editingUser.id, input);
              toast.success("Usuário atualizado com sucesso.");
            } else {
              await addUser(input);
              toast.success("Usuário adicionado com sucesso.");
            }
          }}
        />

        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onImport={async (users) => {
            const result = await importUsers(users);
            if (result.added > 0) {
              toast.success(
                `${result.added} usuário${result.added === 1 ? "" : "s"} importado${result.added === 1 ? "" : "s"} com sucesso.`
              );
            }
            if (result.skipped > 0) {
              toast.info(`${result.skipped} já existiam e foram ignorados.`);
            }
            return result;
          }}
        />

        {deletingUser && (
          <DeleteUserDialog
            open={Boolean(deletingUser)}
            onOpenChange={(open) => !open && setDeletingUser(null)}
            username={deletingUser.username}
            onConfirm={async () => {
              await deleteUser(deletingUser.id);
              toast.success("Usuário excluído.");
            }}
          />
        )}

        <ServerSettingsDialog
          open={serverSettingsOpen}
          onOpenChange={setServerSettingsOpen}
          onSaved={() => window.location.reload()}
        />

        <DevicesDialog
          open={devicesOpen}
          onOpenChange={setDevicesOpen}
          servers={users}
          preselectServerId={devicesPreselect}
        />

        <RenewalSettingsDialog open={renewalOpen} onOpenChange={setRenewalOpen} servers={users} />

        <Toaster />
      </div>
    </TooltipProvider>
  );
}

export default function App() {
  const { hasPin, authed, createPin, unlock, lock } = useAdminAuth();

  if (!authed) {
    return <AdminLogin firstRun={!hasPin} onCreatePin={createPin} onUnlock={unlock} />;
  }

  return <Dashboard onLock={lock} />;
}
