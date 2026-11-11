const KEY='financas-da-casa-v1';
const initial={transactions:[],cards:[],reimbursements:[],reserve:[],school:[]};
let data=load();
function load(){try{return {...initial,...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return structuredClone(initial)}}
function save(){localStorage.setItem(KEY,JSON.stringify(data));render()}
const brl=v=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(v)||0);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
function add(form,key,map){form.addEventListener('submit',e=>{e.preventDefault();const f=new FormData(form);data[key].push({id:crypto.randomUUID(),...map(f)});form.reset();save()})}
add(transactionForm,'transactions',f=>({description:f.get('description'),amount:+f.get('amount'),date:f.get('date'),type:f.get('type'),category:f.get('category')}));
add(cardForm,'cards',f=>({description:f.get('description'),card:f.get('card'),amount:+f.get('amount'),current:+f.get('current'),total:+f.get('total')}));
add(reimbursementForm,'reimbursements',f=>({description:f.get('description'),paid:+f.get('paid'),expected:+f.get('expected'),status:f.get('status')}));
add(reserveForm,'reserve',f=>({description:f.get('description'),amount:+f.get('amount'),type:f.get('type')}));
add(schoolForm,'school',f=>({description:f.get('description'),amount:+f.get('amount')}));
function del(key,id){data[key]=data[key].filter(x=>x.id!==id);save()}
window.del=del;
function items(id,key,body){document.getElementById(id).innerHTML=data[key].map(x=>`<div class="item"><div>${body(x)}</div><button class="delete" onclick="del('${key}','${x.id}')">Excluir</button></div>`).join('')||'<p>Nenhum registro.</p>'}
function render(){
 const income=data.transactions.filter(x=>x.type==='income').reduce((s,x)=>s+x.amount,0);
 const expenses=data.transactions.filter(x=>x.type==='expense').reduce((s,x)=>s+x.amount,0);
 const benefits=data.transactions.filter(x=>x.type==='benefit').reduce((s,x)=>s+x.amount,0);
 const cardMonthly=data.cards.reduce((s,x)=>s+x.amount,0);
 const reserve=data.reserve.reduce((s,x)=>s+(x.type==='deposit'?x.amount:-x.amount),0);
 const receivable=data.reimbursements.filter(x=>x.status==='pending').reduce((s,x)=>s+x.expected,0);
 const school=data.school.reduce((s,x)=>s+x.amount,0);
 mIncome.textContent=brl(income);mExpense.textContent=brl(expenses+cardMonthly);mBalance.textContent=brl(income-expenses-cardMonthly);mBalance.style.color=income-expenses-cardMonthly>=0?'#2a9d8f':'#b64040';mBenefits.textContent=brl(benefits);mReserve.textContent=brl(reserve);mReceivable.textContent=brl(receivable);schoolText.textContent=`${brl(school)} de ${brl(2000)}`;schoolProgress.value=Math.min(school,2000);
 items('transactionList','transactions',x=>`<b>${esc(x.description)}</b><small>${esc(x.category||x.type)} · ${esc(x.date)}</small><div class="value">${brl(x.amount)}</div>`);
 items('cardList','cards',x=>`<b>${esc(x.description)}</b><small>${esc(x.card)} · parcela ${x.current}/${x.total}</small><div class="value">${brl(x.amount)}/mês</div>`);
 items('reimbursementList','reimbursements',x=>`<b>${esc(x.description)}</b><small>${x.status==='received'?'Recebido':'Pendente'} · custo líquido ${brl(x.paid-x.expected)}</small><div class="value">a receber ${brl(x.expected)}</div>`);
 items('reserveList','reserve',x=>`<b>${esc(x.description)}</b><small>${x.type==='deposit'?'Aporte':'Retirada'}</small><div class="value">${brl(x.amount)}</div>`);
 items('schoolList','school',x=>`<b>${esc(x.description)}</b><small>Destino: escola</small><div class="value">${brl(x.amount)}/mês</div>`);
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{document.querySelectorAll('nav button,.page').forEach(e=>e.classList.remove('active'));b.classList.add('active');document.getElementById(b.dataset.page).classList.add('active')});
exportBtn.onclick=()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`financas-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)};
importInput.onchange=async e=>{try{const parsed=JSON.parse(await e.target.files[0].text());data={...initial,...parsed};save();alert('Dados importados.')}catch{alert('Arquivo inválido.')}};
clearBtn.onclick=()=>{if(confirm('Apagar todos os dados salvos neste aparelho?')){data=structuredClone(initial);save()}};
let deferredPrompt;window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;installBtn.hidden=false});installBtn.onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;installBtn.hidden=true}};
if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('service-worker.js'));
render();