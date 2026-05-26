// Helpers compartilhados entre testes
// Geradores de CNPJ/CPF com digitos verificadores validos.

export function gerarCNPJValido() {
  // 12 digitos aleatorios + 2 verificadores
  let base = '';
  for (let i = 0; i < 12; i++) base += Math.floor(Math.random() * 10);
  const p1 = [5,4,3,2,9,8,7,6,5,4,3,2];
  let s1 = 0; for (let i = 0; i < 12; i++) s1 += Number(base[i]) * p1[i];
  const r1 = s1 % 11;
  const d1 = r1 < 2 ? 0 : 11 - r1;
  const base13 = base + d1;
  const p2 = [6,5,4,3,2,9,8,7,6,5,4,3,2];
  let s2 = 0; for (let i = 0; i < 13; i++) s2 += Number(base13[i]) * p2[i];
  const r2 = s2 % 11;
  const d2 = r2 < 2 ? 0 : 11 - r2;
  return base13 + d2;
}

export function gerarCPFValido() {
  let base = '';
  for (let i = 0; i < 9; i++) base += Math.floor(Math.random() * 10);
  // garante nao-repetidos
  if (/^(\d)\1{8}$/.test(base)) base = base.substring(0, 8) + ((Number(base[0]) + 1) % 10);
  let s1 = 0;
  for (let i = 0; i < 9; i++) s1 += Number(base[i]) * (10 - i);
  let r1 = (s1 * 10) % 11; if (r1 === 10) r1 = 0;
  const base10 = base + r1;
  let s2 = 0;
  for (let i = 0; i < 10; i++) s2 += Number(base10[i]) * (11 - i);
  let r2 = (s2 * 10) % 11; if (r2 === 10) r2 = 0;
  return base10 + r2;
}
