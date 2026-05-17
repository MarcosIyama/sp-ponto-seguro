// =========================
// 🗺️ MAPA
// =========================
const map = L.map("map").setView([-23.55, -46.63], 11);

L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    attribution: "© OpenStreetMap"
  }
).addTo(map);

// =========================
// 📦 VARIÁVEIS
// =========================
let todosCrimes = [];
let camadaCrimes = L.layerGroup().addTo(map);

// =========================
// 📅 FILTRO
// =========================
const filtro = document.getElementById("filtro");

if (filtro) {
  filtro.addEventListener("change", (e) => {
    desenharCrimes(e.target.value);
  });
}

// =========================
// 🚌 PONTOS DE ÔNIBUS
// =========================
fetch("/api/pontos_onibus")
  .then(res => res.json())
  .then(geojson => {
    L.geoJSON(geojson, {
      pointToLayer: (feature, latlng) => {
        return L.circleMarker(latlng, {
          radius: 7,
          color: "#0066ff",
          fillColor: "#3399ff",
          fillOpacity: 1,
          weight: 2
        });
      },
      onEachFeature: (feature, layer) => {
        const nome = feature.properties?.nm_ponto_onibus || "Ponto de ônibus";
        layer.bindPopup(`
          <div style="min-width:180px">
            <h3 style="margin:0;color:#0066ff;font-size:16px;">Ponto de Ônibus</h3>
            <hr>
            <b>Nome:</b><br>
            ${nome}
          </div>
        `);
      }
    }).addTo(map);
  })
  .catch(err => console.error("Erro ao carregar pontos de ônibus:", err));

// =========================
// 🔴 CARREGAR CRIMES
// =========================
function carregarCrimes() {
  fetch("/api/crimes")
    .then(res => res.json())
    .then(dados => {
      todosCrimes = dados;
      console.log("Crimes carregados:", todosCrimes.length);
      desenharCrimes("todos");
    })
    .catch(err => console.error("Erro ao carregar crimes:", err));
}

// =========================
// 🔁 DESENHAR CRIMES
// =========================
function desenharCrimes(anoSelecionado) {
  camadaCrimes.clearLayers();
  let contador = 0;

  todosCrimes.forEach(crime => {
    const lat = parseFloat(crime.lat);
    const lon = parseFloat(crime.lon);

    if (isNaN(lat) || isNaN(lon)) return;

    if (anoSelecionado !== "todos" && String(crime.ano) !== String(anoSelecionado)) {
      return;
    }

    contador++;

    L.circleMarker([lat, lon], {
      radius: 3,
      color: "#cc0000",
      fillColor: "#ff4d4d",
      fillOpacity: 0.7,
      weight: 1
    })
    .addTo(camadaCrimes)
    .bindPopup(`
      <div style="min-width:180px">
        <h3 style="margin:0;color:#cc0000;font-size:16px;">Ocorrência</h3>
        <hr>
        <b>Tipo:</b> ${crime.tipo_crime || "N/A"}<br>
        <b>Ano:</b> ${crime.ano}<br>
        <b>Hora:</b> ${crime.hora || "N/A"}<br>
        <b>Bairro:</b> ${crime.bairro || "N/A"}<br>
        <b>Logradouro:</b> ${crime.logradouro || "N/A"}
      </div>
    `);
  });

  console.log("Crimes desenhados:", contador);
}

// =========================
// 🚀 INICIAR
// =========================
carregarCrimes();
