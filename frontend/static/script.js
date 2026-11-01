// =====================================================================
// SP PONTO SEGURO - SCRIPT DO MAPA
//
// Resumo do que este arquivo faz:
//   1. Cria o mapa (Leaflet) e as "camadas" onde tudo é desenhado.
//   2. Busca no servidor as ocorrências (filtradas por ano e horário).
//   3. Aplica o filtro de bairro no próprio navegador.
//   4. Mostra as ocorrências de duas formas:
//        - MAPA DE CALOR: uma mancha de cores (mais escuro = mais ocorrências).
//          Ótimo para ver o panorama da cidade com o mapa afastado.
//        - PONTOS: um ponto vermelho para cada ocorrência, com popup.
//          Ótimo para ver detalhes com o mapa aproximado.
//   5. Mostra os pontos de ônibus só quando o zoom está alto.
// =====================================================================


// =====================================================================
// ⚙️ CONFIGURAÇÕES
// Valores que você pode ajustar sem mexer no resto do código.
// =====================================================================

// Visão inicial do mapa: centro da cidade de São Paulo.
const CENTRO_INICIAL = [-23.55, -46.63];
const ZOOM_INICIAL = 11;

// A partir deste nível de zoom, os pontos de ônibus aparecem.
// (Quanto maior o número do zoom, mais "perto" o mapa está.)
const ZOOM_MINIMO_PONTOS = 14;

// No modo "Automática": abaixo deste zoom mostramos o mapa de calor;
// a partir dele, mostramos cada ocorrência como um ponto.
const ZOOM_TROCA_CALOR_PONTOS = 15;

// Quantas ocorrências desenhar por "quadro" de animação.
// Desenhar em lotes evita que a página trave quando há muitos pontos.
const TAMANHO_LOTE = 2000;

// No modo de pontos, desenhamos também uma margem em volta da tela,
// para não precisar redesenhar a cada pequeno arrasto do mapa.
// 0.5 = margem de 50% do tamanho da tela em cada lado.
const MARGEM_DESENHO = 0.5;

// Ajustes do mapa de calor (plugin Leaflet.heat).
// Estes valores são um ponto de partida: teste e ajuste ao seu gosto.
const CALOR = {
  // Peso de cada ocorrência (de 0 a 1). Uma ocorrência isolada fica
  // amarelada; várias ocorrências próximas vão somando até ficar vermelho escuro.
  // Se o mapa ficar "todo vermelho", diminua; se ficar "apagado", aumente.
  peso: 0.3,

  // Raio de influência de cada ocorrência, em PIXELS (não em metros).
  raio: 18,

  // Suavização das bordas das manchas (também em pixels).
  desfoque: 15,

  // Zoom a partir do qual cada ocorrência tem o peso máximo.
  // Em zooms menores, o plugin reduz o peso automaticamente, para as
  // manchas não se acumularem e saturarem quando o mapa está afastado.
  zoomMaximo: 15,

  // Opacidade mínima das manchas mais fracas (0 a 1).
  opacidadeMinima: 0.3,

  // Cores, da intensidade mais baixa (0.2) à mais alta (1.0).
  gradiente: {
    0.2: "#ffffb2",
    0.4: "#fecc5c",
    0.6: "#fd8d3c",
    0.8: "#f03b20",
    1.0: "#bd0026"
  }
};


// =====================================================================
// 🗺️ MAPA
// =====================================================================
const map = L.map("map").setView(CENTRO_INICIAL, ZOOM_INICIAL);

// Camada de fundo com as ruas (OpenStreetMap).
L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }
).addTo(map);

// "Panes" são camadas de empilhamento: quanto maior o zIndex, mais por cima.
// A ordem final, de baixo para cima, fica assim:
//   400 mapa de calor (criado pelo plugin)
//   420 pontos de ônibus
//   450 ocorrências (pontos vermelhos)
map.createPane("panePontos");
map.getPane("panePontos").style.zIndex = 420;

map.createPane("paneCrimes");
map.getPane("paneCrimes").style.zIndex = 450;

// Os pontos são desenhados em Canvas (uma única "tela" de pixels), que é
// muito mais leve que SVG (um elemento HTML por ponto) quando há milhares deles.
// "tolerance" aumenta a área de clique, o que ajuda muito no celular.
const rendererPontos = L.canvas({ pane: "panePontos", tolerance: 4 });
const rendererCrimes = L.canvas({ pane: "paneCrimes", tolerance: 5 });


// =====================================================================
// 📦 VARIÁVEIS DE ESTADO
// =====================================================================

// Camada onde os pontos vermelhos (ocorrências) são desenhados.
const camadaCrimes = L.layerGroup().addTo(map);

// Dados das ocorrências, em três etapas de filtragem:
let listaAtual = [];     // vindas do servidor (já filtradas por ano e horário)
let listaFiltrada = [];  // listaAtual depois do filtro de bairro
let pontosCalor = [];    // listaFiltrada no formato do mapa de calor: [lat, lon, peso]

// Mapa de calor.
let camadaCalor = null;          // criada só quando for usada pela primeira vez
let calorDesatualizado = true;   // true = os dados mudaram e o calor precisa ser atualizado

// Pontos de ônibus.
let camadaPontos = null;         // criada na primeira vez que o zoom permite
let carregandoPontos = false;

// Controle de desenho dos pontos vermelhos.
let limitesDesenhados = null;    // área do mapa que já está desenhada
let versaoBusca = 0;             // ignora respostas antigas do servidor quando o filtro muda
let versaoDesenho = 0;           // cancela desenhos antigos quando algo muda
let carregando = false;          // true enquanto espera a resposta do servidor

// Texto de status mostrado acima do mapa.
let estadoCrimes = "";

// Elementos da página (definidos no index.html).
const filtroAno = document.getElementById("filtro");
const filtroFaixa = document.getElementById("filtro-faixa");
const filtroBairro = document.getElementById("filtro-bairro");
const filtroVisualizacao = document.getElementById("filtro-visualizacao");
const statusMapa = document.getElementById("status-mapa");

// O mapa de calor vem de um plugin carregado no index.html.
// Se ele não carregar (por exemplo, sem internet), o mapa continua
// funcionando só com pontos.
const calorDisponivel = typeof L.heatLayer === "function";
if (!calorDisponivel) {
  console.warn("Plugin do mapa de calor não carregou. Usando apenas pontos.");
}


// =====================================================================
// 🧰 FUNÇÕES AUXILIARES
// =====================================================================

// Troca caracteres especiais de HTML por versões seguras.
// Usamos antes de colocar textos dos dados dentro dos popups.
function escapar(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

// Converte lat/lon (que chegam como texto ou número) em números e
// descarta ocorrências sem coordenadas válidas. Fazemos isso uma única vez,
// ao receber os dados, para não repetir a conversão a cada movimento do mapa.
function prepararLista(lista) {
  const validas = [];

  lista.forEach((crime) => {
    const lat = parseFloat(crime.lat);
    const lon = parseFloat(crime.lon);

    if (isNaN(lat) || isNaN(lon)) return; // sem coordenada: ignora

    crime.latNum = lat; // guardamos os números no próprio objeto
    crime.lonNum = lon;
    validas.push(crime);
  });

  return validas;
}

// Decide o que mostrar agora: "calor" ou "pontos",
// de acordo com a escolha do usuário e com o zoom atual.
function modoEfetivo() {
  const escolha = filtroVisualizacao ? filtroVisualizacao.value : "auto";

  if (!calorDisponivel) return "pontos";
  if (escolha === "calor" || escolha === "pontos") return escolha;

  // Modo automático: calor com o mapa afastado, pontos com o mapa aproximado.
  return map.getZoom() >= ZOOM_TROCA_CALOR_PONTOS ? "pontos" : "calor";
}

// Monta o texto de status que aparece entre os filtros e o mapa.
function renderizarStatus() {
  const partes = [estadoCrimes];
  const escolha = filtroVisualizacao ? filtroVisualizacao.value : "auto";

  // Dica: no modo automático, o calor dá lugar aos pontos ao aproximar.
  if (!carregando && modoEfetivo() === "calor" && escolha === "auto" && listaFiltrada.length > 0) {
    partes.push("Aproxime o mapa para ver cada ocorrência.");
  }

  // Dica: os pontos de ônibus só aparecem com o mapa aproximado.
  if (map.getZoom() < ZOOM_MINIMO_PONTOS) {
    partes.push("Aproxime o mapa para ver os pontos de ônibus.");
  }

  if (statusMapa) {
    statusMapa.textContent = partes.filter(Boolean).join(" ");
  }
}


// =====================================================================
// 💬 POPUPS
// São funções que montam o texto só quando o usuário clica.
// Assim não gastamos memória com milhares de textos que ninguém abriu.
// =====================================================================
function popupPonto(feature) {
  const nome = feature.properties?.nm_ponto_onibus || "Ponto de ônibus";

  return `
<div style="min-width:180px">
<h3 style="margin:0;color:#0066ff;font-size:16px;">Ponto de Ônibus</h3>
<hr>
<b>Nome:</b><br>
${escapar(nome)}
</div>
`;
}

function popupCrime(crime) {
  return `
<div style="min-width:180px">
<h3 style="margin:0;color:#cc0000;font-size:16px;">Ocorrência</h3>
<hr>
<b>Tipo:</b> ${escapar(crime.tipo_crime || "N/A")}<br>
<b>Ano:</b> ${escapar(crime.ano)}<br>
<b>Hora:</b> ${escapar(crime.hora || "N/A")}<br>
<b>Bairro:</b> ${escapar(crime.bairro || "N/A")}<br>
<b>Logradouro:</b> ${escapar(crime.logradouro || "N/A")}
</div>
`;
}


// =====================================================================
// 🚌 PONTOS DE ÔNIBUS
// Só são baixados e desenhados quando o zoom é alto o bastante.
// =====================================================================
function carregarPontos() {
  if (carregandoPontos) return; // já tem uma busca em andamento
  carregandoPontos = true;

  fetch("/api/pontos_onibus")
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((geojson) => {
      // L.geoJSON transforma o arquivo GeoJSON em camadas do mapa.
      camadaPontos = L.geoJSON(geojson, {
        // Cada ponto do arquivo vira um círculo azul.
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, {
            renderer: rendererPontos,
            radius: 7,
            color: "#0066ff",
            fillColor: "#3399ff",
            fillOpacity: 1,
            weight: 2
          });
        },
        // Ao clicar no círculo, abre o popup (montado só nesse momento).
        onEachFeature: (feature, layer) => {
          layer.bindPopup(() => popupPonto(feature));
        }
      });

      atualizarPontos(); // agora que a camada existe, decide se mostra
    })
    .catch((err) => console.error("Erro ao carregar pontos de ônibus:", err))
    .finally(() => {
      carregandoPontos = false;
    });
}

// Mostra ou esconde os pontos de ônibus conforme o zoom.
function atualizarPontos() {
  const zoomSuficiente = map.getZoom() >= ZOOM_MINIMO_PONTOS;

  if (zoomSuficiente) {
    if (!camadaPontos) {
      carregarPontos();                // primeira vez: busca no servidor
    } else if (!map.hasLayer(camadaPontos)) {
      camadaPontos.addTo(map);         // já temos os dados: só mostra
    }
  } else if (camadaPontos && map.hasLayer(camadaPontos)) {
    map.removeLayer(camadaPontos);     // mapa afastado: esconde
  }

  renderizarStatus();
}


// =====================================================================
// 🔥 MAPA DE CALOR
// =====================================================================

// Legenda do mapa de calor (barra de cores "Menos ... Mais").
// Ela usa as mesmas cores definidas em CALOR.gradiente.
let legendaVisivel = false;

const legendaCalor = L.control({ position: "bottomright" });

legendaCalor.onAdd = function () {
  const div = L.DomUtil.create("div", "legenda-calor leaflet-control");

  // Transforma {0.2: "#ffffb2", ...} em "#ffffb2 20%, ..." para o CSS.
  const cores = Object.entries(CALOR.gradiente)
    .map(([posicao, cor]) => `${cor} ${Math.round(posicao * 100)}%`)
    .join(", ");

  div.innerHTML = `
    <span>Menos</span>
    <div class="legenda-calor-barra" style="background: linear-gradient(to right, ${cores})"></div>
    <span>Mais</span>
  `;
  return div;
};

function mostrarCalor() {
  // Cria a camada na primeira vez que ela é necessária.
  if (!camadaCalor) {
    camadaCalor = L.heatLayer(pontosCalor, {
      radius: CALOR.raio,
      blur: CALOR.desfoque,
      maxZoom: CALOR.zoomMaximo,
      minOpacity: CALOR.opacidadeMinima,
      gradient: CALOR.gradiente
    });
    calorDesatualizado = false;
  }

  // Se os dados mudaram desde a última vez, atualiza a camada.
  if (calorDesatualizado) {
    camadaCalor.setLatLngs(pontosCalor);
    calorDesatualizado = false;
  }

  if (!map.hasLayer(camadaCalor)) camadaCalor.addTo(map);

  if (!legendaVisivel) {
    legendaCalor.addTo(map);
    legendaVisivel = true;
  }

  estadoCrimes = listaFiltrada.length > 0
    ? `${listaFiltrada.length.toLocaleString("pt-BR")} ocorrências no mapa de calor.`
    : "Nenhuma ocorrência encontrada para este filtro.";
}

function esconderCalor() {
  if (camadaCalor && map.hasLayer(camadaCalor)) map.removeLayer(camadaCalor);

  if (legendaVisivel) {
    legendaCalor.remove();
    legendaVisivel = false;
  }
}


// =====================================================================
// 🔴 OCORRÊNCIAS COMO PONTOS
// =====================================================================

// Remove os pontos vermelhos e cancela qualquer desenho em andamento.
function esconderPontosOcorrencias() {
  versaoDesenho++;            // qualquer desenho em andamento percebe isso e para
  camadaCrimes.clearLayers();
  limitesDesenhados = null;   // nada está desenhado agora
}

// Desenha apenas as ocorrências que estão na área visível (mais uma margem).
// Com isso, mesmo com milhares de ocorrências no total, o mapa só cuida
// das poucas centenas que o usuário está de fato vendo.
function mostrarPontosOcorrencias() {
  // Se o que já está desenhado cobre a tela inteira, não precisa refazer.
  if (limitesDesenhados && limitesDesenhados.contains(map.getBounds())) return;

  const versao = ++versaoDesenho;
  camadaCrimes.clearLayers();

  // Área a desenhar = tela atual + margem.
  const area = map.getBounds().pad(MARGEM_DESENHO);
  limitesDesenhados = area;

  const sul = area.getSouth();
  const norte = area.getNorth();
  const oeste = area.getWest();
  const leste = area.getEast();

  // Separa só as ocorrências que caem dentro da área.
  const visiveis = listaFiltrada.filter((crime) =>
    crime.latNum >= sul && crime.latNum <= norte &&
    crime.lonNum >= oeste && crime.lonNum <= leste
  );

  desenharCrimes(visiveis, versao, listaFiltrada.length);
}

// Desenha a lista de ocorrências em lotes, para a página não travar.
//   lista  = ocorrências a desenhar agora
//   versao = número deste desenho (se mudar, este desenho é cancelado)
//   total  = quantas ocorrências existem no filtro (para o texto de status)
function desenharCrimes(lista, versao, total) {
  let indice = 0;

  function desenharLote() {
    if (versao !== versaoDesenho) return; // algo mudou: desenho cancelado

    const fim = Math.min(indice + TAMANHO_LOTE, lista.length);

    for (; indice < fim; indice++) {
      const crime = lista[indice];

      // Cada ocorrência é um pequeno círculo vermelho.
      L.circleMarker([crime.latNum, crime.lonNum], {
        renderer: rendererCrimes,
        radius: 3,
        color: "#cc0000",
        fillColor: "#ff4d4d",
        fillOpacity: 0.7,
        weight: 1
      })
        .addTo(camadaCrimes)
        .bindPopup(() => popupCrime(crime)); // popup montado só ao clicar
    }

    if (indice < lista.length) {
      // Ainda falta desenhar: mostra o progresso e continua no próximo quadro.
      estadoCrimes = `Desenhando ocorrências... (${indice.toLocaleString("pt-BR")} de ${lista.length.toLocaleString("pt-BR")})`;
      renderizarStatus();
      requestAnimationFrame(desenharLote);
    } else {
      // Terminou: escreve o resumo.
      if (total === 0) {
        estadoCrimes = "Nenhuma ocorrência encontrada para este filtro.";
      } else if (lista.length === 0) {
        estadoCrimes = "Nenhuma ocorrência nesta área. Mova o mapa ou afaste o zoom.";
      } else if (lista.length === total) {
        estadoCrimes = `${total.toLocaleString("pt-BR")} ocorrências exibidas.`;
      } else {
        estadoCrimes = `${lista.length.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} ocorrências nesta área.`;
      }
      renderizarStatus();
    }
  }

  desenharLote();
}


// =====================================================================
// 🎛️ ATUALIZAR A VISUALIZAÇÃO
// Função central: decide entre calor e pontos e atualiza o que for preciso.
// É chamada quando: os dados mudam, o usuário troca a visualização
// ou o mapa é movido/aproximado.
// =====================================================================
function atualizarVisualizacao() {
  // Enquanto espera o servidor, não desenha nada (os dados ainda são antigos).
  if (carregando) {
    renderizarStatus();
    return;
  }

  if (modoEfetivo() === "calor") {
    esconderPontosOcorrencias();
    mostrarCalor();
  } else {
    esconderCalor();
    mostrarPontosOcorrencias();
  }

  renderizarStatus();
}


// =====================================================================
// 📥 BUSCAR OCORRÊNCIAS NO SERVIDOR (filtros de ano e horário)
// =====================================================================
function carregarOcorrencias() {
  const busca = ++versaoBusca;

  // Limpa o que estava na tela e marca que estamos carregando.
  carregando = true;
  listaAtual = [];
  listaFiltrada = [];
  pontosCalor = [];
  calorDesatualizado = true;
  esconderPontosOcorrencias();
  if (camadaCalor) camadaCalor.setLatLngs([]);

  estadoCrimes = "Carregando ocorrências...";
  renderizarStatus();

  // Monta o endereço da busca: /api/crimes?ano=2025&faixa=noite
  const params = new URLSearchParams({
    ano: filtroAno.value,
    faixa: filtroFaixa.value
  });

  // O servidor já devolve só o ano e o horário pedidos
  // (e o navegador reaproveita respostas repetidas).
  fetch(`/api/crimes?${params}`)
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((lista) => {
      if (busca !== versaoBusca) return; // o usuário já escolheu outro filtro

      listaAtual = prepararLista(lista);
      carregando = false;
      aplicarFiltroBairro(false);
    })
    .catch((err) => {
      console.error("Erro ao carregar crimes:", err);
      if (busca !== versaoBusca) return;

      carregando = false;
      estadoCrimes = "Não foi possível carregar as ocorrências. Atualize a página para tentar de novo.";
      renderizarStatus();
    });
}


// =====================================================================
// 🏘️ FILTRO DE BAIRRO (feito aqui no navegador, sem nova busca)
//   ajustarMapa = true  -> move o mapa para enquadrar o bairro escolhido
// =====================================================================
function aplicarFiltroBairro(ajustarMapa) {
  const bairro = filtroBairro ? filtroBairro.value : "todos";

  // Mantém só as ocorrências do bairro escolhido (ou todas).
  listaFiltrada = bairro === "todos"
    ? listaAtual
    : listaAtual.filter((crime) => crime.bairro === bairro);

  // Prepara os dados do mapa de calor: [latitude, longitude, peso].
  pontosCalor = listaFiltrada.map((crime) => [crime.latNum, crime.lonNum, CALOR.peso]);
  calorDesatualizado = true;

  // Força o redesenho dos pontos (a área "já desenhada" deixou de valer).
  esconderPontosOcorrencias();

  if (ajustarMapa) ajustarVisao(bairro);

  atualizarVisualizacao();
}

// Ao escolher um bairro, o mapa enquadra as ocorrências dele;
// ao voltar para "Todos", volta à visão da cidade.
function ajustarVisao(bairro) {
  if (bairro === "todos") {
    map.setView(CENTRO_INICIAL, ZOOM_INICIAL);
    return;
  }

  if (listaFiltrada.length === 0) return; // nada para enquadrar

  const coordenadas = listaFiltrada.map((crime) => [crime.latNum, crime.lonNum]);
  map.fitBounds(L.latLngBounds(coordenadas), { padding: [30, 30], maxZoom: 16 });
}


// =====================================================================
// 🏷️ LISTA DE BAIRROS (para preencher o filtro)
// =====================================================================
function carregarBairros() {
  if (!filtroBairro) return;

  fetch("/api/bairros")
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((bairros) => {
      // Cria uma <option> para cada bairro.
      // textContent (em vez de innerHTML) evita problemas com caracteres especiais.
      bairros.forEach((nome) => {
        const opcao = document.createElement("option");
        opcao.value = nome;
        opcao.textContent = nome;
        filtroBairro.appendChild(opcao);
      });
    })
    .catch((err) => console.error("Erro ao carregar bairros:", err));
}


// =====================================================================
// 👂 EVENTOS (o que acontece quando o usuário interage)
// =====================================================================

// Ano ou horário mudou: busca os dados de novo no servidor.
if (filtroAno) filtroAno.addEventListener("change", carregarOcorrencias);
if (filtroFaixa) filtroFaixa.addEventListener("change", carregarOcorrencias);

// Bairro mudou: filtra no navegador e enquadra o bairro no mapa.
if (filtroBairro) filtroBairro.addEventListener("change", () => aplicarFiltroBairro(true));

// Visualização mudou (automática, calor ou pontos): só redesenha.
if (filtroVisualizacao) filtroVisualizacao.addEventListener("change", atualizarVisualizacao);

// O mapa foi movido ou aproximado.
// "moveend" também dispara depois de um zoom, então cobre os dois casos.
map.on("moveend", atualizarVisualizacao);

// Pontos de ônibus dependem só do zoom.
map.on("zoomend", atualizarPontos);


// =====================================================================
// 🚀 INICIAR
// =====================================================================
carregarBairros();
carregarOcorrencias();
atualizarPontos();
