import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, FileDown, Plus, X } from 'lucide-react';
import { calendarGateway, type CalendarReservation, type ReservationPayload } from '../../services/calendarGateway';
import './calendar.css';

const weekdays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const label = (date: Date) => date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const empty = (data: string): ReservationPayload => ({ data, tipo: 'Auditório', tema: '', inicio: '08:00', fim: '09:00', repetir: false, repetirTodosMeses: false, diasSemana: [], cafe: false, avisoEmail: false, avisoWhatsapp: false, criadoPor: '', participantes: [], participantesAvisos: {}, descricao: null, visitantes: null, linkReuniao: null, anexoUrl: null, anexoNome: null });

export type CalendarFocus = { date?: string; reservationId?: number; requestId: number };

export function CalendarScreen({ currentUser = '', focus = null }: { currentUser?: string; focus?: CalendarFocus | null }) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [reservations, setReservations] = useState<CalendarReservation[]>([]);
  const [notices, setNotices] = useState<Array<{id:number;data:string;texto:string}>>([]);
  const [selected, setSelected] = useState<CalendarReservation | null>(null);
  const [form, setForm] = useState<ReservationPayload | null>(null);
  const [tab, setTab] = useState<'evento'|'ata'|'notas'|'presenca'>('evento');
  const [status, setStatus] = useState('Carregando agenda…');
  const handledFocus = useRef<number | null>(null);
  const today = iso(new Date());
  const load = useCallback(async () => { setStatus('Carregando agenda…'); try { const data = await calendarGateway.listMonth(month.getFullYear(), month.getMonth()+1, currentUser); setReservations(data.reservations); setNotices(data.notices); setStatus(''); } catch(e) { setStatus(e instanceof Error ? e.message : 'Falha ao carregar agenda'); } }, [month, currentUser]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  const days = useMemo(() => { const first = new Date(month); const out:(Date|null)[] = Array(first.getDay()).fill(null); for(let d=1; d<=new Date(month.getFullYear(), month.getMonth()+1,0).getDate(); d++) out.push(new Date(month.getFullYear(),month.getMonth(),d)); return out; }, [month]);
  const openDay = (day: string) => { setSelected(null); setForm({ ...empty(day), criadoPor: currentUser }); setTab('evento'); };
  const openEvent = (event: CalendarReservation) => { setSelected(event); setForm({ ...empty(event.data), ...event, avisoEmail:false, avisoWhatsapp:false, participantesAvisos:{}, anexoUrl:null, anexoNome:null }); setTab('evento'); };
  useEffect(() => {
    if (!focus?.date) return;
    const date = new Date(`${focus.date}T00:00:00`);
    if (!Number.isNaN(date.getTime())) setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }, [focus?.requestId, focus?.date]);
  useEffect(() => {
    if (!focus || handledFocus.current === focus.requestId) return;
    if (focus.reservationId) {
      const event = reservations.find((item) => item.id === focus.reservationId);
      if (!event) return;
      openEvent(event);
    } else if (focus.date) {
      openDay(focus.date);
    }
    handledFocus.current = focus.requestId;
  }, [focus, reservations]);
  const save = async () => { if (!form?.tema.trim() || !form.criadoPor.trim()) return setStatus('Tema e responsável são obrigatórios.'); if (!window.confirm(`Confirmar ${selected ? 'alteração' : 'registro'} de ${form.tipo} em ${form.data}?`)) return; try { if(form.tipo==='Lembrete') await calendarGateway.createNotice({data:form.data,texto:form.tema,destinatarios:form.participantes.length?form.participantes:[form.criadoPor]},true); else if(selected) await calendarGateway.updateReservation(selected.id, form, true); else await calendarGateway.createReservation(form, true); setForm(null); setSelected(null); await load(); } catch(e) { setStatus(e instanceof Error ? e.message : 'Falha ao salvar'); } };
  const printMinutes = () => window.print();
  return <section className="tc-shell" aria-label="Calendário e reservas">
    <header className="tc-header"><div><span className="tc-eyebrow">Agenda corporativa</span><h1><CalendarDays size={22}/> Calendário</h1></div><button className="tc-primary" onClick={()=>openDay(today)}><Plus size={16}/> Nova reserva</button></header>
    <div className="tc-toolbar"><button aria-label="Mês anterior" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}><ChevronLeft/></button><strong>{label(month)}</strong><button aria-label="Próximo mês" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}><ChevronRight/></button></div>
    {status && <p className="tc-status" role="status">{status}</p>}
    <div className="tc-weekdays">{weekdays.map(x=><span key={x}>{x}</span>)}</div>
    <div className="tc-grid">{days.map((date,i)=> date ? (()=>{ const key=iso(date), events=reservations.filter(r=>r.data===key), reminders=notices.filter(r=>r.data===key), past=key<today; return <button key={key} className={`tc-day ${past?'is-past':''} ${key===today?'is-today':''}`} onClick={()=>openDay(key)}><b>{date.getDate()}</b><span className="tc-mobile-date">{date.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit'})}</span>{events.map(e=><span key={`${e.id}-${e.inicio}`} className={`tc-event ${e.cancelada?'is-cancelled':''}`} onClick={x=>{x.stopPropagation();openEvent(e)}}>{e.inicio} {e.tema}</span>)}{reminders.map(r=><span key={r.id} className="tc-reminder">• {r.texto}</span>)}</button>})() : <span className="tc-day is-empty" key={`x${i}`}/> )}</div>
    {form && <div className="tc-backdrop" role="presentation"><div className="tc-modal" role="dialog" aria-modal="true" aria-label="Reserva e reunião"><header><div><span className="tc-eyebrow">{form.data}</span><h2>{selected?'Detalhes do evento':'Nova reserva'}</h2></div><button aria-label="Fechar" onClick={()=>setForm(null)}><X/></button></header>
      {selected && <nav className="tc-tabs">{(['evento','ata','notas','presenca'] as const).map(t=><button className={tab===t?'active':''} onClick={()=>setTab(t)} key={t}>{t==='evento'?'Evento':t==='ata'?'Ata':t==='notas'?'Anotações':'Presença'}</button>)}</nav>}
      {tab==='evento' && <div className="tc-form">
        <label>Tipo<select value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}><option>Auditório</option><option>Sala de reunião</option><option>Reunião online</option><option>Visita</option><option>Evento</option><option>Lembrete</option></select></label>
        <label className="wide">Tema<input value={form.tema} onChange={e=>setForm({...form,tema:e.target.value})}/></label>
        <label>Início<input type="time" value={form.inicio} onChange={e=>setForm({...form,inicio:e.target.value})}/></label>
        <label>Duração<select value={(Number(form.fim.slice(0,2))*60+Number(form.fim.slice(3,5)))-(Number(form.inicio.slice(0,2))*60+Number(form.inicio.slice(3,5)))} onChange={e=>{const [h,m]=form.inicio.split(':').map(Number), total=h*60+m+Number(e.target.value);setForm({...form,fim:`${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}`})}}><option value="30">30 minutos</option><option value="60">1 hora</option><option value="90">1h30</option><option value="120">2 horas</option></select></label>
        <label className="wide">Responsável<input value={form.criadoPor} onChange={e=>setForm({...form,criadoPor:e.target.value})}/></label>
        <label className="wide">Participantes (separados por vírgula)<input value={form.participantes.join(', ')} onChange={e=>setForm({...form,participantes:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></label>
        <label>Visitantes<input value={form.visitantes||''} onChange={e=>setForm({...form,visitantes:e.target.value||null})}/></label>
        <label>Link da reunião<input type="url" value={form.linkReuniao||''} onChange={e=>setForm({...form,linkReuniao:e.target.value||null})}/></label>
        <label className="wide">Descrição<textarea value={form.descricao||''} onChange={e=>setForm({...form,descricao:e.target.value||null})}/></label>
        <label className="check"><input type="checkbox" checked={form.cafe} onChange={e=>setForm({...form,cafe:e.target.checked})}/> Solicitar café</label>
        <label className="check"><input type="checkbox" checked={form.repetir} onChange={e=>setForm({...form,repetir:e.target.checked})}/> Repetir semanalmente</label>
        <label className="check"><input type="checkbox" checked={form.repetirTodosMeses} onChange={e=>setForm({...form,repetirTodosMeses:e.target.checked})}/> Repetir mensalmente</label>
        <label className="check"><input type="checkbox" checked={form.avisoEmail} onChange={e=>setForm({...form,avisoEmail:e.target.checked})}/> Avisar por e-mail</label>
        <label className="check"><input type="checkbox" checked={form.avisoWhatsapp} onChange={e=>setForm({...form,avisoWhatsapp:e.target.checked})}/> Avisar por WhatsApp</label>
        {form.repetir&&<label className="wide">Dias da semana<input placeholder="seg, qua, sex" value={form.diasSemana.join(', ')} onChange={e=>setForm({...form,diasSemana:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})}/></label>}
        {selected ? <ReservationAttachments reservationId={selected.id}/> : null}
        <p className="tc-risk wide">Anexos existentes são exibidos abaixo. Não há endpoint comprovado para enviar arquivos neste fluxo, então nenhum upload é simulado.</p>
        <footer className="wide"><button onClick={()=>setForm(null)}>Cancelar</button><button className="tc-primary" onClick={()=>void save()}>Revisar e confirmar</button></footer>
      </div>}
      {tab==='ata' && <MeetingPanel id={selected!.id} kind="minutes" eventDate={selected!.data} participants={selected!.participantes} onPrint={printMinutes}/>} {tab==='notas'&&<MeetingPanel id={selected!.id} kind="notes" eventDate={selected!.data} participants={selected!.participantes}/>} {tab==='presenca'&&<MeetingPanel id={selected!.id} kind="attendance" eventDate={selected!.data} participants={selected!.participantes}/>}
    </div></div>}
  </section>;
}

function ReservationAttachments({reservationId}:{reservationId:number}) {
 const [items,setItems]=useState<Array<{id:number;url:string;nome:string}>>([]);
 useEffect(()=>{ void calendarGateway.listAttachments(reservationId).then(setItems).catch(()=>setItems([])); },[reservationId]);
 return <div className="wide tc-meeting"><h3>Anexos associados</h3>{items.length ? items.map(item=><a key={item.id} href={item.url} target="_blank" rel="noreferrer">{item.nome}</a>) : <p className="tc-status">Nenhum anexo associado.</p>}</div>;
}

function MeetingPanel({id,kind,eventDate,participants,onPrint}:{id:number;kind:'minutes'|'notes'|'attendance';eventDate:string;participants:string[];onPrint?:()=>void}) {
 const [items,setItems]=useState<Array<Record<string,unknown>>>([]); const [text,setText]=useState(''); const [theme,setTheme]=useState('Geral'); const [shared,setShared]=useState(false); const [present,setPresent]=useState(participants.join(', ')); const [absent,setAbsent]=useState(''); const [reminderDate,setReminderDate]=useState('');
 useEffect(()=>{ const p=kind==='minutes'?calendarGateway.listMinutes(id):kind==='notes'?calendarGateway.listNotes(id):calendarGateway.listAttendance(id); void p.then(x=>setItems(x as unknown as Array<Record<string,unknown>>)); },[id,kind]);
 const add=async()=>{ if(!text.trim()||!window.confirm('Confirmar gravação desta anotação?'))return; if(kind==='minutes') await calendarGateway.createMinute({reserva_id:id,tema:theme,conteudo:text},true); else if(kind==='notes') await calendarGateway.createNote({reserva_id:id,texto:text,anexo_url:null,anexo_nome:null,visivel_todos:shared},true); if(reminderDate) await calendarGateway.createNotice({data:reminderDate,texto:text, destinatarios:participants, apenas_mencionados:true, ata_id:kind==='minutes'?id:undefined},true); setText(''); setReminderDate(''); };
 const saveAttendance=async()=>{ if(!window.confirm('Confirmar registro de presença?'))return; await calendarGateway.setAttendance(id,{participantes:present.split(',').map(x=>x.trim()).filter(Boolean),ausentes:absent.split(',').map(x=>x.trim()).filter(Boolean),data_reuniao:eventDate},true); const result=await calendarGateway.listAttendance(id); setItems(result as unknown as Array<Record<string,unknown>>); };
 return <div className="tc-meeting"><div className="tc-meeting-title"><h3>{kind==='minutes'?'Ata da reunião':kind==='notes'?'Anotações privadas e compartilhadas':'Lista de presença'}</h3>{onPrint&&<button onClick={onPrint}><FileDown size={16}/> Gerar PDF</button>}</div>{items.length?items.map((x,i)=><article key={String(x.id||i)}><b>{String(x.tema||x.usuario||x.data_fmt||'Registro')}</b><p>{String(x.conteudo||x.texto||([...(x.participantes as string[]||[])].join(', '))||'')}</p></article>):<p className="tc-status">Nenhum registro.</p>}{kind!=='attendance'?<div className="tc-compose">{kind==='minutes'&&<label>Tema<input value={theme} onChange={e=>setTheme(e.target.value)}/></label>}<label>Anotação<textarea placeholder="Use @usuario para mencionar alguém" value={text} onChange={e=>setText(e.target.value)}/></label>{kind==='notes'&&<label className="check"><input type="checkbox" checked={shared} onChange={e=>setShared(e.target.checked)}/> Compartilhar com todos</label>}<label>Lembrete (opcional)<input type="date" value={reminderDate} onChange={e=>setReminderDate(e.target.value)}/></label><button className="tc-primary" onClick={()=>void add()}>Confirmar gravação</button></div>:<div className="tc-compose"><label>Presentes (separados por vírgula)<input value={present} onChange={e=>setPresent(e.target.value)}/></label><label>Ausentes (separados por vírgula)<input value={absent} onChange={e=>setAbsent(e.target.value)}/></label><button className="tc-primary" onClick={()=>void saveAttendance()}>Confirmar presença</button></div>}</div>;
}
