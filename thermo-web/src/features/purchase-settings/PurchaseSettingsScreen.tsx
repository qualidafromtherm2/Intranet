/* oxlint-disable react/set-state-in-effect */
import { useCallback, useEffect, useState } from "react";
import { FolderCog, Plus, RefreshCw, Settings2, Trash2, X } from "lucide-react";
import * as api from "../../services/purchaseSettingsGateway";
import type { PurchaseDepartment, PurchaseSettingKind } from "./types";
type Editor = {
  mode: "create" | "rename" | "delete";
  kind: PurchaseSettingKind;
  id?: number;
  parentId?: number;
  current?: string;
};
export function PurchaseSettingsScreen({
  allowed = true,
  canWrite = false,
}: {
  allowed?: boolean;
  canWrite?: boolean;
}) {
  const [departments, setDepartments] = useState<PurchaseDepartment[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      setDepartments((await api.loadPurchaseSettings()).departamentos || []);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Falha ao carregar configurações.",
      );
    } finally {
      setLoading(false);
    }
  }, [allowed]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!allowed)
    return (
      <section
        role="alert"
        className="rounded border border-amber-300 bg-amber-50 p-5"
      >
        <h1 className="font-bold">Acesso não permitido</h1>
        <p>Seu perfil não possui permissão para Configurações de Compras.</p>
      </section>
    );
  return (
    <main className="mx-auto max-w-[1440px] space-y-4 p-3 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
            Compras
          </p>
          <h1 className="text-2xl font-bold">
            Configuração de departamentos e categorias
          </h1>
          <p className="text-sm text-slate-600">
            Hierarquia usada para classificar solicitações de compra.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void load()}
            className="min-h-11 rounded border px-4"
          >
            <RefreshCw className="mr-2 inline size-4" />
            Atualizar
          </button>
          {canWrite && (
            <button
              onClick={() =>
                setEditor({ mode: "create", kind: "departamento" })
              }
              className="min-h-11 rounded bg-emerald-700 px-4 font-bold text-white"
            >
              <Plus className="mr-2 inline size-4" />
              Novo departamento
            </button>
          )}
        </div>
      </header>
      {!canWrite && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Modo somente consulta. Alterações exigem autorização explícita da
          integração.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded border border-red-300 bg-red-50 p-3 text-red-900"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded border border-emerald-300 bg-emerald-50 p-3"
        >
          {notice}
        </p>
      )}
      {loading && !departments.length ? (
        <p>Carregando hierarquia…</p>
      ) : departments.length ? (
        <div className="space-y-4">
          {departments.map((dept) => (
            <section key={dept.id} className="rounded-md border bg-white">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50 p-4">
                <h2 className="font-bold">
                  <FolderCog className="mr-2 inline size-5" />
                  {dept.nome}
                </h2>
                {canWrite && (
                  <Actions
                    create={() =>
                      setEditor({
                        mode: "create",
                        kind: "categoria",
                        parentId: dept.id,
                      })
                    }
                    rename={() =>
                      setEditor({
                        mode: "rename",
                        kind: "departamento",
                        id: dept.id,
                        current: dept.nome,
                      })
                    }
                    remove={() =>
                      setEditor({
                        mode: "delete",
                        kind: "departamento",
                        id: dept.id,
                        current: dept.nome,
                      })
                    }
                  />
                )}
              </header>
              <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                {dept.categorias.length ? (
                  dept.categorias.map((cat) => (
                    <article key={cat.id} className="rounded border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold">
                          <Settings2 className="mr-2 inline size-4" />
                          {cat.nome}
                        </h3>
                        {canWrite && (
                          <Actions
                            compact
                            create={() =>
                              setEditor({
                                mode: "create",
                                kind: "subitem",
                                parentId: cat.id,
                              })
                            }
                            rename={() =>
                              setEditor({
                                mode: "rename",
                                kind: "categoria",
                                id: cat.id,
                                current: cat.nome,
                              })
                            }
                            remove={() =>
                              setEditor({
                                mode: "delete",
                                kind: "categoria",
                                id: cat.id,
                                current: cat.nome,
                              })
                            }
                          />
                        )}
                      </div>
                      <ul className="mt-3 space-y-2">
                        {cat.subitens.length ? (
                          cat.subitens.map((sub) => (
                            <li
                              key={sub.id}
                              className="flex min-h-11 items-center justify-between rounded bg-emerald-50 px-3"
                            >
                              <span>{sub.nome}</span>
                              {canWrite && (
                                <span className="flex">
                                  <button
                                    aria-label={`Renomear subitem ${sub.nome}`}
                                    onClick={() =>
                                      setEditor({
                                        mode: "rename",
                                        kind: "subitem",
                                        id: sub.id,
                                        current: sub.nome,
                                      })
                                    }
                                    className="grid size-11 place-items-center"
                                  >
                                    <Settings2 className="size-4" />
                                  </button>
                                  <button
                                    aria-label={`Excluir subitem ${sub.nome}`}
                                    onClick={() =>
                                      setEditor({
                                        mode: "delete",
                                        kind: "subitem",
                                        id: sub.id,
                                        current: sub.nome,
                                      })
                                    }
                                    className="grid size-11 place-items-center text-red-700"
                                  >
                                    <Trash2 className="size-4" />
                                  </button>
                                </span>
                              )}
                            </li>
                          ))
                        ) : (
                          <li className="text-sm text-slate-500">
                            Nenhum subitem.
                          </li>
                        )}
                      </ul>
                    </article>
                  ))
                ) : (
                  <p className="p-3 text-sm text-slate-500">
                    Nenhuma categoria.
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded border p-6 text-center text-slate-600">
          Nenhum departamento cadastrado.
        </p>
      )}
      {editor && (
        <EditorDialog
          editor={editor}
          canWrite={canWrite}
          close={() => setEditor(null)}
          done={() => {
            setEditor(null);
            setNotice("Configuração atualizada.");
            void load();
          }}
          error={setError}
        />
      )}
    </main>
  );
}
function Actions({
  create,
  rename,
  remove,
  compact = false,
}: {
  create: () => void;
  rename: () => void;
  remove: () => void;
  compact?: boolean;
}) {
  return (
    <div className="flex">
      <button
        onClick={create}
        className={
          compact ? "grid size-11 place-items-center" : "min-h-11 px-3"
        }
        aria-label="Adicionar item"
      >
        <Plus className="size-4" />
      </button>
      <button
        onClick={rename}
        className={
          compact ? "grid size-11 place-items-center" : "min-h-11 px-3"
        }
        aria-label="Renomear"
      >
        <Settings2 className="size-4" />
      </button>
      <button
        onClick={remove}
        className={
          compact
            ? "grid size-11 place-items-center text-red-700"
            : "min-h-11 px-3 text-red-700"
        }
        aria-label="Excluir"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
function EditorDialog({
  editor,
  canWrite,
  close,
  done,
  error,
}: {
  editor: Editor;
  canWrite: boolean;
  close: () => void;
  done: () => void;
  error: (x: string) => void;
}) {
  const [name, setName] = useState(editor.current || "");
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const expected =
    editor.mode === "create"
      ? "SALVAR CONFIGURAÇÃO"
      : editor.mode === "rename"
        ? "RENOMEAR CONFIGURAÇÃO"
        : "EXCLUIR CONFIGURAÇÃO";
  const execute = async () => {
    setBusy(true);
    try {
      const guard = { canWrite, confirmation: { confirmed: true, phrase } };
      if (editor.mode === "create")
        await api.createPurchaseSetting(
          editor.kind,
          editor.parentId || null,
          name,
          guard,
        );
      if (editor.mode === "rename")
        await api.renamePurchaseSetting(
          editor.kind,
          editor.id || 0,
          name,
          guard,
        );
      if (editor.mode === "delete")
        await api.deletePurchaseSetting(editor.kind, editor.id || 0, guard);
      done();
    } catch (e) {
      error(e instanceof Error ? e.message : "Falha ao alterar configuração.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-3">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Alterar configuração de compras"
        className="w-full max-w-lg rounded-md bg-white p-4"
      >
        <button
          aria-label="Fechar"
          onClick={close}
          className="float-right grid size-11 place-items-center"
        >
          <X />
        </button>
        <h2 className="text-xl font-bold">
          {editor.mode === "create"
            ? "Adicionar"
            : editor.mode === "rename"
              ? "Renomear"
              : "Excluir"}{" "}
          {editor.kind}
        </h2>
        <div className="mt-4 space-y-3">
          {editor.mode !== "delete" ? (
            <label className="block">
              Nome
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 min-h-11 w-full rounded border px-3"
              />
            </label>
          ) : (
            <p className="rounded bg-red-50 p-3">
              Excluir <b>{editor.current}</b>? Dependências podem fazer o
              backend recusar a exclusão.
            </p>
          )}
          <label className="block rounded border border-amber-300 bg-amber-50 p-3">
            Digite <b>{expected}</b>
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              className="mt-2 min-h-11 w-full rounded border px-3"
            />
          </label>
          <button
            disabled={
              busy ||
              phrase !== expected ||
              (editor.mode !== "delete" && !name.trim())
            }
            onClick={() => void execute()}
            className="min-h-11 w-full rounded bg-blue-700 font-bold text-white disabled:opacity-40"
          >
            Confirmar alteração
          </button>
        </div>
      </section>
    </div>
  );
}
