// =====================================================================
// V223/A1: Modal copiável para senha temporária.
// Substitui alert() nativo em admin.html (aprovar fornecedor) e
// admin-usuarios.html (criar usuário / resetar senha).
//
// Uso (vanilla, não-módulo):
//   <script src="/app/senha-temp-modal.js"></script>
//   window.mostrarSenhaTemp('Empresa X · usuário do portal', 'a8B2cD3e4F');
// =====================================================================

(function (global) {
  'use strict';

  function ensureModal() {
    if (document.getElementById('fesf-senha-temp-modal')) return;
    const wrap = document.createElement('div');
    wrap.id = 'fesf-senha-temp-modal';
    wrap.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    wrap.innerHTML = '\n' +
      '  <div style="background:#fff;padding:24px;border-radius:10px;max-width:520px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)">\n' +
      '    <h2 style="margin:0 0 4px;font-size:18px">✓ Senha temporária gerada</h2>\n' +
      '    <p id="fesf-senha-temp-quem" style="margin:0 0 16px;font-size:13px;color:#7a7a7a">—</p>\n' +
      '    <div style="background:#fff4d6;border:1px solid #f3d8a0;color:#6b4e00;padding:10px 14px;border-radius:6px;margin-bottom:14px;font-size:13px">\n' +
      '      <strong>Atenção:</strong> envie esta senha por canal seguro (telefone, e-mail criptografado, mensageiro institucional). Se o SMTP estiver configurado em <a href="/app/admin-smtp.html">Configurações · SMTP</a>, o sistema também envia automaticamente por e-mail.\n' +
      '    </div>\n' +
      '    <label style="font-size:11.5px;text-transform:uppercase;letter-spacing:.4px;color:#7a7a7a;font-weight:600">Senha temporária</label>\n' +
      '    <div style="display:flex;gap:8px;margin-top:6px">\n' +
      '      <input id="fesf-senha-temp-valor" readonly style="flex:1;font-family:ui-monospace,monospace;font-size:18px;font-weight:600;padding:10px;border:2px solid #5B5499;border-radius:6px;background:#eeecf6;color:#4a4480;text-align:center;letter-spacing:1px">\n' +
      '      <button id="fesf-senha-temp-copiar" type="button" style="padding:10px 16px;border:1px solid #5B5499;background:#5B5499;color:#fff;border-radius:6px;font-weight:600;cursor:pointer">📋 Copiar</button>\n' +
      '    </div>\n' +
      '    <div style="margin-top:18px;text-align:right">\n' +
      '      <button id="fesf-senha-temp-fechar" type="button" style="padding:8px 16px;border:1px solid #cfcfcb;background:#fff;border-radius:6px;cursor:pointer">Fechar</button>\n' +
      '    </div>\n' +
      '  </div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.style.display = 'none'; });
    document.getElementById('fesf-senha-temp-fechar').addEventListener('click', () => { wrap.style.display = 'none'; });
    document.getElementById('fesf-senha-temp-copiar').addEventListener('click', copiar);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && wrap.style.display === 'flex') wrap.style.display = 'none';
    });
  }

  async function copiar() {
    const v = document.getElementById('fesf-senha-temp-valor').value;
    const btn = document.getElementById('fesf-senha-temp-copiar');
    const original = '📋 Copiar';
    try {
      await navigator.clipboard.writeText(v);
      btn.textContent = '✓ Copiado';
    } catch {
      const inp = document.getElementById('fesf-senha-temp-valor');
      inp.select(); document.execCommand('copy');
      btn.textContent = '✓ Copiado';
    }
    setTimeout(() => { btn.textContent = original; }, 2000);
  }

  global.mostrarSenhaTemp = function (quem, senha) {
    ensureModal();
    document.getElementById('fesf-senha-temp-quem').textContent = String(quem || '—');
    document.getElementById('fesf-senha-temp-valor').value = String(senha || '');
    document.getElementById('fesf-senha-temp-copiar').textContent = '📋 Copiar';
    document.getElementById('fesf-senha-temp-modal').style.display = 'flex';
    // Auto-select para o usuário poder Ctrl+C mesmo sem clicar Copiar
    setTimeout(() => {
      const inp = document.getElementById('fesf-senha-temp-valor');
      if (inp) inp.select();
    }, 100);
  };
})(window);
