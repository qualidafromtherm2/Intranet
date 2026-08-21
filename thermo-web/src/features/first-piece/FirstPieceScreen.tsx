import { useState } from "react";
import { AlertTriangle, Image as ImageIcon, Search } from "lucide-react";
import * as gateway from "../../services/firstPieceGateway";
import type {
  FirstPieceItem,
  FirstPieceProduct,
  FirstPieceUser,
} from "./types";

export function FirstPieceScreen({ allowed = true }: { allowed?: boolean }) {
  const [query, setQuery] = useState("");
  const [product, setProduct] = useState<FirstPieceProduct | null>(null);
  const [items, setItems] = useState<FirstPieceItem[]>([]);
  const [users, setUsers] = useState<FirstPieceUser[]>([]);
  const [op, setOp] = useState("");
  const [liberator, setLiberator] = useState("");
  const [password, setPassword] = useState("");
  const [resolution, setResolution] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    error: boolean;
  } | null>(null);
  const hasNok = items.some((item) => item.resultado === "nok");
  const pending = items.filter((item) => item.resultado === null).length;

  if (!allowed)
    return (
      <section
        role="alert"
        className="rounded border border-amber-300 bg-amber-50 p-5"
      >
        <h1 className="font-bold">Acesso não permitido</h1>
        <p>Seu perfil não possui permissão para inspecionar a primeira peça.</p>
      </section>
    );

  const search = async () => {
    setBusy(true);
    setMessage(null);
    setProduct(null);
    setItems([]);
    setConfirmed(false);
    try {
      const found = await gateway.findFirstPieceProduct(query);
      setProduct(found);
      setItems(
        (found.itens || []).map((item) => ({ ...item, resultado: null })),
      );
      setOp("");
      gateway
        .loadFirstPieceUsers()
        .then(setUsers)
        .catch(() => setUsers([]));
    } catch (error) {
      setMessage({
        text:
          error instanceof Error ? error.message : "Falha ao buscar produto.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };
  const decide = (id: number, result: "ok" | "nok") => {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, resultado: item.resultado === result ? null : result }
          : item,
      ),
    );
    setConfirmed(false);
  };
  const submit = async () => {
    if (!product) return;
    setBusy(true);
    setMessage(null);
    try {
      await gateway.registerFirstPieceDecision(
        {
          codigo_produto: product.codigo_produto,
          numero_op: op.trim(),
          itens: items.map(({ id, o_que_verificar, resultado }) => ({
            id,
            o_que_verificar,
            resultado: resultado as "ok" | "nok",
          })),
          tem_nok: hasNok,
          ...(hasNok
            ? {
                user_liberacao: liberator,
                senha_liberacao: password,
                resolucao: resolution,
              }
            : {}),
        },
        { confirmed },
      );
      setMessage({ text: "Verificação registrada com sucesso.", error: false });
      setItems((current) =>
        current.map((item) => ({ ...item, resultado: null })),
      );
      setOp("");
      setPassword("");
      setResolution("");
      setConfirmed(false);
    } catch (error) {
      setMessage({
        text:
          error instanceof Error
            ? error.message
            : "Falha ao registrar verificação.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-[1440px] space-y-5 p-3 sm:p-6">
      <header>
        <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
          Produção · Qualidade
        </p>
        <h1 className="text-2xl font-bold">Primeira peça OK</h1>
        <p className="text-sm text-slate-600">
          Inspeção por produto e OP conforme critérios cadastrados.
        </p>
      </header>
      <form
        className="flex max-w-2xl flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <label className="flex-1">
          <span className="mb-1 block text-sm font-semibold">
            Código ou ID Omie do produto
          </span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ex: 09.MC.N.10106"
            className="min-h-11 w-full rounded border px-3"
          />
        </label>
        <button
          disabled={busy || !query.trim()}
          className="min-h-11 self-end rounded bg-emerald-700 px-5 font-bold text-white disabled:opacity-40"
        >
          <Search className="mr-2 inline size-4" />
          Buscar
        </button>
      </form>
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={`rounded border p-3 ${message.error ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}
        >
          {message.text}
        </p>
      )}
      {product && (
        <section className="space-y-4">
          <div className="rounded border bg-slate-50 p-4">
            <span className="text-xs text-slate-600">Produto</span>
            <h2 className="font-bold">
              {query} {product.descricao ? `— ${product.descricao}` : ""}
            </h2>
            <p className="text-sm text-slate-600">
              ID Omie: {product.codigo_produto}
            </p>
          </div>
          <label className="block max-w-sm">
            <span className="mb-1 block text-sm font-semibold">
              Número da OP *
            </span>
            <input
              value={op}
              onChange={(event) => {
                setOp(event.target.value);
                setConfirmed(false);
              }}
              className="min-h-11 w-full rounded border px-3"
            />
          </label>
          {!items.length ? (
            <p className="rounded border p-4 text-slate-600">
              Nenhum item de verificação cadastrado para este produto.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((item) => (
                <article
                  key={item.id}
                  className={`overflow-hidden rounded-md border-2 bg-white ${item.resultado === "ok" ? "border-emerald-500" : item.resultado === "nok" ? "border-red-500" : "border-slate-200"}`}
                >
                  {item.arquivo_url ? (
                    <a
                      href={item.arquivo_url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Abrir evidência de ${item.o_que_verificar}`}
                    >
                      <img
                        src={item.arquivo_url}
                        alt={`Evidência: ${item.o_que_verificar}`}
                        className="h-36 w-full bg-slate-100 object-contain"
                      />
                    </a>
                  ) : (
                    <div className="grid h-20 place-items-center bg-slate-50 text-slate-400">
                      <ImageIcon aria-hidden />
                    </div>
                  )}
                  <div className="space-y-3 p-3">
                    <h3 className="font-bold">{item.o_que_verificar}</h3>
                    {item.especificacao && (
                      <p className="text-sm text-slate-600">
                        {item.especificacao}
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        aria-pressed={item.resultado === "ok"}
                        onClick={() => decide(item.id, "ok")}
                        className="min-h-11 rounded border border-emerald-600 font-bold text-emerald-700 aria-pressed:bg-emerald-700 aria-pressed:text-white"
                      >
                        OK
                      </button>
                      <button
                        type="button"
                        aria-pressed={item.resultado === "nok"}
                        onClick={() => decide(item.id, "nok")}
                        className="min-h-11 rounded border border-red-600 font-bold text-red-700 aria-pressed:bg-red-700 aria-pressed:text-white"
                      >
                        NOK
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
          {hasNok && (
            <section className="space-y-3 rounded-md border border-red-300 bg-red-50 p-4">
              <h2 className="font-bold text-red-900">
                <AlertTriangle className="mr-2 inline size-5" />
                Itens NOK — liberação excepcional
              </h2>
              <label className="block">
                Usuário liberador
                <select
                  value={liberator}
                  onChange={(event) => {
                    setLiberator(event.target.value);
                    setConfirmed(false);
                  }}
                  className="mt-1 min-h-11 w-full rounded border px-2"
                >
                  <option value="">Selecione</option>
                  {users.map((user) => (
                    <option key={user.username}>{user.username}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                Senha do liberador
                <input
                  type="password"
                  autoComplete="off"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setConfirmed(false);
                  }}
                  className="mt-1 min-h-11 w-full rounded border px-3"
                />
              </label>
              <label className="block">
                Resolução / justificativa
                <textarea
                  value={resolution}
                  onChange={(event) => {
                    setResolution(event.target.value);
                    setConfirmed(false);
                  }}
                  rows={3}
                  className="mt-1 w-full rounded border p-3"
                />
              </label>
            </section>
          )}
          <section className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4">
            <p className="font-semibold">
              Resumo: {items.length - pending} de {items.length} itens avaliados
              · {items.filter((item) => item.resultado === "nok").length} NOK
            </p>
            <label className="flex gap-3">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>
                Confirmo o produto, a OP, todos os resultados e a liberação
                excepcional quando houver NOK.
              </span>
            </label>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={
                busy ||
                !confirmed ||
                pending > 0 ||
                !items.length ||
                !op.trim() ||
                (hasNok && (!liberator || !password || !resolution.trim()))
              }
              className="min-h-11 w-full rounded bg-emerald-700 px-5 font-bold text-white disabled:opacity-40"
            >
              Registrar verificação
            </button>
          </section>
        </section>
      )}
    </main>
  );
}
