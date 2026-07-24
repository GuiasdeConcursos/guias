/* ======================================================================
   CONFIGURAÇÃO
   ----------------------------------------------------------------------
   API_URL: endereço que devolve os dados (Google Apps Script).
   Troque aqui se o endereço mudar — o resto do código não precisa
   ser alterado.
   ====================================================================== */
const API_URL = "https://script.google.com/macros/s/AKfycbwK7Y6KxVxKkq2Lk08HBWtO5YXxG2tbvb1LWAglKfx9prDMgHO6Q7NGsM_2fSZtZr0/exec";

const COLORS = ['#5cd6d6', '#ffb454', '#4ade80', '#b39ddb', '#f87171', '#7fa8c9'];

let currentData = []; // [{ materia, assuntos: [{assunto, prioridade, link}] }]

document.getElementById('endpoint-line').textContent = API_URL.slice(0, 70) + '...';

/* ----------------------------------------------------------------------
   NORMALIZAÇÃO
   O Google Apps Script pode devolver o JSON em formatos um pouco
   diferentes dependendo de como foi escrito o script (array de objetos,
   objeto por aba, linhas cruas etc). Esta função tenta reconhecer os
   formatos mais comuns automaticamente. Se o seu retorno tiver um
   formato diferente, ajuste (ou peça ajuste) apenas dentro desta função.
   ---------------------------------------------------------------------- */
function normalize(json){
  // Formato real do Apps Script em uso:
  // [{ planilha: "Nome da matéria", linhas: [["Assunto","Prioridade","Link","Card","MMental"], ...] }, ...]
  if(Array.isArray(json) && json.length && json[0].planilha && Array.isArray(json[0].linhas)){
    return json.map(sheet => {
      const linhas = sheet.linhas || [];
      const assuntos = linhas
        .filter((row, idx) => {
          if(idx === 0 && String(row[0]).toLowerCase() === 'assunto') return false; // pula cabeçalho
          return row[0];
        })
        .map(row => {
          // Lógica inteligente para saber se a 2ª coluna é a Prioridade ou já é o Link (planilhas antigas)
          let prioridade = 'Média';
          let linkIdx = 1, cardIdx = 2, mmentalIdx = 3;
          
          if (row[1] && ['alta', 'média', 'media', 'baixa'].includes(String(row[1]).toLowerCase().trim())) {
            prioridade = String(row[1]).trim();
            linkIdx = 2; cardIdx = 3; mmentalIdx = 4;
          }

          return {
            assunto: row[0],
            prioridade: prioridade,
            link: row[linkIdx] || '',
            card: row[cardIdx] || '',
            mmental: row[mmentalIdx] || ''
          };
        });
      return { materia: sheet.planilha, assuntos };
    });
  }

  // Formato A: [{ materia: "...", assuntos: [{assunto, prioridade, link}, ...] }, ...]
  if(Array.isArray(json) && json.length && json[0].assuntos){
    return json.map(m => ({
      materia: m.materia || m.nome || m.name || 'Matéria',
      assuntos: (m.assuntos || []).map(normalizeAssunto)
    }));
  }

  // Formato B: objeto { "Nome da aba": [ {Assunto, Prioridade, Link}, ... ] }
  if(json && typeof json === 'object' && !Array.isArray(json)){
    const keys = Object.keys(json);
    if(keys.length && Array.isArray(json[keys[0]])){
      return keys.map(sheetName => {
        const rows = json[sheetName];
        const assuntos = rows
          .map(row => {
            if(Array.isArray(row)) {
              let prioridade = 'Média';
              let linkIdx = 1, cardIdx = 2, mmentalIdx = 3;
              if (row[1] && ['alta', 'média', 'media', 'baixa'].includes(String(row[1]).toLowerCase().trim())) {
                prioridade = String(row[1]).trim();
                linkIdx = 2; cardIdx = 3; mmentalIdx = 4;
              }
              return { assunto: row[0], prioridade, link: row[linkIdx] || '', card: row[cardIdx] || '', mmental: row[mmentalIdx] || '' };
            }
            return normalizeAssunto(row);
          })
          .filter(r => r.assunto && String(r.assunto).toLowerCase() !== 'assunto');
        return { materia: sheetName, assuntos };
      });
    }
  }

  // Formato C: array plano de linhas { materia/aba, assunto, prioridade, link }
  if(Array.isArray(json) && json.length && (json[0].assunto || json[0].Assunto)){
    const groups = {};
    json.forEach(row => {
      const materia = row.materia || row.aba || row.sheet || row.Materia || 'Matéria';
      const item = normalizeAssunto(row);
      if(!groups[materia]) groups[materia] = [];
      if(item.assunto) groups[materia].push(item);
    });
    return Object.keys(groups).map(materia => ({ materia, assuntos: groups[materia] }));
  }

  return null; // formato não reconhecido
}

function normalizeAssunto(obj){
  return {
    assunto: obj.assunto || obj.Assunto || obj.nome || obj.name || '',
    prioridade: obj.prioridade || obj.Prioridade || 'Média',
    link: obj.link || obj.Link || obj.url || obj.URL || '',
    card: obj.card || obj.Card || '',
    mmental: obj.mmental || obj.MMental || obj.mapaMental || obj['Mapa Mental'] || ''
  };
}

/* ---------------------------------------------------------------------- */

async function fetchData(manual){
  setStatus('pending', manual ? 'sincronizando...' : 'conectando...');
  const btn = document.getElementById('refresh-btn');
  btn.classList.add('spinning');

  try{
    const res = await fetch(API_URL, { method: 'GET' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const normalized = normalize(json);

    if(!normalized){
      throw new Error('FORMATO_NAO_RECONHECIDO');
    }

    currentData = normalized;
    setStatus('ok', 'conectado');
    updateMeta();
    try{
      await window.storage.set('ultimo-cache', JSON.stringify({ data: normalized, ts: Date.now() }));
    }catch(e){ /* cache é apenas um bônus, ignora falha */ }
    render();
  }catch(err){
    console.error(err);
    let cached = null;
    try{
      const r = await window.storage.get('ultimo-cache');
      if(r) cached = JSON.parse(r.value);
    }catch(e){ /* sem cache disponível */ }

    if(cached && cached.data){
      currentData = cached.data;
      setStatus('err', 'falha na sincronização — exibindo cache');
      updateMeta(cached.ts, true);
      render();
    }else{
      setStatus('err', 'falha na sincronização');
      renderError(err);
    }
  }finally{
    btn.classList.remove('spinning');
  }
}

function setStatus(state, text){
  const dot = document.getElementById('status-dot');
  dot.className = 'dot ' + state;
  document.getElementById('status-text').textContent = text;
}

function updateMeta(ts, isCache){
  const when = ts ? new Date(ts) : new Date();
  const formatted = when.toLocaleString('pt-BR');
  document.getElementById('meta-info').innerHTML =
    (isCache ? 'último cache local: ' : 'última sincronização: ') + '<b>' + formatted + '</b>';
}

function renderError(err){
  const content = document.getElementById('content');
  const msg = err.message === 'FORMATO_NAO_RECONHECIDO'
    ? 'A resposta chegou, mas em um formato de dados que este painel ainda não reconhece.'
    : 'Não foi possível buscar os dados no endereço configurado.';
  content.innerHTML = `
    <div class="grid">
      <div class="error-panel">
        <h3>✕ falha ao sincronizar</h3>
        <p>${msg} Verifique se a implantação do Apps Script está com acesso "Qualquer pessoa" habilitado, e se o endereço ainda é válido.</p>
        <details>
          <summary>detalhes técnicos</summary>
          <pre>${escapeHtml(String(err.message || err))}</pre>
        </details>
        <button class="btn-retry" onclick="fetchData(true)">Tentar novamente</button>
      </div>
    </div>`;
}

const ICONS = {
  conteudo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>',
  mmental: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>'
};

function actionButton(type, label, url){
  if(url){
    return `<a class="action-btn" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${ICONS[type]}<span>${label}</span></a>`;
  }
  return `<span class="action-btn disabled">${ICONS[type]}<span>${label}</span></span>`;
}

function render(){
  const content = document.getElementById('content');
  const search = document.getElementById('search').value.trim().toLowerCase();

  let materias = currentData;
  if(search){
    materias = materias
      .map(m => ({
        materia: m.materia,
        assuntos: m.assuntos.filter(a => a.assunto.toLowerCase().includes(search))
      }))
      .filter(m => m.assuntos.length > 0 || m.materia.toLowerCase().includes(search));
  }

  if(materias.length === 0){
    content.innerHTML = `<div class="grid"><div class="empty">Nenhuma matéria encontrada.</div></div>`;
    return;
  }

  content.innerHTML = `<div class="grid">` + materias.map((m, i) => {
    const color = COLORS[i % COLORS.length];
    return `
    <div class="card" style="--card-color:${color}">
      <div class="card-head">
        <div class="card-head-top">
          <h3>${escapeHtml(m.materia)}</h3>
          <span class="count-badge">${m.assuntos.length}</span>
        </div>
        <div class="node-tag">nó · matéria</div>
      </div>
      <div class="assunto-list">
        ${m.assuntos.map((a, idx) => {
          
          // Lógica para definir a classe CSS de acordo com a prioridade
          let priorityClass = "priority-media";
          const prio = a.prioridade ? a.prioridade.toLowerCase().replace('é', 'e') : "media";
          if (prio === "alta") priorityClass = "priority-alta";
          else if (prio === "baixa") priorityClass = "priority-baixa";

          return `
          <div class="assunto-row">
            <div class="assunto-top">
              <span class="assunto-idx">${String(idx+1).padStart(2,'0')}</span>
              <span class="assunto-nome">
                ${escapeHtml(a.assunto)}
                <span class="priority-badge ${priorityClass}">${escapeHtml(a.prioridade || 'Média')}</span>
              </span>
            </div>
            <div class="assunto-actions">
              ${actionButton('conteudo', 'Conteúdo', a.link)}
              ${actionButton('card', 'Card', a.card)}
              ${actionButton('mmental', 'Mapa Mental', a.mmental)}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('') + `</div>`;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s){
  return String(s).replace(/"/g, '&quot;');
}

document.getElementById('search').addEventListener('input', render);

fetchData(false);