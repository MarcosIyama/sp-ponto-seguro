// =========================
// ⚙️ CONFIGURAÇÕES
// =========================
const ZOOM_MINIMO_PONTOS = 14; // pontos de ônibus só aparecem a partir deste zoom
const TAMANHO_LOTE = 2000;     // quantas ocorrências desenhar por quadro de animação

// =========================
// 🗺️ MAPA
// =========================
const map = L.map("map").setView([-23.55, -46.63], 11);

L.tileLayer(
  "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }
).addTo(map);

// Os pontos são desenhados em Canvas, bem mais leve que SVG quando há milhares deles.
// As ocorrências ficam em um painel acima dos pontos de ônibus.
map.createPane("paneCrimes");
map.getPane("paneCrimes").style.zIndex = 450;

const rendererPontos = L.canvas({ tolerance: 4 });
const rendererCrimes = L.canvas({ pane: "paneCrimes", tolerance: 5 });

// =========================
// 📦 VARIÁVEIS
// =========================
const camadaCrimes = L.layerGroup().addTo(map);

let camadaPontos = null;        // criada na primeira vez que o zoom permite
let carregandoPontos = false;
let versaoDesenho = 0;          // cancela desenhos antigos quando o filtro muda
let estadoCrimes = "";          // texto de status sobre as ocorrências

const statusMapa = document.getElementById("status-mapa");

// =========================
// 🧰 FUNÇÕES AUXILIARES
// =========================
function escapar(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function renderizarStatus() {
  const partes = [estadoCrimes];

  if (map.getZoom() < ZOOM_MINIMO_PONTOS) {
    partes.push("Aproxime o mapa para ver os pontos de ônibus.");
  }

  if (statusMapa) {
    statusMapa.textContent = partes.filter(Boolean).join(" ");
  }
}

// =========================
// 💬 POPUPS (montados só quando o usuário clica)
// =========================
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

// =========================
// 🚌 PONTOS DE ÔNIBUS
// (só são baixados e desenhados quando o zoom é alto o bastante)
// =========================
function carregarPontos() {
  if (carregandoPontos) return;
  carregandoPontos = true;

  fetch("/api/pontos_onibus")
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((geojson) => {
      camadaPontos = L.geoJSON(geojson, {
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
        onEachFeature: (feature, layer) => {
          layer.bindPopup(() => popupPonto(feature));
        }
      });

      atualizarPontos();
    })
    .catch((err) => console.error("Erro ao carregar pontos de ônibus:", err))
    .finally(() => {
      carregandoPontos = false;
    });
}

function atualizarPontos() {
  const zoomSuficiente = map.getZoom() >= ZOOM_MINIMO_PONTOS;

  if (zoomSuficiente) {
    if (!camadaPontos) {
      carregarPontos();
    } else if (!map.hasLayer(camadaPontos)) {
      camadaPontos.addTo(map);
    }
  } else if (camadaPontos && map.hasLayer(camadaPontos)) {
    map.removeLayer(camadaPontos);
  }

  renderizarStatus();
}

map.on("zoomend", atualizarPontos);

// =========================
// 🔴 CRIMES
// =========================
function mostrarAno(ano) {
  const versao = ++versaoDesenho;

  camadaCrimes.clearLayers();
  estadoCrimes = "Carregando ocorrências...";
  renderizarStatus();

  // O servidor já devolve só o ano pedido (e o navegador reaproveita respostas repetidas)
  fetch(`/api/crimes?ano=${encodeURIComponent(ano)}`)
    .then((res) => {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then((lista) => {
      if (versao !== versaoDesenho) return; // o usuário já escolheu outro filtro
      desenharCrimes(lista, versao);
    })
    .catch((err) => {
      console.error("Erro ao carregar crimes:", err);
      if (versao !== versaoDesenho) return;
      estadoCrimes = "Não foi possível carregar as ocorrências. Atualize a página para tentar de novo.";
      renderizarStatus();
    });
}

// Desenha em lotes para a página não travar enquanto os pontos aparecem
function desenharCrimes(lista, versao) {
  let indice = 0;
  let desenhados = 0;

  function desenharLote() {
    if (versao !== versaoDesenho) return; // desenho cancelado

    const fim = Math.min(indice + TAMANHO_LOTE, lista.length);

    for (; indice < fim; indice++) {
      const crime = lista[indice];

      const lat = parseFloat(crime.lat);
      const lon = parseFloat(crime.lon);

      if (isNaN(lat) || isNaN(lon)) continue;

      L.circleMarker([lat, lon], {
        renderer: rendererCrimes,
        radius: 3,
        color: "#cc0000",
        fillColor: "#ff4d4d",
        fillOpacity: 0.7,
        weight: 1
      })
        .addTo(camadaCrimes)
        .bindPopup(() => popupCrime(crime));

      desenhados++;
    }

    if (indice < lista.length) {
      estadoCrimes = `Desenhando ocorrências... (${desenhados.toLocaleString("pt-BR")})`;
      renderizarStatus();
      requestAnimationFrame(desenharLote);
    } else {
      estadoCrimes = desenhados > 0
        ? `${desenhados.toLocaleString("pt-BR")} ocorrências exibidas.`
        : "Nenhuma ocorrência encontrada para este filtro.";
      renderizarStatus();
    }
  }

  desenharLote();
}

// =========================
// 📅 FILTRO
// =========================
const filtro = document.getElementById("filtro");

if (filtro) {
  filtro.addEventListener("change", (e) => {
    mostrarAno(e.target.value);
  });
}

// =========================
// 🚀 INICIAR
// =========================
mostrarAno(filtro ? filtro.value : "todos");
atualizarPontos();
