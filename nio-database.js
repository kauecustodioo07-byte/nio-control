/* NIO Control — persistence and authentication (separate Supabase project).
   Uses only the public/publishable browser key. Row-level security is enforced server-side. */
(async function () {
  'use strict';
  const PROJECT_URL = 'https://kphtftjgvvefjyvgbxzd.supabase.co';
  const PUBLIC_KEY = 'sb_publishable_aqONCUnJYpYHcCay86XG0g_5fuEVflP';
  const $ = id => document.getElementById(id);
  const html = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function message(text) { $('nioAuthMessage').textContent = text; }
  function showAuth() { $('nioAuth').hidden = false; $('nioLogout').hidden = true; }
  function hideAuth() { $('nioAuth').hidden = true; $('nioLogout').hidden = false; }
  if (!window.supabase?.createClient || !window.nioUI) {
    document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;z-index:99999;inset:0;background:#021014;color:#fff;display:grid;place-items:center">Não foi possível carregar o serviço do NIO. Recarregue com internet ativa.</div>');
    return;
  }
  const db = window.supabase.createClient(PROJECT_URL, PUBLIC_KEY);
  let user = null, busy = false;
  async function refresh() {
    if (!user) return;
    let offset = 0;
    const all = [];
    while (true) {
      const {data, error} = await db.from('indicacoes')
        .select('id,data,consultor,supervisor,cpf,indicador,status,created_at')
        .order('created_at', {ascending:false})
        .range(offset, offset + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }
    window.nioUI.setRows(all);
    $('importInfo').textContent = all.length + ' indicações salvas no banco NIO.';
  }
  async function initSession() {
    const {data,error} = await db.auth.getUser();
    if (error || !data?.user) {
      user = null;
      window.nioUI.setRows([]);
      showAuth();
      return;
    }
    user = data.user;
    hideAuth();
    $('nioUserEmail').textContent = user.email || 'Conta conectada';
    try {await refresh();}
    catch (err) {$('importInfo').textContent = 'Erro ao buscar registros: ' + err.message;}
  }
  $('nioLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    message('Verificando credenciais...');
    const email = $('nioEmail').value.trim();
    const password = $('nioPassword').value;
    const {error} = await db.auth.signInWithPassword({email, password});
    if (error) { message('Não foi possível entrar: ' + error.message); return; }
    message('');
    await initSession();
  });
  $('nioSignup').addEventListener('click', async () => {
    const email = $('nioEmail').value.trim(), password = $('nioPassword').value;
    if (!email || password.length < 6) {message('Informe e-mail e senha de pelo menos 6 caracteres.'); return;}
    message('Enviando confirmação...');
    const {data,error} = await db.auth.signUp({email,password});
    if (error) {message(error.message);return;}
    if (data.session) await initSession();
    else message('Conta solicitada. Confirme seu e-mail antes de entrar.');
  });
  $('nioLogout').addEventListener('click', async () => {await db.auth.signOut(); await initSession();});
  db.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      user = null; window.nioUI.setRows([]); showAuth();
    }
  });
  function parseCsv(text) {
    const first = text.split(/\r?\n/)[0] || '';
    const separator = (first.match(/;/g)||[]).length > (first.match(/,/g)||[]).length ? ';' : ',';
    const records = [], record = [];
    let field = '', quote = false;
    for (let i=0;i<text.length;i++) {
      const c = text[i];
      if (c === '"') {
        if (quote && text[i+1] === '"') {field += '"';i++;}
        else quote = !quote;
      } else if (c === separator && !quote) {record.push(field);field='';}
      else if ((c === '\n' || c === '\r') && !quote) {
        if (c === '\r' && text[i+1] === '\n') i++;
        record.push(field);
        if (record.some(Boolean)) records.push([...record]);
        record.length=0;field='';
      } else field+=c;
    }
    record.push(field);
    if (record.some(Boolean)) records.push(record);
    return records;
  }
  $('csvFile').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file || !user || busy) return;
    busy=true;
    try {
      const records=parseCsv(await file.text());
      if (records.length < 2) throw Error('CSV sem linhas de dados.');
      const headers=records.shift().map(x=>x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''));
      const value=(row, terms)=>{const i=headers.findIndex(h=>terms.some(t=>h.includes(t)));return i<0?'':String(row[i]||'').trim()};
      const items=records.map(row=>({
        data:value(row,['data','carimbo','timestamp']),
        consultor:value(row,['consultor']),
        supervisor:value(row,['supervisor']),
        cpf:value(row,['cpf do indicado','cpf indicado','cpf']).replace(/\D/g,''),
        indicador:value(row,['nome do indicador','nome indicador','indicador']),
        status:'importado', user_id:user.id
      }));
      if (!confirm('Salvar ' + items.length + ' registros no banco NIO? Importar duas vezes pode gerar duplicatas.')) return;
      let saved=0;
      for (let i=0;i<items.length;i+=100) {
        $('importInfo').textContent='Salvando '+saved+' de '+items.length+'...';
        const {error}=await db.from('indicacoes').insert(items.slice(i,i+100));
        if (error) {throw Error(error.message + '. Já salvos: '+saved);}
        saved+=Math.min(100,items.length-i);
      }
      await refresh();
      $('importInfo').textContent='Sucesso: '+saved+' novos registros salvos. Total: '+window.nioUI.count()+'.';
    } catch(error) {
      $('importInfo').textContent='Erro na importação: '+error.message+' Confira os registros antes de tentar novamente.';
    } finally {busy=false; event.target.value='';}
  });
  $('clear').textContent='Atualizar registros do banco';
  $('clear').addEventListener('click',async()=>{if(!user)return;try{await refresh()}catch(e){$('importInfo').textContent=e.message;}});
  await initSession();
})();