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
//   5. Mostra os pontos de ônibus só na visualização de pontos, com o zoom alto.
//   6. Permite buscar um endereço e levar o mapa até ele (caixa sobre o mapa).
// =====================================================================


// =====================================================================
// ⚙️ CONFIGURAÇÕES
// Valores que você pode ajustar sem mexer no resto do código.
// =====================================================================

// Visão inicial do mapa: centro da cidade de São Paulo.
const CENTRO_INICIAL = [-23.55, -46.63];
const ZOOM_INICIAL = 11;

// Zoom mínimo permitido: impede afastar o mapa além da região metropolitana.
// (No zoom 10 ainda dá para ver a cidade inteira numa tela de celular.
// Se quiser limitar mais, use 11; se quiser liberar, apague o minZoom do L.map.)
const ZOOM_MINIMO_MAPA = 10;

// No modo "Automática": abaixo deste zoom mostramos o mapa de calor;
// a partir dele, mostramos cada ocorrência como um ponto.
// (Quanto maior o número do zoom, mais "perto" o mapa está.)
const ZOOM_TROCA_CALOR_PONTOS = 15;

// Os pontos de ônibus aparecem no mesmo zoom em que o calor vira pontos
// (e só na visualização de pontos; no mapa de calor eles não são usados).
// (Esta linha precisa ficar depois da constante acima, porque depende dela.)
const ZOOM_MINIMO_PONTOS = ZOOM_TROCA_CALOR_PONTOS;

// Quantas ocorrências desenhar por "quadro" de animação.
// Desenhar em lotes evita que a página trave quando há muitos pontos.
const TAMANHO_LOTE = 2000;

// Tempo máximo de espera pela resposta do servidor ao buscar ocorrências, em
// milissegundos. Passando disso, a busca é cancelada e o usuário recebe um aviso
// (em vez de ficar esperando para sempre com o mapa em branco).
const TEMPO_LIMITE_BUSCA_MS = 60000;

// No modo de pontos, desenhamos também uma margem em volta da tela,
// para não precisar redesenhar a cada pequeno arrasto do mapa.
// 0.5 = margem de 50% do tamanho da tela em cada lado.
const MARGEM_DESENHO = 0.5;

// Ajustes do mapa de calor (plugin Leaflet.heat).
//
// COMO ELE FUNCIONA (para entender os números abaixo):
//   O plugin divide a tela em pequenas células e conta quantas ocorrências
//   caem em cada uma. A cor de cada célula depende de (contagem / máximo):
//   quanto mais perto de 1, mais escura. Células vizinhas se somam.
//   Ao afastar o mapa, cada célula cobre uma área maior e junta mais
//   ocorrências, então o "máximo" é recalculado a cada nível de zoom
//   (veja a função maximoDoCalor).
//
// Estes valores são um ponto de partida. Para testar outros valores SEM
// editar o arquivo, abra o Console do navegador (F12) e digite, por exemplo:
//     ajustarCalor({ ocorrenciasParaMaximo: 6 })
const CALOR = {
  // Quantas ocorrências numa mesma célula, no zoom de referência (abaixo),
  // deixam a cor no máximo (vermelho escuro).
  //   Mapa todo vermelho -> AUMENTE este número.
  //   Mapa muito apagado -> DIMINUA este número.
  ocorrenciasParaMaximo: 12,

  // Nível de zoom em que o número acima vale.
  zoomReferencia: 14,

  // A cada nível de zoom que o mapa se afasta, as células cobrem uma área 4 vezes
  // maior. Como as ocorrências se concentram em poucos lugares, a contagem não
  // cresce tanto assim: este fator (entre 2 e 4) compensa o crescimento.
  //   Mapa afastado mais vermelho que o aproximado -> AUMENTE o fator.
  //   Mapa afastado mais apagado que o aproximado  -> DIMINUA o fator.
  fatorPorZoom: 3,

  // Raio de influência de cada ocorrência, em PIXELS (não em metros).
  raio: 18,

  // Suavização das bordas das manchas (também em pixels).
  desfoque: 15,

  // Opacidade máxima do mapa de calor como um todo (0 a 1).
  // Com 1, as manchas mais escuras cobrem por completo os nomes de bairros e
  // ruas que estão no mapa por baixo; valores menores deixam os nomes visíveis.
  //   Nomes ainda difíceis de ler -> DIMINUA (por exemplo, 0.5).
  //   Cores muito fracas          -> AUMENTE (por exemplo, 0.8).
  opacidadeMaxima: 0.9,

  // Opacidade mínima que CADA célula com ocorrência recebe (0 a 1).
  // Deve ser bem baixa: células vizinhas somam as opacidades, então um valor
  // alto (como 0.3) deixa tudo vermelho mesmo onde há poucas ocorrências.
  opacidadeMinima: 0.02,

  // Cores, da intensidade mais baixa (0.15) à mais alta (1.0).
  gradiente: {
    0.15: "#fed976",
    0.35: "#feb24c",
    0.55: "#fd8d3c",
    0.75: "#e31a1c",
    1.0: "#800026"
  }
};

// =====================================================================
// 🔎 CONFIGURAÇÕES DA BUSCA POR ENDEREÇO
// Usamos o Nominatim, o serviço de busca de endereços do OpenStreetMap.
// Ele é gratuito, mas tem regras de uso: no máximo 1 busca por segundo e
// nada de "autocompletar enquanto digita". Por isso a busca só acontece
// quando o usuário aperta Enter ou clica em "Buscar".
// Para trocar de serviço no futuro, o ponto de partida é esta configuração
// e a função buscarEndereco().
// =====================================================================
const BUSCA = {
  // Endereço do serviço de busca.
  url: "https://nominatim.openstreetmap.org/search",

  // Área onde procuramos: uma caixa em volta da cidade de São Paulo,
  // no formato [oeste, norte, leste, sul] (longitude/latitude).
  areaDeBusca: [-46.85, -23.33, -46.34, -24.03],

  // Quantos resultados mostrar, no máximo, quando o endereço é ambíguo.
  maxResultados: 5,

  // Zoom máximo ao levar o mapa até o resultado (17 = nível de rua/quadra).
  zoomMaximo: 17,

  // Intervalo mínimo entre duas buscas, em milissegundos (regra do serviço).
  intervaloMinimoMs: 1000
};


// =====================================================================
// 🗺️ MAPA
// =====================================================================
// zoomControl: false -> os botões de zoom são adicionados no fim do arquivo,
// DEPOIS da caixa de busca, para a busca ficar no topo e o zoom logo abaixo.
const map = L.map("map", { minZoom: ZOOM_MINIMO_MAPA, zoomControl: false })
  .setView(CENTRO_INICIAL, ZOOM_INICIAL);

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

// O mapa de calor é desenhado no painel padrão "overlayPane". Como os pontos
// vermelhos e azuis usam painéis próprios (criados acima), esse painel contém
// só o calor, então podemos controlar a opacidade dele sem afetar mais nada.
function aplicarOpacidadeDoCalor() {
  map.getPane("overlayPane").style.opacity = CALOR.opacidadeMaxima;
}
aplicarOpacidadeDoCalor();


// =====================================================================
// 📦 VARIÁVEIS DE ESTADO
// =====================================================================

// Camada onde os pontos vermelhos (ocorrências) são desenhados.
const camadaCrimes = L.layerGroup().addTo(map);

// Dados das ocorrências, em três etapas de filtragem:
let listaAtual = [];     // vindas do servidor (já filtradas por ano e horário)
let listaFiltrada = [];  // listaAtual depois do filtro de bairro
let pontosCalor = [];    // listaFiltrada no formato do mapa de calor: [lat, lon, 1]

// Mapa de calor.
let camadaCalor = null;          // criada só quando for usada pela primeira vez
let calorDesatualizado = true;   // true = os dados mudaram e o calor precisa ser atualizado
let zoomDoCalor = null;          // zoom para o qual o "máximo" do calor foi calculado

// Pontos de ônibus.
let camadaPontos = null;         // criada na primeira vez que o zoom permite
let carregandoPontos = false;

// Controle de desenho dos pontos vermelhos.
let limitesDesenhados = null;    // área do mapa que já está desenhada
let versaoBusca = 0;             // ignora respostas antigas do servidor quando o filtro muda
let versaoDesenho = 0;           // cancela desenhos antigos quando algo muda
let carregando = false;          // true enquanto espera a resposta do servidor
let abortarOcorrencias = null;   // permite cancelar a busca de ocorrências anterior

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
  const mapaAfastado = map.getZoom() < ZOOM_MINIMO_PONTOS;

  // Na visualização "Mapa de calor" os pontos de ônibus não são usados,
  // então não faz sentido sugerir aproximar o mapa para vê-los.
  if (escolha !== "calor" && mapaAfastado) {
    // No modo automático, com o calor na tela, aproximar revela as duas coisas
    // de uma vez: as ocorrências e os pontos de ônibus.
    const calorEmModoAutomatico =
      !carregando && modoEfetivo() === "calor" && escolha === "auto" && listaFiltrada.length > 0;

    partes.push(
      calorEmModoAutomatico
        ? "Aproxime o mapa para ver cada ocorrência e os pontos de ônibus."
        : "Aproxime o mapa para ver os pontos de ônibus."
    );
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

// Mostra ou esconde os pontos de ônibus.
// Eles só aparecem quando as duas condições abaixo são verdadeiras:
//   1) a visualização atual é a de pontos (no mapa de calor não são necessários);
//   2) o zoom está alto o bastante.
// Enquanto isso não acontecer, os pontos de ônibus nem são baixados do servidor.
// Depois de baixados uma vez, ficam guardados e só são escondidos/mostrados.
function atualizarPontos() {
  const deveMostrar = modoEfetivo() === "pontos" && map.getZoom() >= ZOOM_MINIMO_PONTOS;

  if (deveMostrar) {
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

  // Transforma {0.15: "#fed976", ...} em "#fed976 15%, ..." para o CSS.
  // ATENÇÃO: é preciso ORDENAR pela posição. O JavaScript lista primeiro as
  // chaves que são números inteiros (como a "1" de 1.0), e o CSS exige as
  // cores em ordem crescente; fora de ordem, a barra fica de uma cor só.
  const cores = Object.entries(CALOR.gradiente)
    .map(([posicao, cor]) => [parseFloat(posicao), cor])
    .sort((a, b) => a[0] - b[0])
    .map(([posicao, cor]) => `${cor} ${Math.round(posicao * 100)}%`)
    .join(", ");

  div.innerHTML = `
    <span>Menos</span>
    <div class="legenda-calor-barra" style="background: linear-gradient(to right, ${cores}); opacity: ${CALOR.opacidadeMaxima}"></div>
    <span>Mais</span>
  `;
  return div;
};

// Calcula o "máximo" do mapa de calor para um nível de zoom.
// Afastando o mapa, cada célula junta mais ocorrências, então o máximo sobe.
// Exemplo com os valores padrão (12 no zoom 14, fator 3):
//   zoom 14 -> 12   |   zoom 13 -> 36   |   zoom 11 -> 324
function maximoDoCalor(zoom) {
  return CALOR.ocorrenciasParaMaximo * Math.pow(CALOR.fatorPorZoom, CALOR.zoomReferencia - zoom);
}

// Opções que enviamos ao plugin do mapa de calor.
function opcoesDoCalor() {
  return {
    radius: CALOR.raio,
    blur: CALOR.desfoque,
    minOpacity: CALOR.opacidadeMinima,
    gradient: CALOR.gradiente,
    max: maximoDoCalor(map.getZoom()),
    // maxZoom: 1 desliga o ajuste automático que o plugin faz por zoom,
    // porque já fazemos o nosso em maximoDoCalor().
    maxZoom: 1
  };
}

// Converte listaFiltrada no formato do plugin: [latitude, longitude, peso].
// Cada ocorrência tem peso 1; é a soma dos pesos em cada célula que define a cor.
function prepararPontosCalor() {
  pontosCalor = listaFiltrada.map((crime) => [crime.latNum, crime.lonNum, 1]);
  calorDesatualizado = true;
}

function mostrarCalor() {
  const zoom = map.getZoom();

  if (!camadaCalor || !map.hasLayer(camadaCalor)) {
    // O calor não está na tela (primeira vez, ou voltando do modo de pontos).
    // ATENÇÃO: não dá para atualizar a camada do plugin enquanto ela está fora
    // do mapa: setLatLngs() e setOptions() dão erro nesse caso (o plugin tenta ler
    // o mapa, que não existe mais). Por isso criamos uma camada nova, já com os
    // dados e as opções atuais, e só então a colocamos no mapa.
    camadaCalor = L.heatLayer(pontosCalor, opcoesDoCalor());
    camadaCalor.addTo(map);
    calorDesatualizado = false;
    zoomDoCalor = zoom;
  } else {
    // O calor já está na tela: aqui é seguro atualizá-lo.

    // Se os dados mudaram desde a última vez, atualiza a camada.
    if (calorDesatualizado) {
      camadaCalor.setLatLngs(pontosCalor);
      calorDesatualizado = false;
    }

    // Se o zoom mudou, o "máximo" precisa ser recalculado.
    // (Só reenviamos quando muda, para não redesenhar à toa a cada arrasto.)
    if (zoom !== zoomDoCalor) {
      camadaCalor.setOptions(opcoesDoCalor());
      zoomDoCalor = zoom;
    }
  }

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

  // Descartamos a camada: depois de removida ela não pode mais ser atualizada
  // (veja o comentário em mostrarCalor). Uma nova é criada quando o calor voltar.
  camadaCalor = null;

  if (legendaVisivel) {
    legendaCalor.remove();
    legendaVisivel = false;
  }
}

// Ferramenta de ajuste (útil para estudo e testes): permite mudar os valores
// do mapa de calor sem editar o arquivo. No Console do navegador (F12), digite:
//     ajustarCalor({ ocorrenciasParaMaximo: 6, raio: 14 })
// Os valores voltam ao normal quando a página é recarregada.
// Quando achar valores bons, copie-os para o bloco CALOR no topo do arquivo.
window.ajustarCalor = function (novos) {
  Object.assign(CALOR, novos);  // atualiza as configurações
  aplicarOpacidadeDoCalor();    // a opacidade é aplicada direto no painel do mapa
  zoomDoCalor = null;           // força reenviar as opções ao plugin

  // A legenda é montada a partir das cores, então é refeita se estiver na tela.
  if (legendaVisivel) {
    legendaCalor.remove();
    legendaVisivel = false;
  }

  atualizarVisualizacao();
  return CALOR;                 // mostra os valores atuais no Console
};

// Ferramenta de diagnóstico: se o mapa parar de desenhar, abra o Console do
// navegador (F12), digite  diagnosticoMapa()  e envie a tabela que aparecer.
// Ela mostra o estado interno do mapa naquele momento, sem alterar nada.
window.diagnosticoMapa = function () {
  const estado = {
    zoom: map.getZoom(),
    visualizacaoEscolhida: filtroVisualizacao ? filtroVisualizacao.value : "auto",
    visualizacaoEmUso: modoEfetivo(),
    carregando: carregando,
    ocorrenciasRecebidas: listaAtual.length,
    ocorrenciasAposFiltroDeBairro: listaFiltrada.length,
    pontosVermelhosNoMapa: camadaCrimes.getLayers().length,
    calorNoMapa: !!camadaCalor && map.hasLayer(camadaCalor),
    pontosDeOnibusCarregados: !!camadaPontos,
    pontosDeOnibusNoMapa: !!camadaPontos && map.hasLayer(camadaPontos),
    areaJaDesenhada: limitesDesenhados ? limitesDesenhados.toBBoxString() : null,
    versaoBusca: versaoBusca,
    versaoDesenho: versaoDesenho,
    textoDeStatus: estadoCrimes
  };
  console.table(estado);
  return estado;
};

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
  // Os pontos de ônibus dependem da visualização escolhida, então são
  // reavaliados junto (eles não dependem dos dados de ocorrências).
  // O try/catch isola esta etapa: se ela falhar, o resto continua funcionando.
  try {
    atualizarPontos();
  } catch (erro) {
    console.error("Erro ao atualizar os pontos de ônibus:", erro);
  }

  // Enquanto espera o servidor, não desenha nada (os dados ainda são antigos).
  if (carregando) {
    renderizarStatus();
    return;
  }

  try {
    if (modoEfetivo() === "calor") {
      esconderPontosOcorrencias();
      mostrarCalor();
    } else {
      esconderCalor();
      mostrarPontosOcorrencias();
    }
  } catch (erro) {
    // Em vez de o mapa simplesmente "parar", registramos o erro no Console (F12)
    // e avisamos o usuário.
    console.error("Erro ao desenhar a visualização:", erro);
    estadoCrimes = "Não foi possível desenhar as ocorrências. Mude um filtro para tentar de novo.";
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

  // Só esvazia o calor se ele está na tela. Fora do mapa não há o que apagar
  // (calorDesatualizado já garante que ele será atualizado quando voltar).
  if (camadaCalor && map.hasLayer(camadaCalor)) camadaCalor.setLatLngs([]);

  estadoCrimes = "Carregando ocorrências...";
  renderizarStatus();

  // Monta o endereço da busca: /api/crimes?ano=2025&faixa=noite
  const params = new URLSearchParams({
    ano: filtroAno.value,
    faixa: filtroFaixa.value
  });

  // Se ainda havia uma busca anterior em andamento, cancela: só a mais recente importa.
  if (abortarOcorrencias) abortarOcorrencias.abort();
  const controlador = new AbortController();
  abortarOcorrencias = controlador;

  // Cancela também se o servidor demorar demais.
  const temporizador = setTimeout(() => controlador.abort(), TEMPO_LIMITE_BUSCA_MS);

  // O servidor já devolve só o ano e o horário pedidos
  // (e o navegador reaproveita respostas repetidas).
  fetch(`/api/crimes?${params}`, { signal: controlador.signal })
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
      if (busca !== versaoBusca) return; // busca antiga (cancelada ou substituída): ignora

      console.error("Erro ao carregar ou desenhar as ocorrências:", err);
      carregando = false;

      estadoCrimes = err.name === "AbortError"
        ? "O servidor demorou para responder. Mude um filtro ou atualize a página para tentar de novo."
        : "Não foi possível carregar as ocorrências. Mude um filtro ou atualize a página para tentar de novo.";
      renderizarStatus();
    })
    .finally(() => clearTimeout(temporizador));
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

  // Prepara os dados do mapa de calor.
  prepararPontosCalor();

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
// 🔎 BUSCA POR ENDEREÇO
// Uma caixa de texto sobre o mapa. O usuário digita um endereço, aperta Enter
// e o mapa vai até lá, marcando o local com um alfinete. Com o mapa perto,
// as ocorrências e os pontos de ônibus da região aparecem normalmente.
// =====================================================================

let marcadorBusca = null;        // o alfinete do endereço encontrado
let abortarBusca = null;         // permite cancelar uma busca que ainda não terminou
let ultimaBuscaEm = 0;           // quando foi a última busca (para respeitar 1 por segundo)
const buscaEls = {};             // guarda os elementos da caixa: input, status e lista

// Mostra uma mensagem pequena embaixo da caixa de busca.
function mostrarMensagemBusca(texto) {
  buscaEls.status.textContent = texto;
}

// Esvazia a lista de resultados.
function limparResultadosBusca() {
  buscaEls.lista.innerHTML = "";
}

// Monta um texto curto para o resultado, como "Avenida Paulista, 1000 - Bela Vista".
// (O texto completo que o serviço devolve é longo demais.)
function rotuloDoResultado(item) {
  const a = item.address || {};

  // Nome principal: o nome do local ou a rua. Se há número, acrescenta.
  let principal = item.name || a.road || "";
  if (a.house_number && principal === a.road) principal += `, ${a.house_number}`;

  const bairro = a.suburb || a.city_district || a.neighbourhood || "";
  const partes = [principal, bairro].filter(Boolean);

  if (partes.length > 0) return partes.join(" - ");

  // Plano B: as três primeiras partes do texto completo.
  return String(item.display_name || "Endereço encontrado").split(",").slice(0, 3).join(",");
}

// Leva o mapa até o resultado escolhido e coloca o alfinete.
function irParaResultado(item) {
  const lat = parseFloat(item.lat);
  const lon = parseFloat(item.lon);
  if (isNaN(lat) || isNaN(lon)) return;

  limparResultadosBusca();
  const rotulo = rotuloDoResultado(item);
  mostrarMensagemBusca(rotulo);

  // Troca o alfinete antigo pelo novo.
  if (marcadorBusca) marcadorBusca.remove();
  marcadorBusca = L.marker([lat, lon], { title: rotulo })
    .addTo(map)
    .bindPopup(`<b>${escapar(rotulo)}</b>`);

  // O serviço devolve a "caixa" do local: pequena para uma casa, maior para
  // uma rua ou um bairro. Enquadramos essa caixa, sem passar do zoom máximo.
  // A caixa vem como texto: [sul, norte, oeste, leste].
  if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
    const [sul, norte, oeste, leste] = item.boundingbox.map(parseFloat);
    map.fitBounds([[sul, oeste], [norte, leste]], { padding: [40, 40], maxZoom: BUSCA.zoomMaximo });
  } else {
    map.setView([lat, lon], BUSCA.zoomMaximo);
  }
}

// Decide o que fazer com a lista de resultados que o serviço devolveu.
function tratarResultadosBusca(resultados) {
  if (!Array.isArray(resultados) || resultados.length === 0) {
    mostrarMensagemBusca("Nenhum endereço encontrado em São Paulo. Tente incluir o nome da rua e o número.");
    return;
  }

  // Um único resultado: vai direto.
  if (resultados.length === 1) {
    irParaResultado(resultados[0]);
    return;
  }

  // Vários resultados: o usuário escolhe.
  mostrarMensagemBusca("Escolha um dos resultados:");
  resultados.forEach((item) => {
    const li = document.createElement("li");
    const botao = document.createElement("button");
    botao.type = "button";
    botao.textContent = rotuloDoResultado(item); // textContent evita problemas com caracteres especiais
    botao.addEventListener("click", () => irParaResultado(item));
    li.appendChild(botao);
    buscaEls.lista.appendChild(li);
  });
}

// Faz a busca no serviço de endereços.
async function buscarEndereco(texto) {
  texto = texto.trim();

  if (texto.length < 3) {
    mostrarMensagemBusca("Digite pelo menos 3 caracteres.");
    return;
  }

  // Se havia uma busca em andamento, cancela: só a mais recente importa.
  if (abortarBusca) abortarBusca.abort();
  const controlador = new AbortController();
  abortarBusca = controlador;

  limparResultadosBusca();
  mostrarMensagemBusca("Buscando...");

  // Respeita o limite de 1 busca por segundo do serviço.
  const espera = BUSCA.intervaloMinimoMs - (Date.now() - ultimaBuscaEm);
  if (espera > 0) await new Promise((resolve) => setTimeout(resolve, espera));
  if (controlador.signal.aborted) return;
  ultimaBuscaEm = Date.now();

  // Se o texto não menciona a cidade, acrescentamos, para melhorar a precisão.
  const consulta = /s[ãa]o paulo/i.test(texto) ? texto : `${texto}, São Paulo`;

  const params = new URLSearchParams({
    q: consulta,
    format: "jsonv2",                           // formato da resposta
    addressdetails: "1",                        // traz rua, número, bairro separados
    limit: String(BUSCA.maxResultados),
    countrycodes: "br",
    "accept-language": "pt-BR",
    viewbox: BUSCA.areaDeBusca.join(","),       // a caixa em volta de São Paulo
    bounded: "1"                                // 1 = só aceita resultados dentro da caixa
  });

  try {
    const res = await fetch(`${BUSCA.url}?${params}`, { signal: controlador.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);

    const resultados = await res.json();
    if (controlador.signal.aborted) return;

    tratarResultadosBusca(resultados);
  } catch (erro) {
    if (erro.name === "AbortError") return; // busca cancelada de propósito
    console.error("Erro na busca de endereço:", erro);
    mostrarMensagemBusca("Não foi possível buscar agora. Tente novamente em instantes.");
  }
}

// Limpa tudo: texto, mensagens, lista e alfinete.
function limparBusca() {
  if (abortarBusca) abortarBusca.abort();
  if (marcadorBusca) {
    marcadorBusca.remove();
    marcadorBusca = null;
  }
  buscaEls.input.value = "";
  mostrarMensagemBusca("");
  limparResultadosBusca();
}

// Cria a caixa de busca como um "controle" do Leaflet (fica sobre o mapa).
function criarControleBusca() {
  const controle = L.control({ position: "topleft" });

  controle.onAdd = function () {
    const div = L.DomUtil.create("div", "busca-endereco leaflet-control");

    div.innerHTML = `
      <form role="search" autocomplete="off">
        <label for="busca-texto" class="so-leitor-de-tela">Buscar endereço em São Paulo</label>
        <input id="busca-texto" type="search" maxlength="120" placeholder="Buscar endereço...">
        <button type="submit" class="busca-botao">Buscar</button>
        <button type="button" class="busca-limpar" aria-label="Limpar busca" title="Limpar busca">×</button>
      </form>
      <p class="busca-status" role="status"></p>
      <ul class="busca-resultados"></ul>
    `;

    buscaEls.input = div.querySelector("input");
    buscaEls.status = div.querySelector(".busca-status");
    buscaEls.lista = div.querySelector(".busca-resultados");

    // Sem isto, clicar, arrastar, rolar ou apertar teclas dentro da caixa
    // também mexeria no mapa (por exemplo, as setas moveriam o mapa).
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    L.DomEvent.on(buscaEls.input, "keydown keyup keypress", L.DomEvent.stopPropagation);

    // Enter ou clique em "Buscar".
    div.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault(); // impede a página de recarregar
      buscarEndereco(buscaEls.input.value);
    });

    // Botão "×".
    div.querySelector(".busca-limpar").addEventListener("click", limparBusca);

    // Tecla Esc fecha a lista de resultados.
    buscaEls.input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        limparResultadosBusca();
        mostrarMensagemBusca("");
      }
    });

    return div;
  };

  return controle;
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
// A função atualizarVisualizacao também cuida dos pontos de ônibus.
map.on("moveend", atualizarVisualizacao);


// =====================================================================
// 🚀 INICIAR
// =====================================================================
// Controles do canto superior esquerdo: primeiro a busca, depois o zoom
// (a ordem em que são adicionados define a ordem na tela).
criarControleBusca().addTo(map);
L.control.zoom({ position: "topleft" }).addTo(map);

carregarBairros();
carregarOcorrencias();
atualizarPontos();
