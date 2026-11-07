# Cortagiro

Simulador de som de motor no navegador. O som é sintetizado em tempo real, sem gravações: pulsos de escape e de admissão por cilindro, na ordem de ignição real, passando por coletor, tubulação e silencioso, com acústica de sete ambientes.

- 55 motores prontos, com bandeira, silhueta e linha do tempo histórica
- Mais de 40 ajustes: arquitetura (linha, V, boxer, W, Wankel), cilindros, virabrequim, comando, VTEC, turbo/compressor, escape, estalos
- Ouvir de fora do carro, na ponteira, no cofre ou na cabine (com vento e ruído de rodagem)
- Ambientes: estrada aberta, cidade, autódromo, estacionamento, garagem, túnel, cânion
- Acelerador no scroll, teclado, pedal na tela e giroscópio do celular
- Português, espanhol e inglês

## Publicar na Vercel

É um site estático, sem build.

**Pelo GitHub:** envie esta pasta para um repositório, depois em vercel.com → *Add New → Project* → importe o repositório. Framework Preset: **Other**. Deixe Build Command e Output Directory vazios e clique em *Deploy*.

**Pela linha de comando:**

```bash
npm i -g vercel
cd cortagiro
vercel        # primeira vez: cria e liga o projeto
vercel --prod # publica em produção
```

## Enviar para o GitHub

```bash
cd cortagiro
git init -b main
git add .
git commit -m "Cortagiro: simulador de som de motor"
gh repo create cortagiro --public --source=. --push
# ou, com um repositório vazio criado no site do GitHub:
git remote add origin https://github.com/SEU-USUARIO/cortagiro.git
git push -u origin main
```

## Rodar no computador

O áudio usa AudioWorklet, que não funciona abrindo o arquivo direto (`file://`):

```bash
npx serve .
# ou
python -m http.server 8000
```

## Giroscópio

Funciona no celular, em site com HTTPS (a Vercel já é). No iPhone o Safari pede permissão ao tocar em **Giroscópio**. Incline para a frente para acelerar, gire para os lados para trocar de marcha e sacuda para dar um blip.

## Fotos

As fotos dos carros vêm do Wikimedia Commons, recortadas em 16:9. Autor e licença de cada uma estão em `photos.js` e aparecem sobre a foto no site.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `index.html` | Página e estilos |
| `app.js` | Interface, controles, gráficos, garagem e ambientes |
| `engine-worklet.js` | Síntese do som e física do motor (thread de áudio) |
| `engine-core.js` | Layout dos cilindros, ordem de ignição, curva de torque e marchas |
| `presets.js` | Configuração padrão e os 55 motores |
| `history.js` | Histórias dos motores (PT, ES, EN) |
| `i18n.js` | Textos da interface (PT, ES, EN) |
| `photos.js` + `img/` | Fotos dos carros e créditos |
| `vercel.json` | Configuração da Vercel |
