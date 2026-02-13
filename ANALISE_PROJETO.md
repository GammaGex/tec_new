# Correção aplicada: inject de sessão/cookies (gexbot classic vs flow)

## Problema
Após separar o fluxo de inject de sessão/cookies:
- `flow` autentica corretamente;
- `classic` não restaura sessão.

## Correção direta proposta (para aplicar no código)
Ajustar o `classic` para reproduzir exatamente a mesma sequência do `flow` na parte de hidratação de sessão.

### 1) Unificar normalização de cookies em helper único
Criar um helper compartilhado (usado por `flow` e `classic`) para evitar divergência de formato:

```ts
type InputCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  expires?: number;
};

export function normalizeCookies(cookies: InputCookie[], targetDomain: string) {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain ?? targetDomain,
    path: c.path ?? '/',
    secure: c.secure ?? true,
    httpOnly: c.httpOnly ?? true,
    sameSite: c.sameSite ?? 'Lax',
    ...(typeof c.expires === 'number' ? { expires: c.expires } : {}),
  }));
}
```

### 2) Corrigir ordem no `classic`
A sequência deve ser:
1. criar `browser context`;
2. injetar cookies no **mesmo context**;
3. injetar `localStorage/sessionStorage` (se necessário);
4. só então navegar para a URL autenticada.

```ts
const context = await browser.newContext();

const normalized = normalizeCookies(rawCookies, '.seu-dominio.com');
await context.addCookies(normalized);

const page = await context.newPage();
await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
// se houver bootstrap de storage, fazer antes da rota protegida
await page.goto(protectedUrl, { waitUntil: 'networkidle' });
```

### 3) Evitar erro comum do `classic`
Não criar `page/context` diferentes para injetar e para navegar. Se injetar em um contexto e abrir a rota protegida em outro, os cookies não serão enviados.

### 4) Domínio/path e flags obrigatórias
Validar no `classic`:
- `domain` compatível com host real usado na navegação;
- `path` = `/` (salvo necessidade específica);
- `secure` coerente com `https`;
- `sameSite=None` exige `secure=true`.

### 5) Log mínimo para confirmar correção
No `classic`, logar antes da navegação protegida:
- quantidade de cookies injetados;
- `name/domain/path/secure/sameSite` dos principais cookies;
- URL final após redirects.

## Checklist de validação
- [ ] `classic` usa o mesmo helper de normalização do `flow`.
- [ ] Inject acontece antes da navegação protegida.
- [ ] Inject e navegação ocorrem no mesmo `browser context`.
- [ ] Domínio e `secure/sameSite` compatíveis com o ambiente.
- [ ] Sessão restaurada sem login manual.

## Resultado esperado
Com esses ajustes, o `classic` volta a ter o mesmo comportamento de restauração de sessão do `flow`, eliminando a regressão introduzida pela separação de fluxos.
