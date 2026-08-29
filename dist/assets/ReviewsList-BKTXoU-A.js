var j=Object.defineProperty;var I=(t,e,r)=>e in t?j(t,e,{enumerable:!0,configurable:!0,writable:!0,value:r}):t[e]=r;var w=(t,e,r)=>I(t,typeof e!="symbol"?e+"":e,r);import{s as p,bF as F,v as q,q as g,w as x,bG as D,j as s,Y as _}from"./index-knfEs_Hp.js";import{M as O}from"./settings-Da1LdidR.js";const f=27,E=29,C=10,z={"58mm":32,"80mm":48};class R{constructor(e){w(this,"bytes",[]);w(this,"width");this.width=z[e],this.init()}push(...e){return this.bytes.push(...e),this}init(){return this.push(f,64)}setCodepage(){return this.push(f,116,3)}align(e){const r=e==="center"?1:e==="right"?2:0;return this.push(f,97,r)}bold(e){return this.push(f,69,e?1:0)}size(e){return this.push(E,33,e)}text(e){const r=e.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^\x20-\x7E\n]/g,"?");for(let i=0;i<r.length;i++)this.bytes.push(r.charCodeAt(i));return this}line(e=""){return this.text(e).push(C)}twoCols(e,r){const i=e.normalize("NFD").replace(/[\u0300-\u036f]/g,""),o=r.normalize("NFD").replace(/[\u0300-\u036f]/g,""),n=Math.max(1,this.width-i.length-o.length);return this.line(i+" ".repeat(n)+o)}divider(e="-"){return this.line(e.repeat(this.width))}feed(e=1){for(let r=0;r<e;r++)this.bytes.push(C);return this}cut(){return this.push(E,86,66,0)}beep(){return this.push(f,66,3,3)}build(){return new Uint8Array(this.bytes)}}const d=t=>`R$ ${t.toFixed(2).replace(".",",")}`;function A(t){const e=new R(t.paperWidth);if(e.setCodepage(),e.align("center").size(17).bold(!0).line(t.storeName).size(0).bold(!1),t.headerText&&e.line(t.headerText),e.divider("="),e.align("center").bold(!0).line(`PEDIDO #${t.orderShortId}`).bold(!1).line(new Date(t.createdAt).toLocaleString("pt-BR")).divider(),e.align("left").bold(!0).line("CLIENTE").bold(!1).line(t.customerName).line(t.customerPhone).feed(1),t.deliveryType==="delivery"){e.bold(!0).line("ENDERECO DE ENTREGA").bold(!1);const r=t.customerAddress||"",i=t.paperWidth==="58mm"?32:48;for(let o=0;o<r.length;o+=i)e.line(r.substring(o,o+i));e.feed(1)}else e.bold(!0).line("** RETIRADA NA LOJA **").bold(!1).feed(1);e.divider(),e.bold(!0).line("ITENS").bold(!1);for(const r of t.items){const i=r.quantity*r.product_price;if(e.line(`${r.quantity}x ${r.product_name}`),r.variant_name&&e.line(`   Opcao: ${r.variant_name}`),r.addons&&r.addons.length>0)for(const o of r.addons)e.line(`   + ${o.quantity}x ${o.name}${o.price>0?` (${d(o.price*o.quantity)})`:""}`);r.notes&&e.line(`   OBS: ${r.notes}`),e.twoCols(`   ${d(r.product_price)} cada`,d(i))}return e.divider(),e.twoCols("Subtotal:",d(t.subtotal)),t.deliveryFee>0&&e.twoCols("Taxa entrega:",d(t.deliveryFee)),t.discount>0&&e.twoCols("Desconto:",`- ${d(t.discount)}`),e.size(17).bold(!0).twoCols("TOTAL:",d(t.total)).size(0).bold(!1),e.divider(),e.bold(!0).line("PAGAMENTO").bold(!1).line(t.paymentMethod),t.changeFor&&t.changeFor>0&&(e.line(`Troco para: ${d(t.changeFor)}`),e.line(`Levar troco: ${d(t.changeFor-t.total)}`)),t.notes&&e.feed(1).divider().bold(!0).line("OBSERVACOES").bold(!1).line(t.notes),e.divider("=").align("center").line(t.footerText||"Obrigado pela preferencia!").feed(3).cut(),e.build()}function $(t){const e=new R(t.paperWidth);e.setCodepage(),e.align("center").size(17).bold(!0).line("** COZINHA **").size(0).bold(!1),e.line(`Pedido #${t.orderShortId}`).line(new Date(t.createdAt).toLocaleTimeString("pt-BR")),e.divider("="),e.align("left");for(const r of t.items){if(e.size(17).bold(!0).line(`${r.quantity}x ${r.product_name}`).size(0).bold(!1),r.variant_name&&e.line(`  >> ${r.variant_name}`),r.addons&&r.addons.length>0)for(const i of r.addons)e.line(`  + ${i.quantity}x ${i.name}`);r.notes&&e.bold(!0).line(`  OBS: ${r.notes}`).bold(!1),e.feed(1)}return t.notes&&e.divider().bold(!0).line("OBS:").bold(!1).line(t.notes),e.divider("=").align("center").line(`${t.customerName}`).feed(3).cut(),e.build()}const k=["000018f0-0000-1000-8000-00805f9b34fb","0000ff00-0000-1000-8000-00805f9b34fb","0000ffe0-0000-1000-8000-00805f9b34fb","49535343-fe7d-4ae5-8fa9-9fafd205e455"],B=["00002af1-0000-1000-8000-00805f9b34fb","0000ff02-0000-1000-8000-00805f9b34fb","0000ffe1-0000-1000-8000-00805f9b34fb","49535343-8841-43f4-a8d4-ecbe34729bb3"],y="lovable.printer.bluetoothId";let u=null,b=null;const M=()=>typeof navigator<"u"&&"bluetooth"in navigator;async function X(){if(!M())throw new Error("Bluetooth não é suportado neste navegador. Use Chrome no Android ou PC.");const t=await navigator.bluetooth.requestDevice({acceptAllDevices:!0,optionalServices:k});if(!t)throw new Error("Nenhum dispositivo selecionado");return u=t,localStorage.setItem(y,t.id),await v(t),{name:t.name||"Impressora",id:t.id}}async function v(t){const e=await t.gatt.connect();for(const r of k)try{const i=await e.getPrimaryService(r);for(const o of B)try{const n=await i.getCharacteristic(o);if(n.properties.write||n.properties.writeWithoutResponse)return b=n,n}catch{}}catch{}throw new Error("Impressora encontrada mas não foi possível identificar o canal de impressão. Verifique o modelo.")}async function L(){var e;if(b&&((e=u==null?void 0:u.gatt)!=null&&e.connected))return b;if(u)return await v(u);const t=localStorage.getItem(y);if(t&&navigator.bluetooth.getDevices)try{const i=(await navigator.bluetooth.getDevices()).find(o=>o.id===t);if(i)return u=i,await v(i)}catch{}throw new Error("Nenhuma impressora pareada. Pareie uma impressora primeiro nas configurações.")}async function K(t){const e=await L(),r=100;for(let i=0;i<t.length;i+=r){const o=t.slice(i,i+r);e.properties.writeWithoutResponse?await e.writeValueWithoutResponse(o):await e.writeValue(o),await new Promise(n=>setTimeout(n,20))}}const ee=()=>!!localStorage.getItem(y),te=()=>{localStorage.removeItem(y),u=null,b=null},S="lovable.printer.simulationMode",U=()=>localStorage.getItem(S)==="1",re=t=>{t?localStorage.setItem(S,"1"):localStorage.removeItem(S)};function Q(t){const e=[];let r=0;for(;r<t.length;){const i=t[r];if(i===27){const o=t[r+1];o===64?r+=2:o===116||o===97||o===69?r+=3:o===66?r+=4:r+=2;continue}if(i===29){const o=t[r+1];o===33?r+=3:o===86?r+=4:r+=2;continue}if(i===10){e.push(`
`),r++;continue}i>=32&&i<=126&&e.push(String.fromCharCode(i)),r++}return e.join("")}function W(t,e="80mm"){const r=Q(t),i=e==="58mm"?32:48,o=e==="58mm"?280:380,n=`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Simulação de cupom — ${e}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px;
    background: #1a1a1a;
    font-family: 'Segoe UI', system-ui, sans-serif;
    color: #fff;
    min-height: 100vh;
  }
  .header {
    max-width: ${o+80}px; margin: 0 auto 16px;
    text-align: center;
  }
  .header h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  .header p { margin: 0; font-size: 12px; color: #aaa; }
  .receipt-wrapper {
    max-width: ${o+80}px; margin: 0 auto;
    background: #fff;
    border-radius: 6px;
    padding: 24px 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
  }
  .receipt {
    width: ${o}px;
    margin: 0 auto;
    font-family: 'Courier New', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.4;
    color: #000;
    white-space: pre;
    word-wrap: break-word;
  }
  .actions {
    max-width: ${o+80}px; margin: 16px auto 0;
    display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;
  }
  button {
    background: #3B82F6; color: #fff; border: 0;
    padding: 10px 16px; border-radius: 6px;
    font-size: 13px; font-weight: 500; cursor: pointer;
    font-family: inherit;
  }
  button:hover { opacity: 0.9; }
  button.secondary { background: #374151; }
  .badge {
    display: inline-block;
    background: #10b981; color: #fff;
    padding: 4px 10px; border-radius: 999px;
    font-size: 11px; font-weight: 500;
    margin-left: 8px;
  }
  @media print {
    body { background: #fff; padding: 0; }
    .header, .actions { display: none; }
    .receipt-wrapper { box-shadow: none; padding: 0; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>🖨️ Simulação de cupom <span class="badge">${e} · ${i} cols</span></h1>
    <p>Esta é uma prévia de como o cupom sairia na impressora térmica real.</p>
  </div>
  <div class="receipt-wrapper">
    <div class="receipt">${r.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
  </div>
  <div class="actions">
    <button onclick="window.print()">🖨️ Imprimir nesta janela</button>
    <button class="secondary" onclick="navigator.clipboard.writeText(${JSON.stringify(r)}).then(() => alert('Copiado!'))">📋 Copiar texto</button>
    <button class="secondary" onclick="window.close()">Fechar</button>
  </div>
</body>
</html>`,a=window.open("","_blank","width=520,height=720,scrollbars=yes");if(!a)throw new Error("Popup bloqueado pelo navegador. Permita popups deste site para usar o modo simulação.");a.document.write(n),a.document.close()}async function h(t,e){if(U()){W(t,e);return}await K(t)}function G(t,e,r){const i=t.order_items.reduce((n,a)=>n+a.product_price*a.quantity,0),o=F(e.niche).thanks;return{storeName:e.name,headerText:e.printer_header_text||"",footerText:e.printer_footer_text||o,orderShortId:t.id.slice(0,8).toUpperCase(),createdAt:t.created_at,customerName:t.customer_name,customerPhone:t.customer_phone,deliveryType:t.delivery_type==="pickup"?"pickup":"delivery",customerAddress:t.customer_address,paymentMethod:t.payment_method,changeFor:t.change_for,items:t.order_items.map(n=>({product_name:n.product_name,product_price:n.product_price,quantity:n.quantity,variant_name:n.variant_name||null,addons:n.addons||null,notes:n.notes||null})),subtotal:i,deliveryFee:t.delivery_fee||0,discount:t.discount_amount||0,total:t.total,notes:t.delivery_status_note||"",paperWidth:r}}async function V(t,e,r={}){const i=r.paperWidth??e.printer_paper_width??"80mm",o=r.printKitchen??e.printer_kitchen_copy,n=G(t,e,i);if(await h(A(n),i),await new Promise(a=>setTimeout(a,600)),o){const a=Array.from(new Set(t.order_items.map(c=>c.product_name).filter(Boolean)));let T={};if(a.length){const{data:c}=await p.from("products").select("name, kitchen_sector").eq("tenant_id",e.id).in("name",a);(c||[]).forEach(l=>{l.kitchen_sector&&(T[l.name]=l.kitchen_sector)})}const m={};n.items.forEach(c=>{const l=T[c.product_name]||"cozinha";(m[l]||(m[l]=[])).push(c)});const N=Object.keys(m);if(N.length<=1)await h($(n),i);else for(const c of N){const l={...n,headerText:`=== ${c.toUpperCase()} ===
${n.headerText||""}`,items:m[c]};await h($(l),i),await new Promise(P=>setTimeout(P,500))}}await p.from("orders").update({printed_at:new Date().toISOString(),print_count:(t.print_count||0)+1}).eq("id",t.id)}async function H(t){const e=t.printer_paper_width??"80mm",r={storeName:t.name,headerText:t.printer_header_text||"",footerText:"TESTE DE IMPRESSAO",orderShortId:"TESTE",createdAt:new Date().toISOString(),customerName:"Cliente Teste",customerPhone:"(11) 99999-9999",deliveryType:"delivery",customerAddress:"Rua Exemplo, 123 - Bairro Centro - Cidade/UF",paymentMethod:"Pix",items:[{product_name:"Produto de Teste",product_price:25.5,quantity:2},{product_name:"Outro Produto",product_price:12,quantity:1}],subtotal:63,deliveryFee:5,discount:0,total:68,paperWidth:e};await h(A(r),e)}const ie=Object.freeze(Object.defineProperty({__proto__:null,printOrder:V,printTestReceipt:H},Symbol.toStringTag,{value:"Module"})),oe=t=>q({queryKey:["suppliers",t],queryFn:async()=>{if(!t)return[];const{data:e,error:r}=await p.from("suppliers").select("*").eq("tenant_id",t).order("created_at");if(r)throw r;return e},enabled:!!t,refetchInterval:3e4,staleTime:15e3}),ne=t=>q({queryKey:["supplier-token",t],queryFn:async()=>{if(!t)return null;const{data:e,error:r}=await p.rpc("get_supplier_by_token",{_token:t});if(r)throw r;return(Array.isArray(e)?e[0]:e)||null},enabled:!!t}),se=()=>{const t=g();return x({mutationFn:async e=>{const{error:r}=await p.from("suppliers").insert(e);if(r)throw r},onSuccess:(e,r)=>t.invalidateQueries({queryKey:["suppliers",r.tenant_id]})})},ae=()=>{const t=g();return x({mutationFn:async e=>{const r={name:e.name,address:e.address,phone:e.phone,responsible_for_delivery:e.responsible_for_delivery,active:e.active};e.shipping_base_fee!==void 0&&(r.shipping_base_fee=e.shipping_base_fee),e.shipping_base_radius_km!==void 0&&(r.shipping_base_radius_km=e.shipping_base_radius_km),e.shipping_per_km_fee!==void 0&&(r.shipping_per_km_fee=e.shipping_per_km_fee);const{error:i}=await p.from("suppliers").update(r).eq("id",e.id);if(i)throw i;return e},onSuccess:e=>t.invalidateQueries({queryKey:["suppliers",e.tenant_id]})})},ce=()=>{const t=g();return x({mutationFn:async({supplierId:e,status:r,tenantId:i})=>{const{error:o}=await p.from("suppliers").update({lalamove_use_store_api:r}).eq("id",e);if(o)throw o;return{tenantId:i}},onSuccess:e=>t.invalidateQueries({queryKey:["suppliers",e.tenantId]})})},le=t=>{const e=g();return x({mutationFn:async r=>{const{error:i}=await p.from("suppliers").delete().eq("id",r);if(i)throw i},onSuccess:()=>e.invalidateQueries({queryKey:["suppliers",t]})})},de=({reviews:t,loading:e})=>{const{avg:r,count:i}=D(t);return e?s.jsx("p",{className:"text-center text-muted-foreground py-4 text-sm",children:"Carregando avaliações…"}):s.jsxs("div",{className:"space-y-3",children:[s.jsxs("div",{className:"rounded-lg border border-border bg-card p-4 flex items-center gap-3",children:[s.jsx("div",{className:"rounded-lg bg-yellow-500/10 p-2",children:s.jsx(_,{className:"h-5 w-5 fill-yellow-400 text-yellow-400"})}),s.jsxs("div",{children:[s.jsx("p",{className:"text-2xl font-bold text-foreground",children:i>0?r.toFixed(1):"—"}),s.jsxs("p",{className:"text-xs text-muted-foreground",children:[i," ",i===1?"avaliação":"avaliações"]})]}),i>0&&s.jsx("div",{className:"ml-auto flex items-center gap-0.5",children:[1,2,3,4,5].map(o=>s.jsx(_,{className:`h-4 w-4 ${r>=o?"fill-yellow-400 text-yellow-400":"text-muted-foreground"}`},o))})]}),t.length===0&&s.jsxs("div",{className:"rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground text-sm",children:[s.jsx(O,{className:"h-6 w-6 mx-auto mb-2 opacity-50"}),"Ainda sem avaliações. Quando clientes avaliarem, aparecem aqui."]}),s.jsx("div",{className:"space-y-2",children:t.map(o=>s.jsxs("div",{className:"rounded-lg border border-border bg-card p-3 space-y-2",children:[s.jsxs("div",{className:"flex items-center justify-between",children:[s.jsx("div",{className:"flex items-center gap-0.5",children:[1,2,3,4,5].map(n=>s.jsx(_,{className:`h-3.5 w-3.5 ${o.rating>=n?"fill-yellow-400 text-yellow-400":"text-muted-foreground"}`},n))}),s.jsx("span",{className:"text-xs text-muted-foreground",children:new Date(o.created_at).toLocaleDateString("pt-BR")})]}),o.comment&&s.jsx("p",{className:"text-sm text-foreground",children:o.comment}),s.jsxs("p",{className:"text-[10px] text-muted-foreground",children:["Pedido #",o.order_id.slice(0,8)]})]},o.id))})]})};export{de as R,U as a,se as b,le as c,ae as d,ce as e,X as f,te as g,H as h,ee as i,M as j,ne as k,ie as o,V as p,re as s,oe as u};
