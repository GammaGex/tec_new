# Análise do Projeto Gex Enterprise Browser

## Visão Geral

O projeto **Gex Enterprise Browser** consiste num navegador multiplataforma, construído com [Electron](https://www.electronjs.org/), que combina componentes de **Chromium** com JavaScript/HTML para criar uma experiência de navegação personalizada e integrada ao sistema corporativo “Gex”.  O projeto disponibiliza scripts para instalação/empacotamento no Windows, uma página de login com validação de credenciais e atualização automática, um navegador de abas com tema escuro e integração com vários serviços (Gexbot, SpotGamma, GammaEdge, QuantData, Finviz, MenthorQ e Discord).

## Estrutura de Diretórios e Componentes Principais

O projeto é formado por uma mistura de arquivos HTML, JavaScript e scripts de automação em batch e Python:

| Arquivo/Script | Propósito principal |
|----------------|--------------------|
| **`index.html`** | Página inicial de login. Solicita usuário e senha do proxy e chama funções de **atualização automática** e **salvamento de credenciais** através de `window.api` (exposta pelo `preload.js`). |
| **`browser.html`** | Interface do navegador com múltiplas abas. Define o tema escuro, barra de títulos personalizada, gerenciamento de abas (criação, remoção, drag‑and‑drop), zoom e atalhos. Sua lógica JavaScript gerencia o estado das abas, salvando/restaurando sessões no `localStorage`. |
| **`newtab.html`** | Página de nova aba apresentando atalhos para diferentes sites (Finviz, GammaEdge, Gexbot, SpotGamma, etc.). |
| **`autologin.js`** | Script injetado nas páginas via `window.api.getAutoLoginScript`. Ele lê um `CONFIG` (obtido da configuração remota) e preenche automaticamente formulários de login para diversos serviços. Inclui um mecanismo de *smart failover* que rota entre várias contas (e.g., `spotgamma1`, `spotgamma2`) a cada tentativa de login utilizando índices gravados no `localStorage`. |
| **`preload.js`** | Script de **preload** do Electron que expõe uma API segura (`window.api`) para o código da interface chamar funcionalidades da camada principal (`main.js`), como login, verificação de versão, download/aplicação de atualizações, gerenciamento de abas e teste de proxies. |
| **`webview-preload.js`** | Preload executado dentro dos `<webview>` do navegador. Permite controlar o zoom das páginas, intercepta eventos como `scroll` e `reload`, bloqueia endereços indesejados (por exemplo, páginas de preferências do SpotGamma ou integrações do MenthorQ) e repassa informações de rolagem para a aplicação principal. |
| **`main.js`** | Processo principal do Electron. Responsável por configurar flags do Chromium (p.ex. desativar determinados limites de GPU, definir User‑Agent), testar e selecionar o proxy ativo, validar credenciais via proxy, iniciar as janelas do navegador, controlar atualizações automáticas e carregar a configuração remota. Também define handlers IPC (`ipcMain`) para os métodos expostos em `preload.js`. |
| **`setup.py` / `build.bat`** | Scripts de empacotamento para Windows. `build.bat` executa `setup.py`, que cria um instalador ZIP contendo os arquivos da aplicação, fecha instâncias antigas do navegador, faz backup da pasta de dados do usuário, instala a nova versão e recria atalhos no desktop. |
| **`Iniciar_GexBrowser.bat`** | Script simples que entra no diretório do projeto e executa `npm start` para iniciar o Electron durante o desenvolvimento. |
| **`backup.bat`** | Script de cópia de segurança utilizado pelo autor. Gera uma pasta de backup no Google Drive, copiando arquivos da pasta raiz e excluindo executáveis. |

## Fluxo de Execução

1. **Inicialização/Instalação** – no Windows, o usuário roda `build.bat` para empacotar e instalar a aplicação. O instalador (`setup.py`) procura dados anteriores (p.ex. credenciais e cookies), faz backup da `User Data` do Chromium e restaura esses dados após a extração da nova versão.

2. **Execução** – para uso cotidiano, o script `Iniciar_GexBrowser.bat` executa `npm start`, que inicializa o Electron. O arquivo **`main.js`** testa proxies configurados, seleciona o melhor (primário ou secundário) e define o comportamento de proxy para requisições internas via Axios. Ele também baixa uma configuração remota (`gex_config26.json`) hospedada em um bucket do OCI, contendo credenciais criptografadas para serviços como Gexbot e SpotGamma.

3. **Login** – a primeira janela carregada é **`index.html`**, que apresenta um formulário para usuário e senha do proxy. O código realiza uma verificação de versão assíncrona; se a aplicação estiver desatualizada, ela baixa e aplica automaticamente o instalador da nova versão. Após o login, as credenciais podem ser salvas localmente (codificadas em Base64) e, se solicitado, persistidas via `main.js` em um `settings.json` na pasta de dados do aplicativo.

4. **Navegação** – ao autenticar, o método `loadBrowser` abre **`browser.html`**, que monta a interface de múltiplas abas. Cada aba é um `<webview>` isolado usando a partição `persist:gex` para partilhar cookies. O usuário pode criar novas abas, reorganizá‑las por arrastar, abrir janelas separadas (“Detach Tab”), alternar entre layout único ou dividido (“Split Layout”) e utilizar atalhos de teclado (por exemplo, `Ctrl+Tab` para alternar abas, `Ctrl+L` para focar a barra de endereços, `Ctrl`+scroll para zoom). O estado das abas (URL e posição de rolagem) é salvo periodicamente no `localStorage` para restauração automática em caso de falha.

5. **Auto‑login** – o script **`autologin.js`** é injetado nas páginas via a API do preload para preencher formulários de login de diversos serviços. O script lê o objeto `CONFIG` (obtido de `gex_config26.json` ou de variáveis globais) e usa funções como `fillSimple` ou `fillReact` para preencher campos de email/senha de forma compatível com sites que utilizam React ou entradas tradicionais. Para serviços como Gexbot, o script manipula cookies de sessão (`auth`, `ai_user`, etc.) e redireciona o usuário à página correcta caso a sessão esteja ausente. A função `getSmartConfig` implementa um balanceamento de carga simples: caso existam várias contas para um serviço (spotgamma1, spotgamma2…), ele alterna entre elas a cada tentativa, salvando o índice no `localStorage`.

6. **Atualizações e Configuração Remota** – **`main.js`** consulta periodicamente um arquivo de versão (`gex_version.txt`) hospedado no armazenamento OCI. Se uma nova versão estiver disponível, ele baixa o instalador (`GexBrowser_Installer.exe`) e aciona `applyUpdate`, que encerra a aplicação, extrai a nova versão e a relança. Da mesma forma, `fetchRemoteConfig` busca arquivos JSON contendo tokens e cookies para Gexbot, SpotGamma e GammaEdge; esses cookies são então aplicados ao perfil `persist:gex` usando a API de cookies do Electron para manter sessões autenticadas sem que o usuário precise logar manualmente.

## Considerações de Segurança

* **Persistência de Credenciais** – as credenciais do proxy podem ser salvas em `settings.json` dentro da pasta de dados do aplicativo; além disso, o `localStorage` da janela de login pode armazenar usuário e senha codificados com Base64. Embora conveniente, guardar senhas localmente aumenta o risco em caso de comprometimento do sistema. Avalie armazenar as credenciais de forma criptografada (por exemplo, usando `keytar` ou APIs do sistema operacional) e permitir que o usuário opte por não salvá‑las.

* **Atualizações Remotas** – os binários de atualização são baixados a partir de um bucket em `objectstorage.sa-saopaulo-1.oci.customer-oci.com`. É crucial garantir que essas requisições usem HTTPS (o código já especifica URLs `https://`) e verificar a integridade das atualizações (por exemplo, via hash/assinaturas) antes de aplicá‑las para evitar ataques man‑in‑the‑middle.

* **Configuração Dinâmica** – o arquivo `gex_config26.json` carrega tokens, cookies e credenciais. O código atualmente injeta esses dados diretamente na memória e nos cookies sem validação. Considere verificar a estrutura do JSON e utilizar medidas de segurança (p.ex. CORS, autenticação do endpoint) para evitar a injeção de dados maliciosos.

* **Controle de Navegação** – o preload dos webviews implementa filtros simples que redirecionam páginas de preferências do SpotGamma e integrações do MenthorQ para páginas seguras. Caso haja necessidade de bloqueios adicionais, essa lógica pode ser estendida para permitir listas de permissões/negações mantidas pelo administrador.

## Sugestões de Melhoria

1. **Segurança de Credenciais** – utilizar módulos como [`keytar`](https://www.npmjs.com/package/keytar) para armazenar senhas de forma criptografada no cofre nativo do sistema operacional. Evite Base64 puro para senhas no `localStorage`.

2. **Arquitetura de Atualização** – implementar validação de integridade (hash SHA‑256 ou assinatura digital) dos binários de atualização antes de aplicá‑los. Também é recomendável fornecer ao usuário informações de versão e permitir adiar atualizações não críticas.

3. **Separação de Responsabilidades** – `main.js` possui diversas responsabilidades (proxy, cookies, janelas, atualizações). Dividir esse arquivo em módulos (por exemplo, `proxyManager.js`, `updateManager.js`, `windowManager.js`) facilitaria manutenção e testes.

4. **Internacionalização e Acessibilidade** – a interface atualmente está em inglês, mas alguns comentários e mensagens estão em português. Se o público alvo for bilíngue, considere integrar um sistema de tradução. Além disso, implementar navegação via teclado e atributos `aria` nos componentes do `browser.html` melhoraria a acessibilidade.

5. **Cross‑Plataforma** – o instalador (`setup.py`) e os scripts em batch são específicos para Windows. Caso haja interesse em suportar macOS ou Linux, poderia-se usar ferramentas como [electron-builder](https://www.electron.build/) que geram instaladores nativos para múltiplas plataformas.

6. **Testes e Validação** – incluir testes unitários e de integração (por exemplo, usando [Spectron](https://github.com/electron-userland/spectron) ou [Playwright](https://playwright.dev/)) para garantir a estabilidade de componentes como o auto‑login e a restauração de sessões.

7. **Melhorias na IU** – o `browser.html` implementa funcionalidades avançadas como modo dividido e drag‑and‑drop de abas. Entretanto, o código é extenso e pode ser modularizado. A inclusão de um modo claro, personalização de cores e atalhos configuráveis poderia melhorar a experiência do usuário.

## Conclusão

O **Gex Enterprise Browser** apresenta uma solução robusta para centralizar acessos a diversos serviços internos e externos de forma segura, com suporte a proxies, atualização automática e auto‑login. A arquitetura combina Electron com scripts de automação para Windows, permitindo empacotar e distribuir o navegador como uma aplicação de desktop. No entanto, alguns cuidados devem ser tomados em relação à segurança das credenciais e à validação das atualizações remotas. Modularizar partes do código, melhorar a segurança e adicionar testes automatizados ajudaria a tornar o projeto mais sustentável e confiável.