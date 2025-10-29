(function(){
  const $ = (sel) => document.querySelector(sel);
  const input = $('#iappId');
  const btn = $('#btnBuscar');
  const out = $('#out');

  async function buscar(){
    const id = (input.value||'').trim();
    if(!id){
      out.textContent = 'Informe um ID numérico.';
      input.focus();
      return;
    }
    btn.disabled = true;
    out.textContent = 'Consultando...';
    try{
      const r = await fetch(`/api/iapp/ordens-producao/busca/${encodeURIComponent(id)}`);
      const j = await r.json().catch(()=>({raw:'<não-json>'}));
      if(!r.ok){
        out.textContent = JSON.stringify(j, null, 2);
      } else {
        out.textContent = JSON.stringify(j, null, 2);
      }
    } catch(e){
      out.textContent = String(e);
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', buscar);
  input.addEventListener('keydown', (ev)=>{
    if(ev.key==='Enter') buscar();
  });
})();
