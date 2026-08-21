import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Download,
  ExternalLink,
  Monitor,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react";
import {
  printAgentGateway,
  type Agent,
  type AgentConfig,
  type Field,
  type Layout,
  type LayoutDraft,
  type LayoutMeta,
} from "../../services/printAgentGateway";
import "./print-agent-config.css";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
function draftOf(l: Layout): LayoutDraft {
  return {
    chave: l.chave,
    nome: l.nome,
    labelWidth: l.labelWidth || 50,
    labelHeight: l.labelHeight || 30,
    darkness: l.darkness ?? 20,
    speed: l.speed ?? 4,
    offsetX: l.offsetX || 0,
    offsetY: l.offsetY || 0,
    dpi: l.dpi || 203,
    zplTemplate: l.zplTemplate || "",
    campos: clone(l.campos || []),
    amostra: clone(l.amostra || {}),
  };
}
export function PrintAgentConfigScreen() {
  const [agents, setAgents] = useState<Agent[]>([]),
    [configs, setConfigs] = useState<AgentConfig[]>([]),
    [meta, setMeta] = useState<LayoutMeta | null>(null),
    [download, setDownload] = useState<{ url: string; versao: string } | null>(
      null,
    ),
    [selected, setSelected] = useState<Layout | null>(null),
    [draft, setDraft] = useState<LayoutDraft | null>(null),
    [mode, setMode] = useState<"easy" | "advanced">("easy"),
    [preview, setPreview] = useState<{
      imageBase64: string;
      zpl: string;
    } | null>(null),
    [printer, setPrinter] = useState(""),
    [status, setStatus] = useState("Carregando configuração…"),
    [tab, setTab] = useState<"layouts" | "agents">("layouts");
  const load = async () => {
    setStatus("Carregando configuração…");
    try {
      const [a, c, l, u] = await Promise.all([
        printAgentGateway.listAgents(),
        printAgentGateway.listConfigs(),
        printAgentGateway.getLayouts(),
        printAgentGateway.getAgentUrl(),
      ]);
      setAgents(a);
      setConfigs(c);
      setMeta(l);
      setDownload(u);
      setStatus("");
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  useEffect(() => {
    void Promise.resolve().then(load);
  }, []);
  const groups = useMemo(() => {
    const m = new Map<string, Layout[]>();
    for (const l of meta?.layouts || []) {
      const k = l.tipoBase || l.chave;
      m.set(k, [...(m.get(k) || []), l]);
    }
    return [...m];
  }, [meta]);
  const printers = agents.flatMap((a) =>
    a.printers.map((p) => ({
      value: `${a.pcName}\u001f${p}`,
      label: `${a.printerAliases?.[p] || p} · ${a.pcName}`,
    })),
  );
  const edit = (l: Layout) => {
    setSelected(l);
    setDraft(draftOf(l));
    setMode("easy");
    setPreview(null);
  };
  const changed = Boolean(
    draft &&
    selected &&
    JSON.stringify(draft) !== JSON.stringify(draftOf(selected)),
  );
  const switchMode = (next: "easy" | "advanced") => {
    if (next === mode) return;
    if (
      changed &&
      !window.confirm("Alternar editor mantendo o rascunho atual?")
    )
      return;
    setMode(next);
  };
  const doPreview = async () => {
    if (!draft) return;
    setStatus("Gerando preview com dados de amostra…");
    try {
      const p = await printAgentGateway.preview(
        mode === "advanced"
          ? { ...draft, campos: [] }
          : { ...draft, zplTemplate: "" },
      );
      setPreview(p);
      setStatus(
        "Preview gerado com dados de amostra; nenhuma configuração foi salva.",
      );
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const save = async () => {
    if (
      !draft ||
      !preview ||
      !window.confirm(`Salvar alterações no perfil ${draft.nome}?`)
    )
      return;
    try {
      await printAgentGateway.saveLayout(
        mode === "advanced"
          ? { ...draft, campos: [], zplTemplate: preview.zpl }
          : { ...draft, zplTemplate: preview.zpl },
        true,
      );
      setStatus("Perfil salvo.");
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const duplicate = async (l: Layout) => {
    const name = window.prompt("Nome do novo perfil", `${l.nome} - cópia`);
    if (
      !name ||
      !window.confirm(`Criar perfil "${name}" a partir de ${l.nome}?`)
    )
      return;
    try {
      await printAgentGateway.createProfile(
        {
          nome: name,
          cloneFrom: l.chave,
          labelWidth: l.labelWidth,
          labelHeight: l.labelHeight,
        },
        true,
      );
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const remove = async (l: Layout) => {
    if (!l.isProfile)
      return setStatus("Preset interno protegido contra exclusão.");
    if (!window.confirm(`Excluir o perfil personalizado ${l.nome}?`)) return;
    try {
      await printAgentGateway.deleteProfile(l, true);
      await load();
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  const testPrint = async () => {
    if (!preview || !draft || !printer)
      return setStatus("Gere o preview e escolha uma impressora explícita.");
    if (
      !window.confirm(
        "Enviar uma etiqueta de teste? Esta ação não consome ID operacional.",
      )
    )
      return;
    const i = printer.indexOf("\u001f");
    try {
      const r = await printAgentGateway.testPrint(
        {
          zpl: preview.zpl,
          destinoAgente: printer.slice(0, i),
          impressora: printer.slice(i + 1),
          perfil: draft.chave,
        },
        true,
      );
      setStatus(`Teste enfileirado sob #${r.filaId}.`);
    } catch (e) {
      setStatus((e as Error).message);
    }
  };
  return (
    <section className="pac-shell">
      <header>
        <div>
          <span>Administração · Etiquetas</span>
          <h1>
            <Printer />
            Configurador do agente
          </h1>
        </div>
        <div className="pac-actions">
          <button onClick={() => void load()}>
            <RefreshCw />
            Atualizar
          </button>
          {download?.url ? (
            <>
              <a href={download.url} download>
                <Download />
                Baixar agente v{download.versao}
              </a>
              <a href="http://127.0.0.1:9200" target="_blank" rel="noreferrer">
                <ExternalLink />
                Abrir agente
              </a>
            </>
          ) : (
            <span>Instalador indisponível</span>
          )}
        </div>
      </header>
      {status && (
        <p className="pac-status" role="status">
          {status}
        </p>
      )}
      <nav>
        <button
          className={tab === "layouts" ? "active" : ""}
          onClick={() => setTab("layouts")}
        >
          Perfis e presets
        </button>
        <button
          className={tab === "agents" ? "active" : ""}
          onClick={() => setTab("agents")}
        >
          Agentes e impressoras
        </button>
      </nav>
      {tab === "layouts" ? (
        <div className="pac-columns">
          <aside>
            {groups.map(([key, ls]) => (
              <section key={key}>
                <h2>
                  {meta?.layoutTypes.find((t) => t.chave === key)?.nome || key}
                </h2>
                {ls.map((l) => (
                  <article
                    className={selected?.chave === l.chave ? "selected" : ""}
                    key={l.chave}
                  >
                    <button onClick={() => edit(l)}>
                      <b>{l.nome}</b>
                      <small>
                        {l.isProfile
                          ? "Perfil personalizado"
                          : "Preset do sistema"}{" "}
                        · {l.labelWidth}×{l.labelHeight} mm
                      </small>
                    </button>
                    <button
                      aria-label={`Duplicar ${l.nome}`}
                      onClick={() => void duplicate(l)}
                    >
                      <Copy />
                    </button>
                    <button
                      aria-label={`Excluir ${l.nome}`}
                      disabled={!l.isProfile}
                      onClick={() => void remove(l)}
                    >
                      <Trash2 />
                    </button>
                  </article>
                ))}
              </section>
            ))}
          </aside>
          <main>
            {draft ? (
              <Editor
                draft={draft}
                setDraft={setDraft}
                mode={mode}
                switchMode={switchMode}
                meta={meta}
                preview={preview}
              />
            ) : (
              <div className="pac-empty">
                <Plus />
                <p>Selecione um perfil ou preset para editar ou duplicar.</p>
              </div>
            )}
            {draft && (
              <footer>
                <button onClick={() => void doPreview()}>Ver como fica</button>
                <select
                  aria-label="Impressora do teste"
                  value={printer}
                  onChange={(e) => setPrinter(e.target.value)}
                >
                  <option value="">Escolha a impressora do teste</option>
                  {printers.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  disabled={!preview || !printer}
                  onClick={() => void testPrint()}
                >
                  Impressão de teste
                </button>
                <button
                  className="primary"
                  disabled={!preview}
                  onClick={() => void save()}
                >
                  <Save />
                  Salvar confirmado
                </button>
              </footer>
            )}
          </main>
        </div>
      ) : (
        <AgentPanel
          key={JSON.stringify(configs)}
          agents={agents}
          configs={configs}
          layouts={meta?.layouts || []}
          onStatus={setStatus}
        />
      )}
    </section>
  );
}
function Editor({
  draft,
  setDraft,
  mode,
  switchMode,
  meta,
  preview,
}: {
  draft: LayoutDraft;
  setDraft: (d: LayoutDraft) => void;
  mode: "easy" | "advanced";
  switchMode: (m: "easy" | "advanced") => void;
  meta: LayoutMeta | null;
  preview: { imageBase64: string; zpl: string } | null;
}) {
  const update = (k: keyof LayoutDraft, v: unknown) => {
    setDraft({ ...draft, [k]: v });
  };
  return (
    <div className="pac-editor">
      <div className="pac-form">
        <label>
          Nome
          <input
            value={draft.nome}
            onChange={(e) => update("nome", e.target.value)}
          />
        </label>
        {(["labelWidth", "labelHeight", "dpi", "darkness"] as const).map(
          (k) => (
            <label key={k}>
              {k}
              <input
                type="number"
                value={draft[k]}
                onChange={(e) => update(k, Number(e.target.value))}
              />
            </label>
          ),
        )}
      </div>
      <div className="pac-mode">
        <button
          className={mode === "easy" ? "active" : ""}
          onClick={() => switchMode("easy")}
        >
          Modo fácil
        </button>
        <button
          className={mode === "advanced" ? "active" : ""}
          onClick={() => switchMode("advanced")}
        >
          ZPL avançado
        </button>
      </div>
      {mode === "easy" ? (
        <div className="pac-fields">
          {draft.campos.map((f, i) => (
            <div key={f.id}>
              <select
                value={f.tipo}
                onChange={(e) => {
                  const a = clone(draft.campos);
                  a[i].tipo = e.target.value as Field["tipo"];
                  update("campos", a);
                }}
              >
                {meta?.fieldTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select
                value={f.orientacao || "N"}
                onChange={(e) => {
                  const a = clone(draft.campos);
                  a[i].orientacao = e.target.value as Field["orientacao"];
                  update("campos", a);
                }}
              >
                <option value="N">0°</option>
                <option value="R">90°</option>
                <option value="I">180°</option>
                <option value="B">270°</option>
              </select>
              {(["x", "y"] as const).map((k) => (
                <input
                  aria-label={`${k} ${i + 1}`}
                  key={k}
                  type="number"
                  value={f[k]}
                  onChange={(e) => {
                    const a = clone(draft.campos);
                    a[i][k] = Number(e.target.value);
                    update("campos", a);
                  }}
                />
              ))}
              <input
                aria-label={`Tamanho ${i + 1}`}
                type="number"
                value={f.tipo === "qr" ? f.magnificacao || 3 : f.fonteH || 24}
                onChange={(e) => {
                  const a = clone(draft.campos);
                  if (a[i].tipo === "qr") a[i].magnificacao = Number(e.target.value);
                  else {
                    a[i].fonteH = Number(e.target.value);
                    a[i].fonteW = Number(e.target.value);
                  }
                  update("campos", a);
                }}
              />
              <input
                aria-label={`Conteúdo ${i + 1}`}
                value={f.conteudo}
                onChange={(e) => {
                  const a = clone(draft.campos);
                  a[i].conteudo = e.target.value;
                  update("campos", a);
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <>
          <textarea
            aria-label="Template ZPL integral"
            value={draft.zplTemplate || ""}
            onChange={(e) => update("zplTemplate", e.target.value)}
          />
          <p className="pac-vars">
            Variáveis:{" "}
            {(meta?.layouts[0]?.placeholders || [])
              .map((x) => `{{${x}}}`)
              .join(", ")}
          </p>
        </>
      )}
      <section className="pac-preview">
        <b>Preview · dados de amostra</b>
        {preview ? (
          <>
            <img
              src={preview.imageBase64}
              alt="Preview da etiqueta com dados de amostra"
            />
            <details>
              <summary>ZPL gerado</summary>
              <pre>{preview.zpl}</pre>
            </details>
          </>
        ) : (
          <p>Gere a prévia antes de salvar ou imprimir.</p>
        )}
      </section>
    </div>
  );
}
function AgentPanel({
  agents,
  configs,
  layouts,
  onStatus,
}: {
  agents: Agent[];
  configs: AgentConfig[];
  layouts: Layout[];
  onStatus: (s: string) => void;
}) {
  const [drafts, setDrafts] = useState(() => configs.map(clone));
  const change = (pcName: string, fn: (c: AgentConfig) => void) =>
    setDrafts((ds) =>
      ds.map((c) => {
        if (c.pcName !== pcName) return c;
        const n = clone(c);
        fn(n);
        return n;
      }),
    );
  const save = async (c: AgentConfig) => {
    if (!window.confirm(`Salvar configuração de ${c.pcName}?`)) return;
    try {
      await printAgentGateway.saveAgentConfig(c, true);
      onStatus(`Configuração de ${c.pcName} salva.`);
    } catch (e) {
      onStatus((e as Error).message);
    }
  };
  return (
    <div className="pac-agent-grid">
      {drafts.map((c) => {
        const live = agents.find((a) => a.pcName === c.pcName),
          available = live?.printers || c.printersOnline || [];
        return (
          <article key={c.pcName}>
            <header>
              <Monitor />
              <div>
                <b>{c.pcName}</b>
                <small>
                  {live ? "Online agora" : "Offline"} · v
                  {live?.version || c.version || "—"}
                </small>
              </div>
            </header>
            <label>
              Impressora
              <select
                value={c.printer}
                onChange={(e) =>
                  change(c.pcName, (n) => {
                    n.printer = e.target.value;
                  })
                }
              >
                <option value="">Nenhuma</option>
                {available.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <div className="pac-agent-nums">
              {(
                [
                  "labelWidth",
                  "labelHeight",
                  "darkness",
                  "speed",
                  "labelOffsetX",
                  "labelOffsetY",
                ] as const
              ).map((k) => (
                <label key={k}>
                  {k}
                  <input
                    type="number"
                    value={c[k]}
                    onChange={(e) =>
                      change(c.pcName, (n) => {
                        n[k] = Number(e.target.value);
                      })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Perfil da impressora
              <select
                value={c.printerConfigs?.[c.printer]?.layoutProfile || ""}
                disabled={!c.printer}
                onChange={(e) =>
                  change(c.pcName, (n) => {
                    n.printerConfigs = {
                      ...n.printerConfigs,
                      [n.printer]: {
                        ...n.printerConfigs?.[n.printer],
                        layoutProfile: e.target.value,
                      },
                    };
                  })
                }
              >
                <option value="">Padrão</option>
                {layouts.map((l) => (
                  <option key={l.chave} value={l.chave}>
                    {l.nome}
                  </option>
                ))}
              </select>
            </label>
            <button className="primary" onClick={() => void save(c)}>
              <Save />
              Salvar computador
            </button>
          </article>
        );
      })}
      {!drafts.length && <p>Nenhum agente configurado.</p>}
    </div>
  );
}
