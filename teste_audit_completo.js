/**
 * teste_audit_completo.js
 * Audita Portal FESF-SUS via Playwright headless.
 * Foco: varrer telas, capturar erros silenciosos do console + 5xx + estados quebrados.
 */
const { chromium } = require('./backend/node_modules/playwright');
const path = require('path');
const fs = require('fs');

const APP = 'https://fesf-payment-forms.onrender.com';
const CREDS = {
  admin:     { email: 'maria.andrade@fesfsus.ba.gov.br', senha: 'senha123', nova: 'Adm@2026!' },
  operador:  { email: 'carlos.souza@fesfsus.ba.gov.br',  senha: 'senha123', nova: 'Op@2026!'  },
  fornecedor:{ email: 'contato@empresahosp.com.br',      senha: 'senha123', nova: 'Hosp@2026!' },
};

const SHOT_DIR = path.join(process.cwd(), 'audit_screenshots');
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR);

const findings = [];
let counter = 0;

function log(msg) { console.log('[' + new Date().toLocaleTimeString('pt-BR') + '] ' + msg); }
function bug(sev, area, msg, detail = '') {
  findings.push({ severidade: sev, area, msg, detail });
  const ic = sev === 'BLOCKER' ? '🚫' : sev === 'MAJOR' ? '🔴' : sev === 'MINOR' ? '🟡' : '🟢';
  log(`${ic} [${sev}] ${area}: ${msg}${detail ? ' · ' + detail.substring(0,150) : ''}`);
}
function ok(area, msg) { log(`✓ ${area}: ${msg}`); }

async function shot(page, label) {
  counter++;
  const file = path.join(SHOT_DIR, `${String(counter).padStart(2,'0')}_${label}.png`);
  try { await page.screenshot({ path: file, fullPage: false }); } catch {}
  return file;
}

function mkCtx() { return { consoleErrors: [], pageErrors: [], httpErrors: [] }; }
function setupCapture(page, ctx) {
  page.on('console', m => {
    if (m.type() === 'error') {
      const t = m.text();
      if (/favicon|DevTools|sourcemap|extension|net::ERR_/.test(t)) return;
      ctx.consoleErrors.push(t);
    }
  });
  page.on('pageerror', e => ctx.pageErrors.push(e.message));
  page.on('response', r => {
    if (r.status() >= 500) ctx.httpErrors.push({ url: r.url(), status: r.status() });
  });
}

async function loginAs(page, persona) {
  const c = CREDS[persona];
  await page.goto(APP + '/app/login.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#email', { timeout: 20000 });
  await page.fill('#email', c.email);
  await page.fill('#password', c.senha);
  await page.click('#btnEntrar');
  await page.waitForFunction(() =>
    /trocar-senha|portal|painel|admin\.html|onboarding/.test(location.href),
    { timeout: 30000 }
  );
  if (page.url().includes('trocar-senha')) {
    await page.waitForSelector('#novaSenha', { timeout: 10000 });
    await page.fill('#novaSenha', c.nova);
    await page.fill('#confirmarSenha', c.nova);
    await page.locator('button[type=submit], #btnTrocar').first().click();
    await page.waitForFunction(() => /portal|painel|admin\.html/.test(location.href), { timeout: 20000 });
  }
}

// ===== ADMIN =====
async function auditAdmin(browser) {
  log('========== ADMIN FESF ==========');
  const ctx = mkCtx();
  const page = await browser.newPage();
  setupCapture(page, ctx);
  try {
    await loginAs(page, 'admin');
    ok('admin/login', 'logou');
    await shot(page, 'admin_pos_login');

    if (!/admin\.html/.test(page.url())) {
      bug('MAJOR', 'admin/redirect', 'não foi pra /app/admin.html', 'url=' + page.url());
      await page.goto(APP + '/app/admin.html');
    }
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>{});
    await shot(page, 'admin_dashboard');

    const painelLink = await page.locator('a[href*="painel"]').first();
    if (await painelLink.count() === 0) {
      bug('MAJOR', 'admin/nav', 'sem link para painel');
    } else {
      await painelLink.click();
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>{});
      await shot(page, 'admin_painel');

      const pillText = await page.locator('#page-visao-pill').innerText().catch(() => '');
      if (!/FESF Sede/i.test(pillText)) bug('MAJOR', 'admin/painel', 'pill não diz FESF Sede', 'pill=' + pillText);
      else ok('admin/painel', 'pill: ' + pillText);

      const titulo = await page.locator('#page-title').innerText().catch(() => '');
      if (/Painel da unidade/i.test(titulo)) bug('MINOR', 'admin/painel', 'título "Painel da unidade" pra admin', titulo);
      else ok('admin/painel', 'título: ' + titulo);

      await page.waitForTimeout(2500);
      const chartWrap = await page.locator('#chart-sidebar-wrap').isVisible().catch(() => false);
      if (!chartWrap) bug('MAJOR', 'admin/chart', 'chart não visível pra admin');
      else {
        const tituloChart = await page.locator('#chart-titulo').innerText().catch(() => '');
        if (!/todas as unidades|FESF/i.test(tituloChart))
          bug('MINOR', 'admin/chart', 'título do chart sem indicação global', tituloChart);
        else ok('admin/chart', tituloChart);
      }

      const btnDia = await page.locator('#bar-chart-gran button[data-gran="day"]');
      if (await btnDia.count() === 0) bug('MAJOR', 'admin/chart', 'toggle Dia/Semana/Mês ausente');
      else {
        await btnDia.click();
        await page.waitForTimeout(1500);
        ok('admin/chart', 'toggle Dia funcionou');
        await shot(page, 'admin_chart_dia');
        await page.locator('#bar-chart-gran button[data-gran="month"]').click();
        await page.waitForTimeout(1500);
        ok('admin/chart', 'toggle Mês funcionou');
      }

      const opts = await page.locator('#f-periodo option').count();
      if (opts < 2) bug('MAJOR', 'admin/painel', 'dropdown competência sem opções');
      else ok('admin/painel', `${opts} opções de competência`);

      await page.waitForTimeout(1000);
      const linhas = await page.locator('#tbl-envios tbody tr').count();
      if (linhas === 0) bug('MINOR', 'admin/envios', 'tabela vazia');
      else {
        ok('admin/envios', `${linhas} envios na tabela`);
        const nullCount = await page.locator('#tbl-envios >> text=null').count();
        if (nullCount > 0) bug('MAJOR', 'admin/envios', `texto "null" exibido ${nullCount}x na tabela`);

        const verBtn = await page.locator('#tbl-envios tbody tr:first-child button').first();
        if (await verBtn.count() > 0) {
          await verBtn.click();
          await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>{});
          await page.waitForTimeout(1500);
          await shot(page, 'admin_envio_detalhe');

          if (!/envio\.html\?id=/.test(page.url())) {
            bug('MAJOR', 'admin/envio', 'não foi para envio.html');
          } else {
            ok('admin/envio', 'detalhe abriu');
            const corpo = await page.locator('body').innerText();
            if (/DOCUMENTO\s*\n\s*null\b/i.test(corpo)) bug('MAJOR', 'admin/envio', 'DOCUMENTO mostra "null"');
            const tabs = await page.locator('.dtab').count();
            if (tabs < 4) bug('MINOR', 'admin/envio', `apenas ${tabs} abas (esperado ≥4)`);

            // Aba Documentos
            const docTab = await page.locator('.dtab[data-tab="documentos"]');
            if (await docTab.count() > 0) {
              await docTab.click();
              await page.waitForTimeout(800);
              await shot(page, 'admin_envio_docs');
              const meta = await page.locator('text=/(KB|MB) total/i').first().innerText().catch(() => '');
              if (/e\+\d/.test(meta)) bug('BLOCKER', 'admin/envio/docs', 'tamanho total em notação científica', meta);
              else if (meta) ok('admin/envio/docs', 'tamanho: ' + meta);
              const cardValid = await page.locator('text=/inconsistência\\(s\\) detectada/i').count();
              if (cardValid > 0) ok('admin/envio/docs', 'card validação automática presente');
            }

            // Aba Formulário
            const formTab = await page.locator('.dtab[data-tab="formulario"]');
            if (await formTab.count() > 0) {
              await formTab.click();
              await page.waitForTimeout(800);
              await shot(page, 'admin_envio_form');
              const txt = await page.locator('body').innerText();
              const flags = {
                verif: /Verificados/i.test(txt),
                duvida: /Em\s*dúvida/i.test(txt),
                problema: /Problemas/i.test(txt),
              };
              if (!flags.verif || !flags.duvida || !flags.problema)
                bug('MAJOR', 'admin/envio/form', 'KPIs ausentes', JSON.stringify(flags));
              else ok('admin/envio/form', 'KPIs OK');

              // 5º card "Comentários" NÃO deve existir (revertido)
              if (/💬\s*Comentários/i.test(txt))
                bug('MINOR', 'admin/envio/form', 'KPI "Comentários" voltou (era revertido em V303)');
            }
          }
        }
      }
    }

    // admin-emails
    await page.goto(APP + '/app/admin-emails.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await shot(page, 'admin_emails');
    const corpoEm = await page.locator('body').innerText();
    if (/Resend.*403/i.test(corpoEm)) bug('INFO', 'admin/emails', 'Resend 403 visível (esperado: domínio não verificado)');

    await page.goto(APP + '/app/admin-pagamentos.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await shot(page, 'admin_pagamentos');

    await page.goto(APP + '/app/admin-status.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await shot(page, 'admin_status');

  } catch (e) {
    bug('BLOCKER', 'admin', 'Exception: ' + e.message);
    await shot(page, 'admin_FAIL');
  } finally {
    if (ctx.consoleErrors.length) bug('MAJOR', 'admin/console', `${ctx.consoleErrors.length} console errors`, ctx.consoleErrors.slice(0,3).join(' || '));
    if (ctx.pageErrors.length) bug('MAJOR', 'admin/pageerror', `${ctx.pageErrors.length} pageerrors`, ctx.pageErrors.slice(0,3).join(' || '));
    if (ctx.httpErrors.length) bug('MAJOR', 'admin/http', `${ctx.httpErrors.length} HTTP 5xx`, JSON.stringify(ctx.httpErrors.slice(0,3)));
    await page.close();
  }
}

// ===== OPERADOR =====
async function auditOperador(browser) {
  log('========== OPERADOR HECC ==========');
  const ctx = mkCtx();
  const page = await browser.newPage();
  setupCapture(page, ctx);
  try {
    await loginAs(page, 'operador');
    ok('operador/login', 'logou');
    await shot(page, 'operador_pos_login');

    if (!/painel/.test(page.url())) bug('MAJOR', 'operador/redirect', 'não foi pra painel', page.url());
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>{});

    const pill = await page.locator('#page-visao-pill').innerText().catch(() => '');
    if (!/Operador/i.test(pill)) bug('MINOR', 'operador/painel', 'pill não diz Operador', pill);
    else ok('operador/painel', pill);

    if (!await page.locator('#chart-sidebar-wrap').isVisible().catch(() => false))
      bug('MAJOR', 'operador/chart', 'chart não visível');
    else ok('operador/chart', 'chart visível');

    const tabPend = await page.locator('[data-tab="pendencias"]').first();
    if (await tabPend.count() > 0) { await tabPend.click(); await page.waitForTimeout(1000); await shot(page, 'operador_pendencias'); }

    const tabForn = await page.locator('[data-tab="fornecedores"]').first();
    if (await tabForn.count() > 0) { await tabForn.click(); await page.waitForTimeout(1000); await shot(page, 'operador_fornecedores'); }

    const tabLinks = await page.locator('[data-tab="links"]').first();
    if (await tabLinks.count() > 0) { await tabLinks.click(); await page.waitForTimeout(1000); await shot(page, 'operador_links'); }

    const tabEnvios = await page.locator('[data-tab="envios"]').first();
    if (await tabEnvios.count() > 0) await tabEnvios.click();
    await page.waitForTimeout(1000);

    const verBtn = await page.locator('#tbl-envios tbody tr:first-child button').first();
    if (await verBtn.count() > 0) {
      await verBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>{});
      await page.waitForTimeout(1500);
      await shot(page, 'operador_envio_detalhe');

      const formTab = await page.locator('.dtab[data-tab="formulario"]');
      if (await formTab.count() > 0) {
        await formTab.click();
        await page.waitForTimeout(800);
        const btnOk = await page.locator('[data-anotar][data-status="verificado"]').first();
        if (await btnOk.count() > 0) {
          await btnOk.click();
          await page.waitForTimeout(800);
          const modal = await page.locator('#modal-anotacao').isVisible().catch(() => false);
          if (!modal) bug('MAJOR', 'operador/anotacao', 'modal não abriu ao clicar em ✓');
          else {
            const tit = await page.locator('#anot-titulo').innerText().catch(() => '');
            if (/q\d+_/.test(tit)) bug('MAJOR', 'operador/anotacao', 'modal usa nome de variável', tit);
            else ok('operador/anotacao', 'modal abriu: ' + tit);
            await shot(page, 'operador_modal_anotacao');
            await page.locator('#modal-anotacao button').first().click();
            await page.waitForTimeout(500);
          }
        } else bug('MINOR', 'operador/anotacao', 'botões ✓?! ausentes');
      }

      const btnAprovar = await page.locator('button:has-text("Aprovar envio")').count();
      const btnRet     = await page.locator('button:has-text("Solicitar retificação")').count();
      const btnRej     = await page.locator('button:has-text("Rejeitar")').count();
      if (btnAprovar === 0) bug('MAJOR', 'operador/envio', 'botão Aprovar ausente');
      if (btnRet === 0)     bug('MINOR', 'operador/envio', 'botão Solicitar retificação ausente');
      if (btnRej === 0)     bug('MINOR', 'operador/envio', 'botão Rejeitar ausente');
      if (btnAprovar > 0 && btnRet > 0 && btnRej > 0) ok('operador/envio', '3 botões de ação OK');
    }

  } catch (e) {
    bug('BLOCKER', 'operador', 'Exception: ' + e.message);
    await shot(page, 'operador_FAIL');
  } finally {
    if (ctx.consoleErrors.length) bug('MAJOR', 'operador/console', `${ctx.consoleErrors.length} console errors`, ctx.consoleErrors.slice(0,3).join(' || '));
    if (ctx.pageErrors.length) bug('MAJOR', 'operador/pageerror', `${ctx.pageErrors.length} pageerrors`, ctx.pageErrors.slice(0,3).join(' || '));
    if (ctx.httpErrors.length) bug('MAJOR', 'operador/http', `${ctx.httpErrors.length} HTTP 5xx`, JSON.stringify(ctx.httpErrors.slice(0,3)));
    await page.close();
  }
}

// ===== FORNECEDOR =====
async function auditFornecedor(browser) {
  log('========== FORNECEDOR ==========');
  const ctx = mkCtx();
  const page = await browser.newPage();
  setupCapture(page, ctx);
  try {
    await loginAs(page, 'fornecedor');
    ok('fornecedor/login', 'logou');
    await shot(page, 'fornecedor_pos_login');
    if (!/portal/.test(page.url())) bug('MAJOR', 'fornecedor/redirect', 'não foi pra portal', page.url());
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(()=>{});
    const tabela = await page.locator('table').count();
    if (tabela === 0) bug('MINOR', 'fornecedor/portal', 'sem tabela na portal');
    else ok('fornecedor/portal', `${tabela} tabela(s)`);
  } catch (e) {
    bug('BLOCKER', 'fornecedor', 'Exception: ' + e.message);
    await shot(page, 'fornecedor_FAIL');
  } finally {
    if (ctx.consoleErrors.length) bug('MAJOR', 'fornecedor/console', `${ctx.consoleErrors.length} console errors`, ctx.consoleErrors.slice(0,3).join(' || '));
    if (ctx.httpErrors.length) bug('MAJOR', 'fornecedor/http', `${ctx.httpErrors.length} HTTP 5xx`, JSON.stringify(ctx.httpErrors.slice(0,3)));
    await page.close();
  }
}

// ===== LINK PÚBLICO =====
async function auditLinkPublico(browser) {
  log('========== LINK PÚBLICO ==========');
  const ctx = mkCtx();
  const page = await browser.newPage();
  setupCapture(page, ctx);
  try {
    const authR = await fetch(APP + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CREDS.admin.email, senha: CREDS.admin.senha })
    });
    const auth = await authR.json();
    const linkR = await fetch(APP + '/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + auth.token },
      body: JSON.stringify({ unidade_id: 1, modalidade_id: 1 })
    });
    const linkData = await linkR.json();
    const pubTok = linkData.link?.token;
    if (!pubTok) { bug('BLOCKER', 'link/gerar', 'falha ao gerar link', JSON.stringify(linkData)); return; }
    ok('link/gerar', pubTok.substring(0, 24));

    await page.goto(APP + '/app/publico.html?token=' + pubTok, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await shot(page, 'publico_landing');

    const corpo = await page.locator('body').innerText();
    if (/Link\s+inv[áa]lido|erro/i.test(corpo) && !/Abrir formul/i.test(corpo))
      bug('MAJOR', 'link/landing', 'erro ao abrir link válido', corpo.substring(0,200));

    const btnAbrir = await page.locator('button:has-text("Abrir"), a:has-text("Abrir")').first();
    if (await btnAbrir.count() === 0) bug('MAJOR', 'link/landing', 'botão "Abrir formulário" ausente');
    else {
      await btnAbrir.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await page.waitForTimeout(2500);
      await shot(page, 'publico_form');
      if (!/formulario-hcc/.test(page.url())) bug('MAJOR', 'link/form', 'não navegou pro form', page.url());
      else {
        ok('link/form', page.url().split('?')[0]);
        // V307: clica em #btnStart pra sair da cover e entrar no view-form
        const btnStart = await page.locator('#btnStart');
        if (await btnStart.count() > 0) {
          await btnStart.click();
          await page.waitForTimeout(2000);
        }
        const banner = await page.locator('#fesf-context-banner').innerText().catch(() => '');
        if (/Compet[êe]ncia\s+\d{4}-\d{2}/i.test(banner))
          bug('MINOR', 'link/form', 'banner com competência travada', banner);
        else ok('link/form', 'banner sem competência travada');
        const q5 = await page.locator('#fld_q5_competencia').count();
        if (q5 === 0) bug('MAJOR', 'link/form', 'campo q5_competencia ausente após btnStart');
        else ok('link/form', 'q5_competencia presente');
      }
    }
  } catch (e) {
    bug('BLOCKER', 'link', 'Exception: ' + e.message);
    await shot(page, 'link_FAIL');
  } finally {
    if (ctx.consoleErrors.length) bug('MAJOR', 'link/console', `${ctx.consoleErrors.length} console errors`, ctx.consoleErrors.slice(0,3).join(' || '));
    if (ctx.httpErrors.length) bug('MAJOR', 'link/http', `${ctx.httpErrors.length} HTTP 5xx`, JSON.stringify(ctx.httpErrors.slice(0,3)));
    await page.close();
  }
}

// ===== MAIN =====
async function main() {
  log('Iniciando audit completo do Portal FESF-SUS');
  log('Screenshots: ' + SHOT_DIR);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    await auditAdmin(browser);
    await auditOperador(browser);
    await auditFornecedor(browser);
    await auditLinkPublico(browser);
  } finally {
    await browser.close();
  }

  console.log('\n' + '='.repeat(70));
  console.log('RELATÓRIO FINAL');
  console.log('='.repeat(70));
  const sev = (s) => findings.filter(f => f.severidade === s);
  const print = (s, ic) => {
    const arr = sev(s);
    console.log(`\n${ic} ${s}: ${arr.length}`);
    arr.forEach(f => console.log(`  · [${f.area}] ${f.msg}${f.detail ? ' :: ' + f.detail.substring(0,180) : ''}`));
  };
  print('BLOCKER', '🚫');
  print('MAJOR', '🔴');
  print('MINOR', '🟡');
  print('INFO', '🟢');
  console.log(`\nTotal: ${findings.length} achados · screenshots em ${SHOT_DIR}`);

  fs.writeFileSync(path.join(process.cwd(), 'audit_resultado.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), findings }, null, 2));
  log('Resultado: audit_resultado.json');
  process.exit(sev('BLOCKER').length > 0 ? 2 : (sev('MAJOR').length > 0 ? 1 : 0));
}

main().catch(e => { console.error('FATAL:', e); process.exit(99); });
